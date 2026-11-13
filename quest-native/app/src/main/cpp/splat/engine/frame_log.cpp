#include "frame_log.h"

#include <cstdio>

namespace qnsplat {

const char* FrameLog::csv_header() {
    return "t,fps,hz,cpu_ms,gpu_ms,lc,ld,rc,rd,visL,visR,splats,eye_w,eye_h,scale,fov,key,late,label";
}

std::string FrameLog::format_logcat(double t, double fps, const FrameSample& a, int late, const FrameContext& c) {
    char buf[512];
    std::snprintf(buf, sizeof(buf),
                  "QNSPLAT t=%.1f fps=%.1f hz=%d cpu_ms=%.2f gpu_ms=%.2f lc=%.2f ld=%.2f rc=%.2f rd=%.2f visL=%u "
                  "visR=%u splats=%u eye=%ux%u scale=%.2f fov=%d key=%d late=%d label=%s",
                  t, fps, c.hz, a.cpu_ms, a.gpu_ms, a.lc, a.ld, a.rc, a.rd, a.vis_l, a.vis_r, c.splats, c.eye_w,
                  c.eye_h, c.scale, c.foveation, c.key_bits, late, c.label.empty() ? "-" : c.label.c_str());
    return buf;
}

std::string FrameLog::format_csv(double t, double fps, const FrameSample& a, int late, const FrameContext& c) {
    char buf[512];
    std::snprintf(buf, sizeof(buf), "%.1f,%.1f,%d,%.2f,%.2f,%.2f,%.2f,%.2f,%.2f,%u,%u,%u,%u,%u,%.2f,%d,%d,%d,%s", t,
                  fps, c.hz, a.cpu_ms, a.gpu_ms, a.lc, a.ld, a.rc, a.rd, a.vis_l, a.vis_r, c.splats, c.eye_w, c.eye_h,
                  c.scale, c.foveation, c.key_bits, late, c.label.empty() ? "-" : c.label.c_str());
    return buf;
}

bool FrameLog::add(double now_s, const FrameSample& s, const FrameContext& c) {
    if (m_start < 0) m_start = m_window_start = now_s;
    ++m_frames;
    m_sum.cpu_ms += s.cpu_ms;
    if (s.gpu_ms > 0) {
        ++m_gpu_frames;
        m_sum.gpu_ms += s.gpu_ms;
        m_sum.lc += s.lc;
        m_sum.ld += s.ld;
        m_sum.rc += s.rc;
        m_sum.rd += s.rd;
        if (c.hz > 0 && s.gpu_ms > 1000.0 / c.hz) ++m_late;
    }
    m_last_vis_l = s.vis_l;
    m_last_vis_r = s.vis_r;

    const double elapsed = now_s - m_window_start;
    if (elapsed < 1.0) return false;

    FrameSample avg;
    avg.cpu_ms = m_sum.cpu_ms / m_frames;
    if (m_gpu_frames > 0) {
        avg.gpu_ms = m_sum.gpu_ms / m_gpu_frames;
        avg.lc = m_sum.lc / m_gpu_frames;
        avg.ld = m_sum.ld / m_gpu_frames;
        avg.rc = m_sum.rc / m_gpu_frames;
        avg.rd = m_sum.rd / m_gpu_frames;
    }
    avg.vis_l = m_last_vis_l;
    avg.vis_r = m_last_vis_r;
    const double fps = m_frames / elapsed;
    const double t = now_s - m_start;

    if (m_logcat) m_logcat(format_logcat(t, fps, avg, m_late, c));
    if (m_csv) {
        if (!m_header_written) {
            m_csv(csv_header());
            m_header_written = true;
        }
        m_csv(format_csv(t, fps, avg, m_late, c));
    }
    m_last_fps = fps;
    m_last_gpu = avg.gpu_ms;
    m_window_start = now_s;
    m_frames = m_gpu_frames = m_late = 0;
    m_sum = FrameSample{};
    return true;
}

}  // namespace qnsplat
