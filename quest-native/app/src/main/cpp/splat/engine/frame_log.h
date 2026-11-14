#pragma once
// 실측판 기록 형식: 1초마다 한 줄. 같은 내용을 logcat(태그 QNSplat)과 CSV 파일에 남긴다.
//
// logcat 줄(키=값, 공백 구분):
//   QNSPLAT t=12.0 fps=71.9 hz=72 cpu_ms=4.1 gpu_ms=11.8 lc=3.1 ld=2.6 rc=3.0 rd=2.7 visL=812345 visR=809876
//           splats=1179648 eye=1680x1760 scale=1.00 fov=0 key=16 late=1 label=sample_1179648
// CSV(같은 열 순서, 첫 줄 머리글): t,fps,hz,cpu_ms,gpu_ms,lc,ld,rc,rd,visL,visR,splats,eye_w,eye_h,scale,fov,key,late,label
//
// 열 뜻
//  fps     지난 1초 동안 제출한 프레임 수(xrEndFrame 횟수 / 실제 경과 초)
//  hz      디스플레이 주사율(XR_FB_display_refresh_rate, 모르면 0)
//  cpu_ms  프레임당 CPU 기록 시간 평균(xrWaitFrame 이후 ~ 제출까지)
//  gpu_ms  프레임당 GPU 시간 평균(timestamp, 양 눈 합)
//  stereo=0: lc/ld/rc/rd = 왼눈 compute·draw, 오른눈 compute·draw 평균 ms
//  stereo=1: lc = 공유 cull+preprocess, rc = 공유 prepare+sort, ld/rd = 왼눈/오른눈 draw
//  visL/visR    눈별 보이는 splat 수(최근 완료 프레임)
//  late    지난 1초 동안 예산(1000/hz ms)을 넘긴 GPU 프레임 수
//  key     정렬 키 비트(16/32), fov: foveation 레벨(0=끔 1=낮음 2=중간 3=높음)

#include <cstdint>
#include <functional>
#include <string>

namespace qnsplat {

struct FrameSample {
    double cpu_ms = 0;
    double gpu_ms = 0;  // 0이면 아직 결과 없음(앞 프레임 몇 개)
    double lc = 0, ld = 0, rc = 0, rd = 0;
    std::uint32_t vis_l = 0, vis_r = 0;
};

struct FrameContext {
    std::uint32_t splats = 0;
    std::uint32_t eye_w = 0, eye_h = 0;
    float scale = 1.0f;
    int foveation = 0;
    int key_bits = 32;
    int hz = 0;
    std::string label;
    // Logcat records all A/B knobs every second; CSV keeps its v1 column contract.
    bool stereo = false, half = false;
    int draw = 3, probe = 0, pose = 0;  // pose: 0 live, 1 fixed immersive, 2 fixed fit (compute forced)
    float minc = 0, acut = 1, sd2 = 8, maxpx = 2048;
};

class FrameLog {
public:
    using Sink = std::function<void(const std::string& line)>;

    /** logcat_sink: "QNSPLAT ..." 한 줄, csv_sink: CSV 한 줄(첫 호출 전에 머리글 한 번). 둘 다 비워도 된다. */
    FrameLog(Sink logcat_sink, Sink csv_sink) : m_logcat(std::move(logcat_sink)), m_csv(std::move(csv_sink)) {}

    static const char* csv_header();

    /** 매 프레임 호출. now_s는 단조 시계(초). 1초가 지나면 줄을 내보내고 true. */
    bool add(double now_s, const FrameSample& sample, const FrameContext& context);

    /** 마지막으로 내보낸 값(화면 진단 표시용). */
    double last_fps() const { return m_last_fps; }
    double last_gpu_ms() const { return m_last_gpu; }

    static std::string format_logcat(double t, double fps, const FrameSample& avg, int late, const FrameContext& c);
    static std::string format_csv(double t, double fps, const FrameSample& avg, int late, const FrameContext& c);

private:
    Sink m_logcat, m_csv;
    bool m_header_written = false;
    double m_start = -1, m_window_start = -1;
    int m_frames = 0, m_gpu_frames = 0, m_late = 0;
    FrameSample m_sum;
    std::uint32_t m_last_vis_l = 0, m_last_vis_r = 0;
    double m_last_fps = 0, m_last_gpu = 0;
};

}  // namespace qnsplat
