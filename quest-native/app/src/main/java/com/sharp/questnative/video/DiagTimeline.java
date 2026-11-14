package com.sharp.questnative.video;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * When frames were dropped during one diagnostics measurement: per wall-clock second after the
 * first frame, the dropped and shown frame counts. It tells start-up drops (decoder warm-up, buffer
 * fill) from steady drops (decoder too slow) and late drops (heat). Pure Java (JVM unit tests).
 * Owner: video-dev.
 */
public final class DiagTimeline {
    /** Seconds counted as "start" in the summary. */
    public static final int START_SECONDS = 5;

    public static final String NONE = "없음";
    public static final String START_ONLY = "시작 구간만";
    public static final String STEADY = "꾸준함";
    public static final String LATE = "후반에 몰림";
    public static final String SCATTERED = "드문드문";

    private final List<Long> dropped = new ArrayList<>();
    private final List<Long> rendered = new ArrayList<>();
    private long lastDropped = -1, lastRendered = -1;

    /**
     * One reading of the running counters.
     *
     * @param sinceFirstFrameMs wall time since the first frame was shown (negative = before it;
     *                          those frames count toward second 0)
     */
    public void add(long sinceFirstFrameMs, long droppedTotal, long renderedTotal) {
        int sec = (int) Math.max(0, sinceFirstFrameMs / 1000);
        while (dropped.size() <= sec) {
            dropped.add(0L);
            rendered.add(0L);
        }
        if (lastDropped < 0) {
            lastDropped = 0;
            lastRendered = 0;
        }
        long dd = Math.max(0, droppedTotal - lastDropped);
        long dr = Math.max(0, renderedTotal - lastRendered);
        dropped.set(sec, dropped.get(sec) + dd);
        rendered.set(sec, rendered.get(sec) + dr);
        lastDropped = Math.max(lastDropped, droppedTotal);
        lastRendered = Math.max(lastRendered, renderedTotal);
    }

    public List<Long> droppedPerSecond() {
        return new ArrayList<>(dropped);
    }

    public List<Long> renderedPerSecond() {
        return new ArrayList<>(rendered);
    }

    // ------------------------------------------------------------------ summary (works on the lists so
    // results loaded back from JSON can be summarised the same way)

    public static long sum(List<Long> l, int from, int to) {
        long s = 0;
        for (int i = Math.max(0, from); i < Math.min(to, l.size()); i++) s += l.get(i);
        return s;
    }

    public static int secondsWithDrops(List<Long> d) {
        int n = 0;
        for (long v : d) if (v > 0) n++;
        return n;
    }

    public static int firstDropSecond(List<Long> d) {
        for (int i = 0; i < d.size(); i++) if (d.get(i) > 0) return i;
        return -1;
    }

    public static int lastDropSecond(List<Long> d) {
        for (int i = d.size() - 1; i >= 0; i--) if (d.get(i) > 0) return i;
        return -1;
    }

    /**
     * NONE: no drops. START_ONLY: all inside the first START_SECONDS. LATE: at least two thirds of
     * the drops after the start fall in the last third of the run. STEADY: drops in at least 10% of
     * the seconds after the start (and at least 3 seconds). SCATTERED: anything else.
     */
    public static String pattern(List<Long> d) {
        long total = sum(d, 0, d.size());
        if (total == 0) return NONE;
        long after = sum(d, START_SECONDS, d.size());
        if (after == 0) return START_ONLY;
        int n = d.size();
        long lastThird = sum(d, n - n / 3, n);
        int restSeconds = Math.max(1, n - START_SECONDS);
        int restWithDrops = secondsWithDrops(d.subList(Math.min(START_SECONDS, n), n));
        if (n >= 3 * START_SECONDS && lastThird * 3 >= after * 2 && n - n / 3 >= START_SECONDS) return LATE;
        if (restWithDrops >= 3 && restWithDrops * 10 >= restSeconds) return STEADY;
        return SCATTERED;
    }

    /** Dropped frames per bucket of bucketSeconds, e.g. "0-9초 12 · 10-19초 0". */
    public static String buckets(List<Long> d, int bucketSeconds) {
        StringBuilder sb = new StringBuilder();
        for (int from = 0; from < d.size(); from += bucketSeconds) {
            int to = Math.min(d.size(), from + bucketSeconds);
            if (sb.length() > 0) sb.append(" · ");
            sb.append(from).append('-').append(to - 1).append("초 ").append(sum(d, from, to));
        }
        return sb.toString();
    }

    /** One line for the Markdown table, e.g. "시작 구간만: 첫 5초 12 · 이후 0 · 버린 초 3개(0~2초)". */
    public static String summary(List<Long> d) {
        if (d == null || d.isEmpty()) return "-";
        String p = pattern(d);
        if (NONE.equals(p)) return NONE;
        return String.format(Locale.ROOT, "%s: 첫 %d초 %d · 이후 %d · 버린 초 %d개(%d~%d초)", p, START_SECONDS,
                sum(d, 0, START_SECONDS), sum(d, START_SECONDS, d.size()), secondsWithDrops(d), firstDropSecond(d),
                lastDropSecond(d));
    }
}
