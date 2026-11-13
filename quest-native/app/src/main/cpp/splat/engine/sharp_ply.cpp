#include "sharp_ply.h"

#include <algorithm>
#include <cerrno>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <sstream>
#include <vector>

#if defined(_WIN32)
#include <io.h>
#else
#include <unistd.h>
#endif

namespace qnsplat {
namespace {

using splatcore::Result;
using splatcore::SplatCloud;

/** ReadFn 위에 1MB 버퍼를 얹은 읽기 도우미. */
class BufferedReader {
public:
    explicit BufferedReader(const ReadFn& read) : m_read(read), m_buf(1 << 20) {}

    /** '\n'까지 한 줄(개행 제외). 끝이면 false. */
    bool line(std::string& out, std::size_t max_len = 4096) {
        out.clear();
        while (true) {
            if (m_pos == m_len && !fill()) return !out.empty();
            const char c = static_cast<char>(m_buf[m_pos++]);
            if (c == '\n') return true;
            if (c != '\r') out.push_back(c);
            if (out.size() > max_len) return false;
        }
    }

    /** 정확히 n바이트. 모자라면 false. */
    bool exact(void* dst, std::size_t n) {
        auto* p = static_cast<std::uint8_t*>(dst);
        while (n > 0) {
            if (m_pos == m_len && !fill()) return false;
            const std::size_t take = std::min(n, m_len - m_pos);
            std::memcpy(p, m_buf.data() + m_pos, take);
            m_pos += take;
            p += take;
            n -= take;
        }
        return true;
    }

private:
    bool fill() {
        m_pos = 0;
        m_len = m_read(m_buf.data(), m_buf.size());
        return m_len > 0;
    }

