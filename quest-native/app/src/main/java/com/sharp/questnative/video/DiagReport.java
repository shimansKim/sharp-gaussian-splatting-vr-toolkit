package com.sharp.questnative.video;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Builds the result files of the decoder diagnostics: a JSON file (for agents and scripts) and a
 * Markdown summary (for people). Pure Java: no org.json (it is a stub in JVM unit tests).
 * Owner: video-dev.
 *
 * JSON layout (schema "qn-decoder-diag/2"):
 *   { schema, app, createdAt, device{...}, codecs[CodecInfo...], tests[{spec, measurement, result, drops}] }
 * /2 adds measurement.targetSeconds, droppedPerSecond, renderedPerSecond, thermal and battery
 * temperature, and per test "drops" (DiagTimeline summary).
 */
public final class DiagReport {
    private DiagReport() {}

    public static final String SCHEMA = "qn-decoder-diag/2";

    /** One decoder from MediaCodecList, filled by CodecReport on the device. */
    public static final class CodecInfo {
        public String name = "", canonicalName = "", mime = "";
        public Boolean hardware, softwareOnly, vendor;  // null = unknown (API < 29)
        public final List<String> aliases = new ArrayList<>();
        public final List<String> profileLevels = new ArrayList<>();  // "Main10 / L6.1"
        public String widths = "", heights = "", frameRates = "", bitrates = "";  // "lo-hi"
        public int widthAlignment, heightAlignment;
        public final List<String> performancePoints = new ArrayList<>();  // "8192x4096@60"
        public boolean tenBit;
        public final List<String> hdr = new ArrayList<>();  // "HDR10", "HDR10+", "HLG", "DolbyVision"
        public int maxInstances;
        public String audioInfo = "";  // audio decoders: "max 8 ch, 8000-48000 Hz"
        /** Per test with this MIME: test id -> {sizeAndRate: bool, achievableFps: "lo-hi"|null}. */
        public final Map<String, Map<String, Object>> testChecks = new LinkedHashMap<>();
    }

    public static final class Entry {
        public final DiagTests.Spec spec;
        public final DiagJudge.Measurement m;
        public final DiagJudge.Result r;

        public Entry(DiagTests.Spec spec, DiagJudge.Measurement m, DiagJudge.Result r) {
            this.spec = spec;
            this.m = m;
            this.r = r;
        }
    }

    // ------------------------------------------------------------------ JSON

    public static String json(Object v) {
        StringBuilder sb = new StringBuilder();
        write(sb, v, 0);
        return sb.append('\n').toString();
    }

    private static void indent(StringBuilder sb, int n) {
        sb.append('\n');
        for (int i = 0; i < n; i++) sb.append("  ");
    }

    @SuppressWarnings("unchecked")
    private static void write(StringBuilder sb, Object v, int depth) {
        if (v == null) {
            sb.append("null");
        } else if (v instanceof String) {
            quote(sb, (String) v);
        } else if (v instanceof Boolean) {
            sb.append(v.toString());
        } else if (v instanceof Double || v instanceof Float) {
            double d = ((Number) v).doubleValue();
            if (Double.isNaN(d) || Double.isInfinite(d)) sb.append("null");
            else if (d == Math.rint(d) && Math.abs(d) < 1e15) sb.append((long) d);
            else sb.append(String.format(Locale.ROOT, "%.4f", d).replaceAll("0+$", "").replaceAll("\\.$", ""));
        } else if (v instanceof Number) {
            sb.append(v.toString());
        } else if (v instanceof Map) {
            Map<String, Object> m = (Map<String, Object>) v;
            if (m.isEmpty()) {
                sb.append("{}");
                return;
            }
            sb.append('{');
            boolean first = true;
            for (Map.Entry<String, Object> e : m.entrySet()) {
                if (!first) sb.append(',');
                first = false;
                indent(sb, depth + 1);
                quote(sb, e.getKey());
                sb.append(": ");
                write(sb, e.getValue(), depth + 1);
            }
            indent(sb, depth);
            sb.append('}');
        } else if (v instanceof List) {
            List<Object> l = (List<Object>) v;
            if (l.isEmpty()) {
                sb.append("[]");
                return;
            }
            boolean simple = true;
            for (Object o : l) simple &= !(o instanceof Map || o instanceof List);
            sb.append('[');
            for (int i = 0; i < l.size(); i++) {
                if (i > 0) sb.append(simple ? ", " : ",");
                if (!simple) indent(sb, depth + 1);
                write(sb, l.get(i), depth + 1);
            }
            if (!simple) indent(sb, depth);
            sb.append(']');
        } else {
            quote(sb, v.toString());
        }
    }

