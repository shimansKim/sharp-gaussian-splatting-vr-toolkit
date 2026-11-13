package com.sharp.questnative.video;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Decoder test videos: encoding-guide.md §3.1 (T01..T15) plus T16 (HDR10), T17 (AC-3) and T18
 * (E-AC-3), which the guide listed as "not in the test list yet". tools/make_diag_videos.bat makes
 * exactly these files. Pure Java (JVM unit tests). Owner: video-dev.
 */
public final class DiagTests {
    private DiagTests() {}

    public static final class Spec {
        public final String id;        // "T01"
        public final String file;      // file name the bat produces
        public final String codec;     // "h264", "hevc", "av1"
        public final String profile;   // human text, e.g. "HEVC Main10"
        public final int width, height;
        public final float fps;
        public final int mbps;
        public final boolean tenBit, hdr;
        public final String audio;     // "aac", "opus", "ac3", "eac3"
        public final String purpose;   // what the test checks (Korean)

        Spec(String id, String file, String codec, String profile, int w, int h, float fps, int mbps, boolean tenBit,
             boolean hdr, String audio, String purpose) {
            this.id = id;
            this.file = file;
            this.codec = codec;
            this.profile = profile;
            this.width = w;
            this.height = h;
            this.fps = fps;
            this.mbps = mbps;
            this.tenBit = tenBit;
            this.hdr = hdr;
            this.audio = audio;
            this.purpose = purpose;
        }

        /** Media MIME of the video track. */
        public String mime() {
            switch (codec) {
                case "h264": return "video/avc";
                case "hevc": return "video/hevc";
                case "av1": return "video/av01";
                case "vp9": return "video/x-vnd.on2.vp9";
                default: return "";
            }
        }
    }

    private static Spec s(String id, String file, String codec, String profile, int w, int h, float fps, int mbps,
                          boolean tenBit, boolean hdr, String audio, String purpose) {
        return new Spec(id, file, codec, profile, w, h, fps, mbps, tenBit, hdr, audio, purpose);
    }