    const ReadFn& m_read;
    std::vector<std::uint8_t> m_buf;
    std::size_t m_pos = 0;
    std::size_t m_len = 0;
};

struct Property {
    std::string type;
    std::string name;
    std::size_t size = 0;
};

struct Element {
    std::string name;
    std::size_t count = 0;
    std::vector<Property> props;
    std::size_t stride() const {
        std::size_t s = 0;
        for (const auto& p : props) s += p.size;
        return s;
    }
};

std::size_t type_size(const std::string& t) {
    if (t == "char" || t == "uchar" || t == "int8" || t == "uint8") return 1;
    if (t == "short" || t == "ushort" || t == "int16" || t == "uint16") return 2;
    if (t == "int" || t == "uint" || t == "float" || t == "int32" || t == "uint32" || t == "float32") return 4;
    if (t == "double" || t == "float64") return 8;
    return 0;
}

bool is_float(const std::string& t) { return t == "float" || t == "float32"; }
bool is_uint32(const std::string& t) { return t == "uint" || t == "uint32"; }

Result<std::vector<Element>> parse_header(BufferedReader& in) {
    using R = Result<std::vector<Element>>;
    std::string text;
    if (!in.line(text) || text != "ply") return R::failure("PLY 파일이 아님('ply' 없음)");
    std::vector<Element> elements;
    bool format_ok = false;
    for (int guard = 0; guard < 10000; ++guard) {
        if (!in.line(text)) return R::failure("헤더가 끝나기 전에 파일이 끝남");
        std::istringstream ss(text);
        std::string kw;
        ss >> kw;
        if (kw.empty() || kw == "comment" || kw == "obj_info") continue;
        if (kw == "end_header") {
            if (!format_ok) return R::failure("format 줄 없음");
            return R::success(std::move(elements));
        }
        if (kw == "format") {
            std::string fmt, ver;
            ss >> fmt >> ver;
            if (fmt != "binary_little_endian") return R::failure("binary_little_endian만 지원(받은 형식: " + fmt + ")");
            format_ok = true;
        } else if (kw == "element") {
            Element e;
            long long n = -1;
            ss >> e.name >> n;
            if (e.name.empty() || n < 0) return R::failure("잘못된 element 줄: " + text);
            e.count = static_cast<std::size_t>(n);
            elements.push_back(std::move(e));
        } else if (kw == "property") {
            if (elements.empty()) return R::failure("element 앞에 property가 있음");
            Property p;
            ss >> p.type >> p.name;
            if (p.type == "list") return R::failure("list 속성은 지원하지 않음: " + text);
            p.size = type_size(p.type);
            if (p.size == 0 || p.name.empty()) return R::failure("알 수 없는 속성 형식: " + text);
            elements.back().props.push_back(std::move(p));
        } else {
            return R::failure("알 수 없는 헤더 줄: " + text);
        }
    }
    return R::failure("헤더가 너무 김");
}

/** 메타데이터 요소(속성 1개짜리 배열)를 읽어 dst에 최대 cap개 복사한다. */
template <typename T>
bool copy_scalar_array(const std::vector<std::uint8_t>& bytes, const Element& e, T* dst, std::size_t cap) {
    if (e.props.size() != 1 || e.props[0].size != sizeof(T) || e.count != cap) return false;
    std::memcpy(dst, bytes.data(), sizeof(T) * cap);
    return true;
}

}  // namespace

Result<SplatCloud> read_sharp_ply(const ReadFn& read, SharpMeta* meta, SharpPlyInfo* info) {
    using R = Result<SplatCloud>;
    BufferedReader in(read);
    auto header = parse_header(in);
    if (!header) return R::failure(header.error());
    const std::vector<Element>& elements = header.value();
    if (elements.empty() || elements[0].name != "vertex") return R::failure("첫 요소가 vertex가 아님");
    const Element& vertex = elements[0];

    // vertex 속성 위치를 이름으로 찾는다(모두 float).
    const std::size_t nprops = vertex.props.size();
    auto col = [&](const std::string& name) -> int {
        for (std::size_t i = 0; i < nprops; ++i)
            if (vertex.props[i].name == name) return static_cast<int>(i);
        return -1;
    };
    for (const auto& p : vertex.props)
        if (!is_float(p.type)) return R::failure("vertex 속성 '" + p.name + "'이 float가 아님(" + p.type + ")");
    const char* required[] = {"x", "y", "z", "f_dc_0", "f_dc_1", "f_dc_2", "opacity",
                              "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"};
    int c[14];
    for (int i = 0; i < 14; ++i) {
        c[i] = col(required[i]);
        if (c[i] < 0) return R::failure(std::string("vertex 필수 속성 없음: ") + required[i]);
    }
    int rest_count = 0;
    while (col("f_rest_" + std::to_string(rest_count)) >= 0) ++rest_count;
    int sh_degree = 0;
    switch (rest_count) {
        case 0: sh_degree = 0; break;
        case 9: sh_degree = 1; break;
        case 24: sh_degree = 2; break;
        case 45: sh_degree = 3; break;
        default: return R::failure("f_rest 개수가 0/9/24/45가 아님: " + std::to_string(rest_count));
    }
    const int k = splatcore::sh_rest_coeffs(sh_degree);
    std::vector<int> rest_col(static_cast<std::size_t>(rest_count));
    for (int j = 0; j < rest_count; ++j) rest_col[static_cast<std::size_t>(j)] = col("f_rest_" + std::to_string(j));

    const std::size_t count = vertex.count;
    if (count == 0) return R::failure("vertex 개수가 0");
    if (info) {
        info->count = count;
        info->sh_degree = sh_degree;
        info->sharp_extras = elements.size() > 1;
    }

    SplatCloud cloud;
    cloud.resize(count, sh_degree);

    // 64k개씩 읽어 SoA로 흩는다.
    constexpr std::size_t kBatch = 65536;
    std::vector<float> rows(kBatch * nprops);
    for (std::size_t base = 0; base < count; base += kBatch) {
        const std::size_t n = std::min(kBatch, count - base);
        if (!in.exact(rows.data(), n * nprops * sizeof(float)))
            return R::failure("vertex 데이터가 잘림(" + std::to_string(base) + "번째 근처)");
        for (std::size_t r = 0; r < n; ++r) {
            const float* v = rows.data() + r * nprops;
            const std::size_t i = base + r;
            for (int a = 0; a < 3; ++a) {
                cloud.positions[3 * i + a] = v[c[a]];
                cloud.dc[3 * i + a] = v[c[3 + a]];
                cloud.log_scales[3 * i + a] = v[c[7 + a]];
            }
            cloud.opacities[i] = v[c[6]];
            // PLY rot_0..3 = (w, x, y, z). 읽을 때 정규화한다(길이 0은 그대로 두고 drop_invalid가 거른다).
            float q[4] = {v[c[10]], v[c[11]], v[c[12]], v[c[13]]};
            const float len = std::sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
            if (len > 0.0f && std::isfinite(len))
                for (float& x : q) x /= len;
            for (int a = 0; a < 4; ++a) cloud.rotations[4 * i + a] = q[a];
            // f_rest는 채널별 평면(R k개, G k개, B k개) → 계수 우선(c0.rgb, c1.rgb, ...)
            for (int cc = 0; cc < k; ++cc)
                for (int ch = 0; ch < 3; ++ch)
                    cloud.sh[(i * static_cast<std::size_t>(k) + static_cast<std::size_t>(cc)) * 3 + static_cast<std::size_t>(ch)] =
                        v[rest_col[static_cast<std::size_t>(ch * k + cc)]];
        }
    }

    // vertex 뒤 요소: SHARP 메타데이터만 꺼내고 나머지는 건너뛴다. 잘려 있어도 splat은 쓸 수 있으므로 실패로 보지 않는다.
    for (std::size_t ei = 1; ei < elements.size(); ++ei) {
        const Element& e = elements[ei];
        std::vector<std::uint8_t> bytes(e.count * e.stride());
        if (!in.exact(bytes.data(), bytes.size())) break;
        if (!meta || e.props.size() != 1) continue;
        if (e.name == "intrinsic" && is_float(e.props[0].type))
            meta->has_intrinsic = copy_scalar_array(bytes, e, meta->intrinsic, 9);
        else if (e.name == "extrinsic" && is_float(e.props[0].type))
            meta->has_extrinsic = copy_scalar_array(bytes, e, meta->extrinsic, 16);
        else if (e.name == "image_size" && is_uint32(e.props[0].type))
            meta->has_image_size = copy_scalar_array(bytes, e, meta->image_size, 2);
    }
    return R::success(std::move(cloud));
}

Result<SplatCloud> read_sharp_ply_file(const std::string& path, SharpMeta* meta, SharpPlyInfo* info) {
    std::FILE* f = std::fopen(path.c_str(), "rb");
    if (!f) return Result<SplatCloud>::failure("파일을 열 수 없음: " + path);
    ReadFn read = [f](void* dst, std::size_t n) { return std::fread(dst, 1, n, f); };
    auto result = read_sharp_ply(read, meta, info);
    std::fclose(f);
    return result;
}

Result<SplatCloud> read_sharp_ply_fd(int fd, SharpMeta* meta, SharpPlyInfo* info) {
    ReadFn read = [fd](void* dst, std::size_t n) -> std::size_t {
        while (true) {
#if defined(_WIN32)
            const int got = _read(fd, dst, static_cast<unsigned>(std::min<std::size_t>(n, 1u << 30)));
#else
            const ssize_t got = ::read(fd, dst, n);
            if (got < 0 && errno == EINTR) continue;
#endif
            // 0 = 끝, 음수 = 오류. 둘 다 끝으로 처리하고 잘림은 호출자가 판정한다.
            return got > 0 ? static_cast<std::size_t>(got) : 0;
        }
    };
    return read_sharp_ply(read, meta, info);
}

}  // namespace qnsplat
