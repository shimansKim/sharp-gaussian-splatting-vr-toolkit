package com.sharp.questnative.video;

import java.util.Locale;

/**
 * One test video's measurement and its verdict. The pass rule is encoding-guide.md §3.2:
 * a hardware decoder opens it and fewer than 1% of the source frames are dropped while it plays.
 * Pure Java (JVM unit tests). Owner: video-dev.
 */
public final class DiagJudge {
    private DiagJudge() {}

    public static final double MAX_DROPPED_PERCENT = 1.0;

    public enum Verdict { PASS, FAIL, ERROR, INVALID }

    public static final class Measurement {
        public String testId = "", file = "";
        public String decoderName = "";
        public Boolean hardware;          // null = unknown
        public String videoMime = "", videoCodecs = "";
        public int width, height;
        public float fps;                 // from the file (track format), 0 = unknown
        public long firstFrameMs = -1;    // open -> first frame shown
        public double playedSeconds;      // media time that advanced during the measurement
        public long renderedFrames, droppedFrames, skippedFrames;
        public int maxConsecutiveDropped;
        public String audioDecoderName = "";
        public long audioOutputBuffers;   // > 0 means sound was decoded and sent to the output
        public String error = "";         // playback error code and message
        public String invalidReason = ""; // measurement not trustworthy (headset off, cancelled ...)
    }

    public static final class Result {
        public final Verdict verdict;
        public final String reason;       // Korean, one line
        public final double expectedFrames;
        public final double droppedPercent;
        public final boolean audioOk;

        Result(Verdict verdict, String reason, double expectedFrames, double droppedPercent, boolean audioOk) {
            this.verdict = verdict;
            this.reason = reason;
            this.expectedFrames = expectedFrames;
            this.droppedPercent = droppedPercent;
            this.audioOk = audioOk;
        }

        public String label() {
            switch (verdict) {
                case PASS: return "됨";
                case FAIL: return "안 됨";
                case ERROR: return "오류";
                default: return "측정 무효";
            }
        }
    }

    /** True for Android/Google software codecs when MediaCodecInfo could not say. */
    public static boolean looksSoftware(String decoderName) {
        String n = decoderName == null ? "" : decoderName.toLowerCase(Locale.ROOT);
        return n.startsWith("c2.android.") || n.startsWith("omx.google.") || n.contains(".sw.")
                || n.startsWith("c2.google.");
    }

    /**
     * @param specFps frame rate from the test spec, used when the file's track gave none
     */
    public static Result judge(Measurement m, float specFps) {
        boolean audioOk = m.audioOutputBuffers > 0;
        float fps = m.fps > 0 ? m.fps : specFps;
        // Source frames = fps x media seconds played. Without any fps, fall back to the frames the
        // decoder handled (that would hide drops slightly, so it is only the last resort).
        double expected = fps > 0 && m.playedSeconds > 0 ? fps * m.playedSeconds
                : m.renderedFrames + m.droppedFrames + m.skippedFrames;
        double pct = expected > 0 ? 100.0 * m.droppedFrames / expected : 0;

        if (m.invalidReason != null && !m.invalidReason.isEmpty()) {
            return new Result(Verdict.INVALID, m.invalidReason, expected, pct, audioOk);
        }
        if (m.error != null && !m.error.isEmpty()) {
            return new Result(Verdict.ERROR, "재생 오류: " + m.error, expected, pct, audioOk);
        }
        if (m.renderedFrames == 0) {
            return new Result(Verdict.FAIL, "화면에 나온 프레임이 없음", expected, pct, audioOk);
        }
        boolean hw = m.hardware != null ? m.hardware : !looksSoftware(m.decoderName);
        if (!hw) {
            return new Result(Verdict.FAIL, "소프트웨어 디코더(" + m.decoderName + ")", expected, pct, audioOk);
        }
        if (m.playedSeconds < DiagTests.MEASURE_SECONDS * 0.5) {
            return new Result(Verdict.FAIL, String.format(Locale.ROOT, "재생이 %.1f초만 진행됨(멈추거나 너무 느림)",
                    m.playedSeconds), expected, pct, audioOk);
        }
        if (pct >= MAX_DROPPED_PERCENT) {
            return new Result(Verdict.FAIL, String.format(Locale.ROOT, "버린 프레임 %.2f%%(%d / %.0f)", pct,
                    m.droppedFrames, expected), expected, pct, audioOk);
        }
        return new Result(Verdict.PASS, String.format(Locale.ROOT, "하드웨어 디코더, 버린 프레임 %.2f%%", pct), expected,
                pct, audioOk);
    }
}