    public static final List<Spec> CATALOG = Collections.unmodifiableList(Arrays.asList(
            s("T01", "T01_h264_1920x1080_30_10M.mp4", "h264", "H.264 High", 1920, 1080, 30, 10, false, false, "aac",
                    "기준선. 이것이 안 되면 재생기 문제"),
            s("T02", "T02_h264_3840x2160_60_40M.mp4", "h264", "H.264 High", 3840, 2160, 60, 40, false, false, "aac",
                    "H.264 4K60"),
            s("T03", "T03_h264_4096x2048_60_50M.mp4", "h264", "H.264 High", 4096, 2048, 60, 50, false, false, "aac",
                    "H.264 VR180 최대 후보"),
            s("T04", "T04_h264_5760x2880_30_60M.mp4", "h264", "H.264 High L6.1", 5760, 2880, 30, 60, false, false,
                    "aac", "H.264 4K 초과(실패 예상, 실패 방식 기록)"),
            s("T05", "T05_hevc_3840x2160_60_30M.mp4", "hevc", "HEVC Main", 3840, 2160, 60, 30, false, false, "aac",
                    "HEVC 기준선"),
            s("T06", "T06_hevc_5760x2880_60_50M.mp4", "hevc", "HEVC Main", 5760, 2880, 60, 50, false, false, "aac",
                    "VR180·360 안전 등급"),
            s("T07", "T07_hevc_7680x3840_60_80M.mp4", "hevc", "HEVC Main", 7680, 3840, 60, 80, false, false, "aac",
                    "VR180 권장 등급"),
            s("T08", "T08_hevc_8192x4096_60_100M.mp4", "hevc", "HEVC Main", 8192, 4096, 60, 100, false, false, "aac",
                    "디코더 최대값"),
            s("T09", "T09_hevc_5760x5760_60_100M.mp4", "hevc", "HEVC Main", 5760, 5760, 60, 100, false, false, "aac",
                    "360 위아래 최대값"),
            s("T10", "T10_hevc10_8192x4096_60_100M.mp4", "hevc", "HEVC Main10", 8192, 4096, 60, 100, true, false,
                    "aac", "10bit 8K60"),
            s("T11", "T11_hevc_8192x4096_60_150M.mp4", "hevc", "HEVC Main", 8192, 4096, 60, 150, false, false, "aac",
                    "비트레이트 상한"),
            s("T12", "T12_hevc_3840x2160_120_50M.mp4", "hevc", "HEVC Main", 3840, 2160, 120, 50, false, false, "aac",
                    "고fps(120Hz 화면)"),
            s("T13", "T13_av1_8192x4096_60_60M.mp4", "av1", "AV1 Main", 8192, 4096, 60, 60, false, false, "aac",
                    "AV1 8K60"),
            s("T14", "T14_av1-10_5760x2880_60_40M.mp4", "av1", "AV1 Main 10bit", 5760, 2880, 60, 40, true, false,
                    "aac", "AV1 10bit"),
            s("T15", "T15_hevc_3840x1920_30_30M_opus.mkv", "hevc", "HEVC Main", 3840, 1920, 30, 30, false, false,
                    "opus", "MKV 컨테이너와 Opus 소리"),
            s("T16", "T16_hevc10-hdr10_3840x2160_60_40M.mp4", "hevc", "HEVC Main10 HDR10(PQ)", 3840, 2160, 60, 40,
                    true, true, "aac", "HDR10 표시(추가 항목)"),
            s("T17", "T17_h264_1920x1080_30_10M_ac3.mp4", "h264", "H.264 High", 1920, 1080, 30, 10, false, false,
                    "ac3", "돌비 AC-3 5.1 소리(추가 항목)"),
            s("T18", "T18_h264_1920x1080_30_10M_eac3.mp4", "h264", "H.264 High", 1920, 1080, 30, 10, false, false,
                    "eac3", "돌비 E-AC-3 5.1 소리(추가 항목)")));

    /** Seconds of playback measured per test (the videos are 20 s long). */
    public static final int MEASURE_SECONDS = 20;

    public static Spec byId(String id) {
        for (Spec s : CATALOG) {
            if (s.id.equalsIgnoreCase(id)) return s;
        }
        return null;
    }

    private static final Pattern NAME = Pattern.compile(
            "^(T\\d{2})_([a-z0-9]+)(?:-[a-z0-9]+)?_(\\d+)x(\\d+)_(\\d+)_(\\d+)M.*\\.(mp4|mkv|mov|webm)$",
            Pattern.CASE_INSENSITIVE);

    /**
     * The spec for a file in the test folder: the catalog entry with the same id, or one parsed from
     * the name pattern "Tnn_codec_WxH_fps_rateM..." for extra tests; null when the name does not fit.
     */
    public static Spec forFile(String fileName) {
        Matcher m = NAME.matcher(fileName == null ? "" : fileName);
        if (!m.matches()) return null;
        Spec known = byId(m.group(1));
        if (known != null) return known;
        String codec = m.group(2).toLowerCase(Locale.ROOT);
        boolean ten = codec.endsWith("10");
        if (ten) codec = codec.substring(0, codec.length() - 2);
        return new Spec(m.group(1).toUpperCase(Locale.ROOT), fileName, codec, codec, Integer.parseInt(m.group(3)),
                Integer.parseInt(m.group(4)), Float.parseFloat(m.group(5)), Integer.parseInt(m.group(6)), ten, false,
                "", "추가 시험 영상");
    }

    /** Test files present in a folder listing, in test-id order (unknown names skipped). */
    public static List<String> pickTestFiles(List<String> names) {
        List<String> out = new ArrayList<>();
        for (String n : names) {
            if (forFile(n) != null) out.add(n);
        }
        Collections.sort(out, String.CASE_INSENSITIVE_ORDER);
        return out;
    }
}
