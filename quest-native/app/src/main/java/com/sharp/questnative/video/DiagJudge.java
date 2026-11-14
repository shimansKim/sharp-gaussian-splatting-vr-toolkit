package com.sharp.questnative.video;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * One test video's measurement and its verdict. The pass rule is encoding-guide.md §3.2:
 * a hardware decoder opens it and fewer than 1% of the source frames are dropped while it plays.
 * Pure Java (JVM unit tests). Owner: video-dev.
 */
public final class DiagJudge {
    private DiagJudge() {}

    public static final double MAX_DROPPED_PERCENT = 1.0;
    /** Passing results at or above this are marked "경계" (close to the limit). */
    public static final double BORDER_PERCENT = 0.5;

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
        public double targetSeconds;      // seconds the run meant to measure (file length or cap), 0 = default
        public final List<Long> droppedPerSecond = new ArrayList<>();   // DiagTimeline, second 0 = first frame
        public final List<Long> renderedPerSecond = new ArrayList<>();
        public int thermalStart = -1, thermalEnd = -1;              // PowerManager thermal status, -1 = unknown
        public double batteryTempStartC = Double.NaN, batteryTempEndC = Double.NaN;
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
        double target = m.targetSeconds > 0 ? m.targetSeconds : DiagTests.MEASURE_SECONDS;
        if (m.playedSeconds < target * 0.5) {
            return new Result(Verdict.FAIL, String.format(Locale.ROOT, "재생이 %.1f초만 진행됨(멈추거나 너무 느림)",
                    m.playedSeconds), expected, pct, audioOk);
        }
        if (pct >= MAX_DROPPED_PERCENT) {
            return new Result(Verdict.FAIL, String.format(Locale.ROOT, "버린 프레임 %s%%(%d / %.0f)", fmtPct(pct),
                    m.droppedFrames, expected), expected, pct, audioOk);
        }
        return new Result(Verdict.PASS, String.format(Locale.ROOT, "하드웨어 디코더, 버린 프레임 %s%%%s", fmtPct(pct),
                pct >= BORDER_PERCENT ? "(경계: 1% 기준에 가까움)" : ""), expected, pct, audioOk);
    }

    /**
     * Dropped percent for people: three decimals, cut (not rounded) so a passing 0.9996 shows as
     * 0.999 and never as the failing 1.00.
     */
    public static String fmtPct(double pct) {
        double cut = Math.floor(pct * 1000 + 1e-9) / 1000;
        return String.format(Locale.ROOT, "%.3f", cut);
    }

    /** fmtPct plus " 경계" for a pass at or above BORDER_PERCENT, for tables. */
    public static String pctCell(Result r) {
        String s = fmtPct(r.droppedPercent);
        if (r.verdict == Verdict.PASS && r.droppedPercent >= BORDER_PERCENT) s += " 경계";
        return s;
    }
}