    static void quote(StringBuilder sb, String s) {
        sb.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    if (c < 0x20) sb.append(String.format(Locale.ROOT, "\\u%04x", (int) c));
                    else sb.append(c);
            }
        }
        sb.append('"');
    }

    // ------------------------------------------------------------------ model -> maps

    static Map<String, Object> codecMap(CodecInfo c) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("name", c.name);
        m.put("canonicalName", c.canonicalName);
        m.put("mime", c.mime);
        m.put("hardware", c.hardware);
        m.put("softwareOnly", c.softwareOnly);
        m.put("vendor", c.vendor);
        m.put("aliases", new ArrayList<Object>(c.aliases));
        m.put("profileLevels", new ArrayList<Object>(c.profileLevels));
        m.put("widths", c.widths);
        m.put("heights", c.heights);
        m.put("widthAlignment", c.widthAlignment);
        m.put("heightAlignment", c.heightAlignment);
        m.put("frameRates", c.frameRates);
        m.put("bitrates", c.bitrates);
        m.put("performancePoints", new ArrayList<Object>(c.performancePoints));
        m.put("tenBit", c.tenBit);
        m.put("hdr", new ArrayList<Object>(c.hdr));
        m.put("maxInstances", c.maxInstances);
        m.put("audioInfo", c.audioInfo);
        m.put("testChecks", new LinkedHashMap<String, Object>(c.testChecks));
        return m;
    }

    static Map<String, Object> entryMap(Entry e) {
        Map<String, Object> spec = new LinkedHashMap<>();
        spec.put("id", e.spec.id);
        spec.put("file", e.m.file.isEmpty() ? e.spec.file : e.m.file);
        spec.put("codec", e.spec.codec);
        spec.put("profile", e.spec.profile);
        spec.put("width", e.spec.width);
        spec.put("height", e.spec.height);
        spec.put("fps", (double) e.spec.fps);
        spec.put("mbps", e.spec.mbps);
        spec.put("tenBit", e.spec.tenBit);
        spec.put("hdr", e.spec.hdr);
        spec.put("audio", e.spec.audio);
        spec.put("purpose", e.spec.purpose);

        Map<String, Object> m = new LinkedHashMap<>();
        m.put("decoderName", e.m.decoderName);
        m.put("hardware", e.m.hardware);
        m.put("videoMime", e.m.videoMime);
        m.put("videoCodecs", e.m.videoCodecs);
        m.put("width", e.m.width);
        m.put("height", e.m.height);
        m.put("fps", (double) e.m.fps);
        m.put("firstFrameMs", e.m.firstFrameMs);
        m.put("playedSeconds", e.m.playedSeconds);
        m.put("renderedFrames", e.m.renderedFrames);
        m.put("droppedFrames", e.m.droppedFrames);
        m.put("skippedFrames", e.m.skippedFrames);
        m.put("maxConsecutiveDropped", e.m.maxConsecutiveDropped);
        m.put("audioDecoderName", e.m.audioDecoderName);
        m.put("audioOutputBuffers", e.m.audioOutputBuffers);
        m.put("error", e.m.error);
        m.put("invalidReason", e.m.invalidReason);
        m.put("targetSeconds", e.m.targetSeconds);
        m.put("droppedPerSecond", new ArrayList<Object>(e.m.droppedPerSecond));
        m.put("renderedPerSecond", new ArrayList<Object>(e.m.renderedPerSecond));
        m.put("thermalStart", e.m.thermalStart);
        m.put("thermalEnd", e.m.thermalEnd);
        m.put("batteryTempStartC", e.m.batteryTempStartC);
        m.put("batteryTempEndC", e.m.batteryTempEndC);

        Map<String, Object> v = new LinkedHashMap<>();
        v.put("verdict", e.r.verdict.name());
        v.put("label", e.r.label());
        v.put("reason", e.r.reason);
        v.put("expectedFrames", e.r.expectedFrames);
        v.put("droppedPercent", e.r.droppedPercent);
        v.put("droppedPercentText", DiagJudge.pctCell(e.r));
        v.put("audioOk", e.r.audioOk);

        List<Long> d = e.m.droppedPerSecond;
        Map<String, Object> drops = new LinkedHashMap<>();
        drops.put("pattern", DiagTimeline.pattern(d));
        drops.put("startSeconds", DiagTimeline.START_SECONDS);
        drops.put("droppedInStart", DiagTimeline.sum(d, 0, DiagTimeline.START_SECONDS));
        drops.put("droppedAfterStart", DiagTimeline.sum(d, DiagTimeline.START_SECONDS, d.size()));
        drops.put("secondsWithDrops", DiagTimeline.secondsWithDrops(d));
        drops.put("firstDropSecond", DiagTimeline.firstDropSecond(d));
        drops.put("lastDropSecond", DiagTimeline.lastDropSecond(d));
        drops.put("per10s", DiagTimeline.buckets(d, 10));

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("spec", spec);
        out.put("measurement", m);
        out.put("result", v);
        out.put("drops", drops);
        return out;
    }

    public static Map<String, Object> build(String appVersion, String createdAt, Map<String, Object> device,
                                            List<CodecInfo> codecs, List<Entry> tests) {
        Map<String, Object> root = new LinkedHashMap<>();
        root.put("schema", SCHEMA);
        root.put("app", appVersion);
        root.put("createdAt", createdAt);
        root.put("passRule", "hardware decoder and dropped frames < 1% of source frames");
        root.put("borderPercent", DiagJudge.BORDER_PERCENT);
        root.put("device", device);
        List<Object> cl = new ArrayList<>();
        for (CodecInfo c : codecs) cl.add(codecMap(c));
        root.put("codecs", cl);
        List<Object> tl = new ArrayList<>();
        for (Entry e : tests) tl.add(entryMap(e));
        root.put("tests", tl);
        return root;
    }

    // ------------------------------------------------------------------ Markdown

    private static String yn(Boolean b) {
        return b == null ? "?" : b ? "예" : "아니요";
    }

    private static String cell(String s) {
        return (s == null || s.isEmpty() ? "-" : s).replace("|", "/").replace("\n", " ");
    }

    public static String markdown(String appVersion, String createdAt, Map<String, Object> device,
                                  List<CodecInfo> codecs, List<Entry> tests) {
        StringBuilder sb = new StringBuilder();
        sb.append("# Quest 디코더 진단 결과\n\n");
        sb.append("- 만든 때: ").append(createdAt).append('\n');
        sb.append("- 앱: ").append(appVersion).append('\n');
        for (Map.Entry<String, Object> e : device.entrySet()) {
            sb.append("- ").append(e.getKey()).append(": ").append(e.getValue()).append('\n');
        }
        sb.append("- 통과 기준: 하드웨어 디코더로 열리고, 버린 프레임이 원본 프레임의 1% 미만\n");
        sb.append("- 버림(%)은 소수 셋째 자리에서 버림(반올림 아님). ")
                .append(fmtPctPlain(DiagJudge.BORDER_PERCENT)).append("% 이상으로 통과하면 \"경계\"를 붙인다.\n");
        sb.append("- 버린 때: 첫 화면 뒤 초 단위로 센 버림. 첫 ").append(DiagTimeline.START_SECONDS)
                .append("초는 시작 구간\n\n");

        if (!tests.isEmpty()) {
            int pass = 0;
            for (Entry e : tests) if (e.r.verdict == DiagJudge.Verdict.PASS) pass++;
            sb.append("## 시험 영상 재생 (").append(pass).append(" / ").append(tests.size()).append(" 됨)\n\n");
            sb.append("| 번호 | 내용 | 판정 | 디코더 | HW | 첫 화면(ms) | 잰 길이(초) | 표시 | 버림(%) | 최대 연속 버림 "
                    + "| 버린 때 | 소리 | 사유 |\n");
            sb.append("|---|---|---|---|---|---|---|---|---|---|---|---|---|\n");
            for (Entry e : tests) {
                sb.append("| ").append(e.spec.id)
                        .append(" | ").append(cell(String.format(Locale.ROOT, "%s %dx%d %sfps %dM", e.spec.profile,
                                e.spec.width, e.spec.height, fmtFps(e.spec.fps), e.spec.mbps)))
                        .append(" | ").append(e.r.label())
                        .append(" | ").append(cell(e.m.decoderName))
                        .append(" | ").append(yn(e.m.hardware))
                        .append(" | ").append(e.m.firstFrameMs >= 0 ? Long.toString(e.m.firstFrameMs) : "-")
                        .append(" | ").append(String.format(Locale.ROOT, "%.1f", e.m.playedSeconds))
                        .append(" | ").append(e.m.renderedFrames)
                        .append(" | ").append(e.m.droppedFrames).append(" (").append(DiagJudge.pctCell(e.r)).append(')')
                        .append(" | ").append(e.m.maxConsecutiveDropped)
                        .append(" | ").append(cell(DiagTimeline.summary(e.m.droppedPerSecond)))
                        .append(" | ").append(e.r.audioOk ? "남(" + cell(e.m.audioDecoderName) + ")" : "안 남")
                        .append(" | ").append(cell(e.r.reason)).append(" |\n");
            }
            sb.append('\n');
            timelineSection(sb, tests);
        }

        sb.append("## 디코더 목록 (MediaCodecList)\n\n");
        sb.append("| MIME | 이름 | HW | 가로 | 세로 | fps | 비트레이트 | 10bit | HDR | 성능 지점 |\n");
        sb.append("|---|---|---|---|---|---|---|---|---|---|\n");
        for (CodecInfo c : codecs) {
            sb.append("| ").append(cell(c.mime)).append(" | ").append(cell(c.name)).append(" | ")
                    .append(yn(c.hardware)).append(" | ").append(cell(c.widths)).append(" | ")
                    .append(cell(c.heights)).append(" | ").append(cell(c.frameRates)).append(" | ")
                    .append(cell(c.bitrates)).append(" | ").append(c.tenBit ? "예" : "아니요").append(" | ")
                    .append(cell(String.join(", ", c.hdr))).append(" | ")
                    .append(cell(String.join(", ", c.performancePoints))).append(" |\n");
        }
        sb.append("\n## 시험 해상도별 디코더 자체 판단\n\n");
        sb.append("`areSizeAndRateSupported(w, h, fps)`와 `getAchievableFrameRatesFor(w, h)` 값이다.\n\n");
        sb.append("| 디코더 | 번호 | 크기·fps 지원 | 달성 가능 fps |\n|---|---|---|---|\n");
        for (CodecInfo c : codecs) {
            for (Map.Entry<String, Map<String, Object>> t : c.testChecks.entrySet()) {
                Object ok = t.getValue().get("sizeAndRate");
                Object ach = t.getValue().get("achievableFps");
                sb.append("| ").append(cell(c.name)).append(" | ").append(t.getKey()).append(" | ")
                        .append(Boolean.TRUE.equals(ok) ? "예" : Boolean.FALSE.equals(ok) ? "아니요" : "?")
                        .append(" | ").append(ach == null ? "-" : cell(ach.toString())).append(" |\n");
            }
        }
        sb.append('\n');
        return sb.toString();
    }

    private static String fmtPctPlain(double v) {
        return v == Math.rint(v) ? Long.toString((long) v) : Double.toString(v);
    }

    private static String temp(double c) {
        return Double.isNaN(c) ? "-" : String.format(Locale.ROOT, "%.1f", c);
    }

    private static String thermal(int s) {
        // PowerManager.THERMAL_STATUS_*
        switch (s) {
            case 0: return "0 없음";
            case 1: return "1 약함";
            case 2: return "2 보통";
            case 3: return "3 심함";
            case 4: return "4 위급";
            case 5: return "5 비상";
            case 6: return "6 종료";
            default: return "-";
        }
    }

    /** Per test: drops per 10 s, shown fps at start and end, heat before/after. */
    private static void timelineSection(StringBuilder sb, List<Entry> tests) {
        sb.append("## 버린 때와 열\n\n");
        sb.append("10초 구간별 버린 프레임 수, 처음·마지막 10초의 평균 표시 fps, 시험 전후 기기 열 상태(PowerManager)와 "
                + "배터리 온도다.\n\n");
        sb.append("| 번호 | 잰 길이(초) | 10초 구간별 버림 | 표시 fps 처음→끝 | 열 상태 전→후 | 배터리 °C 전→후 |\n");
        sb.append("|---|---|---|---|---|---|\n");
        for (Entry e : tests) {
            List<Long> d = e.m.droppedPerSecond;
            List<Long> r = e.m.renderedPerSecond;
            String fps = "-";
            if (r.size() >= 2) {
                int w = Math.min(10, r.size());
                // the last second is usually partial: leave it out of the end average
                int end = r.size() > w ? r.size() - 1 : r.size();
                fps = String.format(Locale.ROOT, "%.1f → %.1f", DiagTimeline.sum(r, 0, w) / (double) w,
                        DiagTimeline.sum(r, Math.max(0, end - w), end) / (double) Math.min(w, end));
            }
            sb.append("| ").append(e.spec.id)
                    .append(" | ").append(String.format(Locale.ROOT, "%.1f", e.m.playedSeconds))
                    .append(" | ").append(d.isEmpty() ? "-" : cell(DiagTimeline.buckets(d, 10)))
                    .append(" | ").append(fps)
                    .append(" | ").append(thermal(e.m.thermalStart)).append(" → ").append(thermal(e.m.thermalEnd))
                    .append(" | ").append(temp(e.m.batteryTempStartC)).append(" → ").append(temp(e.m.batteryTempEndC))
                    .append(" |\n");
        }
        sb.append('\n');
    }

    static String fmtFps(float fps) {
        return fps == Math.rint(fps) ? Integer.toString((int) fps) : String.format(Locale.ROOT, "%.2f", fps);
    }
}
