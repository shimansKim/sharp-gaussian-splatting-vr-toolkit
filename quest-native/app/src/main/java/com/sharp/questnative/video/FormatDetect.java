package com.sharp.questnative.video;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Detects the VR layout of a video from its file name, resolution and spatial metadata.
 * Java port of quest-app/src/viewers/media/format-detect.js (same rules, same layout names), kept
 * free of Android classes so it runs in JVM unit tests (app/src/test/.../FormatDetectTest.java).
 * Owner: video-dev.
 */
public final class FormatDetect {
    private FormatDetect() {}

    /** Layout names, identical to quest-app MediaLayout and to OpenRequest.layoutHint. */
    public static final String MONO2D = "mono2d";
    public static final String MONO360 = "mono360";
    public static final String TB360 = "tb360";
    public static final String SBS360 = "sbs360";
    public static final String SBS180 = "sbs180";
    public static final String MONO180 = "mono180";
    public static final String SBS_SCREEN_FULL = "sbsScreenFull";
    public static final String SBS_SCREEN_HALF = "sbsScreenHalf";
    public static final String TB_SCREEN = "tbScreen";

    /** Order used when the person cycles through layouts (quest-app LAYOUT_ORDER). */
    public static final List<String> LAYOUT_ORDER = Arrays.asList(SBS180, MONO180, MONO360, TB360, SBS360,
            SBS_SCREEN_FULL, SBS_SCREEN_HALF, TB_SCREEN, MONO2D);

    public static boolean isLayout(String value) {
        return value != null && LAYOUT_ORDER.contains(value);
    }

    public static String nextLayout(String current, int step) {
        int i = LAYOUT_ORDER.indexOf(current);
        int n = LAYOUT_ORDER.size();
        if (i < 0) return LAYOUT_ORDER.get(0);
        return LAYOUT_ORDER.get(((i + step) % n + n) % n);
    }

    /** Korean label shown in the HUD (quest-app LAYOUTS[].label). */
    public static String label(String layout) {
        switch (layout) {
            case MONO2D: return "2D 일반 화면";
            case MONO360: return "360° 모노";
            case TB360: return "360° 3D 위아래(TB)";
            case SBS360: return "360° 3D 좌우(SBS)";
            case SBS180: return "VR180 3D 좌우(SBS)";
            case MONO180: return "VR180 모노";
            case SBS_SCREEN_FULL: return "3D 스크린 Full SBS";
            case SBS_SCREEN_HALF: return "3D 스크린 Half SBS";
            case TB_SCREEN: return "3D 스크린 위아래(TB)";
            default: return layout;
        }
    }

    // ------------------------------------------------------------------ name hints

    public static final class NameHints {
        public String projection;  // "360", "180" or null
        public String stereo;      // "sbs", "tb", "mono" or null
        public boolean half;
        public boolean full;
        public final List<String> hints = new ArrayList<>();
    }

    private static final Pattern NON_ALNUM = Pattern.compile("[^a-z0-9]+");

    /** Lowercase base name (no folder, no extension). */
    static String baseName(String name) {
        String s = name == null ? "" : name;
        int slash = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
        String file = slash >= 0 ? s.substring(slash + 1) : s;
        int dot = file.lastIndexOf('.');
        if (dot >= 0) file = file.substring(0, dot);
        return file.toLowerCase(Locale.ROOT);
    }

    static List<String> tokens(String base) {
        List<String> out = new ArrayList<>();
        for (String t : NON_ALNUM.split(base)) {
            if (!t.isEmpty()) out.add(t);
        }
        return out;
    }

    private static boolean has(List<String> tokens, String... keys) {
        for (String k : keys) {
            if (tokens.contains(k)) return true;
        }
        return false;
    }

    private static boolean find(String regex, String s) {
        return Pattern.compile(regex).matcher(s).find();
    }

    public static NameHints parseNameHints(String name) {
        String base = baseName(name);
        List<String> t = tokens(base);
        NameHints h = new NameHints();

        if (has(t, "360", "vr360", "equirect", "equirectangular", "spherical") || find("vr360|360vr", base)) {
            h.projection = "360";
            h.hints.add("이름에 360");
        }
        if (has(t, "180", "vr180", "fisheye180") || find("vr180", base)) {
            h.projection = "180";
            h.hints.add("이름에 180");
        }

        if (has(t, "hsbs", "halfsbs", "half-sbs") || find("half[-_ ]?sbs", base)) {
            h.stereo = "sbs";
            h.half = true;
            h.hints.add("이름에 HSBS");
        } else if (has(t, "fsbs", "fullsbs") || find("full[-_ ]?sbs", base)) {
            h.stereo = "sbs";
            h.full = true;
            h.hints.add("이름에 FSBS");
        } else if (has(t, "sbs", "lr", "3dh", "leftright", "sidebyside") || find("side[-_ ]?by[-_ ]?side", base)) {
            h.stereo = "sbs";
            h.hints.add("이름에 SBS/LR");
        } else if (has(t, "tb", "ou", "htb", "ftb", "3dv", "topbottom", "overunder")
                || find("over[-_ ]?under|top[-_ ]?bottom", base)) {
            h.stereo = "tb";
            h.hints.add("이름에 TB/OU");
        } else if (has(t, "mono", "2d")) {
            h.stereo = "mono";
            h.hints.add("이름에 mono");
        }
        if (h.stereo == null && has(t, "3d")) h.hints.add("이름에 3D(좌우/위아래 불명)");
        return h;
    }

    // ------------------------------------------------------------------ spatial metadata

    /** Spatial metadata from the container (st3d / sv3d), see {@link SpatialMeta}. */
    public static final class Spatial {
        public String stereoMode;  // "mono", "top-bottom", "left-right" or null
        public String projection;  // "equirect", "cubemap", "mesh", "rect" or null
        public double[] equirectBounds;  // {top, bottom, left, right} in 0..1, or null

        public Spatial(String stereoMode, String projection, double[] equirectBounds) {
            this.stereoMode = stereoMode;
            this.projection = projection;
            this.equirectBounds = equirectBounds;
        }
    }

    /** Returns {projection, stereo} (either may be null), or null when the metadata says nothing. */
    static String[] hintsFromSpatial(Spatial spatial) {
        if (spatial == null) return null;
        String stereo = null;
        if ("left-right".equals(spatial.stereoMode)) stereo = "sbs";
        else if ("top-bottom".equals(spatial.stereoMode)) stereo = "tb";
        else if ("mono".equals(spatial.stereoMode)) stereo = "mono";

        String projection = null;
        if ("equirect".equals(spatial.projection)) {
            double[] b = spatial.equirectBounds;
            // left + right near 0.5 means only 180 degrees horizontally: VR180.
            projection = (b != null && b[2] + b[3] >= 0.45) ? "180" : "360";
        }
        if (projection == null && stereo == null) return null;
        return new String[] {projection, stereo};
    }

    // ------------------------------------------------------------------ detection

    public static final class Result {
        public final String layout;
        public final String confidence;  // "high", "medium", "low"
        public final List<String> reasons;

        Result(String layout, String confidence, List<String> reasons) {
            this.layout = layout;
            this.confidence = confidence;
            this.reasons = reasons;
        }

        public String reasonText() {
            return String.join(", ", reasons);
        }
    }

    private static String stereoFromRatio360(double ratio) {
        if (ratio >= 3.2) return "sbs";
        if (ratio <= 1.25) return "tb";
        return "mono";
    }

    private static String fmt(double v) {
        return String.format(Locale.ROOT, "%.2f", v);
    }

    /** Priority: container spatial metadata > name hints > aspect ratio (same as quest-app). */
    public static Result detect(String name, int width, int height, Spatial spatial) {
        double ratio = width > 0 && height > 0 ? (double) width / height : 0;
        NameHints nh = parseNameHints(name);
        String[] meta = hintsFromSpatial(spatial);
        List<String> reasons = new ArrayList<>();

        String projection = nh.projection;
        String stereo = nh.stereo;
        boolean fromMeta = false;
        if (meta != null) {
            if (meta[0] != null) projection = meta[0];
            if (meta[1] != null) stereo = meta[1];
            fromMeta = true;
            reasons.add("MP4 공간 메타데이터(st3d/sv3d)");
        } else {
            reasons.addAll(nh.hints);
        }

        if ("360".equals(projection)) {
            String st = "mono".equals(stereo) ? "mono"
                    : stereo != null ? stereo : (ratio > 0 ? stereoFromRatio360(ratio) : "mono");
            String layout = "sbs".equals(st) ? SBS360 : "tb".equals(st) ? TB360 : MONO360;
            boolean strong = fromMeta || stereo != null || ratio == 0;
            if (stereo == null && ratio > 0) reasons.add("비율 " + fmt(ratio) + ":1로 입체 방식 추정");
            return new Result(layout, strong ? "high" : "medium", reasons);
        }

        if ("180".equals(projection)) {
            String st = stereo;
            if (st == null || "tb".equals(st)) {
                // There is no TB 180 layout; pick SBS or mono by aspect ratio.
                if (ratio > 0 && ratio >= 1.6) st = "sbs";
                else if (ratio > 0 && ratio <= 1.25) st = "mono";
                else st = "tb".equals(st) ? "mono" : "sbs";
            }
            return new Result("mono".equals(st) ? MONO180 : SBS180, "high", reasons);
        }

        if ("sbs".equals(stereo)) {
            if (nh.half) return new Result(SBS_SCREEN_HALF, "high", reasons);
            if (nh.full) return new Result(SBS_SCREEN_FULL, "high", reasons);
            if (ratio >= 1.9 && ratio <= 2.15) {
                reasons.add("SBS 이름 + 비율 " + fmt(ratio) + ":1 → VR180으로 추정");
                return new Result(SBS180, "medium", reasons);
            }
            if (ratio >= 2.6) {
                reasons.add("SBS 이름 + 비율 " + fmt(ratio) + ":1 → Full SBS");
                return new Result(SBS_SCREEN_FULL, "medium", reasons);
            }
            if (ratio > 0) reasons.add("SBS 이름 + 비율 " + fmt(ratio) + ":1 → Half SBS");
            return new Result(SBS_SCREEN_HALF, "medium", reasons);
        }
        if ("tb".equals(stereo)) {
            if (ratio >= 0.95 && ratio <= 1.1) {
                reasons.add("비율 1:1 → 360 TB로 추정");
                return new Result(TB360, "medium", reasons);
            }
            return new Result(TB_SCREEN, "medium", reasons);
        }
        if ("mono".equals(stereo)) {
            if (ratio >= 1.9 && ratio <= 2.15) {
                reasons.add("비율 2:1 → 360으로 추정");
                return new Result(MONO360, "medium", reasons);
            }
            return new Result(MONO2D, "medium", reasons);
        }

        // No hints at all.
        if (ratio == 0) {
            reasons.add("해상도 정보 없음");
            return new Result(MONO2D, "low", reasons);
        }
        if (nh.hints.isEmpty() && baseName(name).contains("3d")) reasons.add("이름에 3D");
        if (ratio >= 3.8 && ratio <= 4.2) {
            reasons.add("비율 " + fmt(ratio) + ":1 → 360 SBS로 추정");
            return new Result(SBS360, "low", reasons);
        }
        if (ratio >= 2.6) {
            reasons.add("비율 " + fmt(ratio) + ":1 → Full SBS 스크린으로 추정");
            return new Result(SBS_SCREEN_FULL, "low", reasons);
        }
        if (ratio >= 1.9 && ratio <= 2.15) {
            reasons.add("비율 2:1 → 360 모노로 추정(VR180이면 형식을 바꾸세요)");
            return new Result(MONO360, "low", reasons);
        }
        if (ratio >= 0.95 && ratio <= 1.05) {
            reasons.add("비율 1:1 → 360 TB로 추정");
            return new Result(TB360, "low", reasons);
        }
        reasons.add("일반 비율 " + fmt(ratio) + ":1");
        return new Result(MONO2D, "low", reasons);
    }

    /**
     * Width / height of one eye's picture on a virtual screen. Full SBS is (w/2):h; Half SBS and 2D
     * are w:h; TB is w:(h/2) when the frame is taller than 1.2:1 (Full TB), else w:h (Half TB).
     */
    public static double eyeAspect(String layout, int width, int height) {
        double w = width > 0 ? width : 16;
        double h = height > 0 ? height : 9;
        switch (layout) {
            case SBS_SCREEN_FULL:
                return w / 2 / h;
            case TB_SCREEN:
                return w / h < 1.2 ? w / (h / 2) : w / h;
            default:
                return w / h;
        }
    }

    // ------------------------------------------------------------------ frame sniffing

    /** Normalized correlation of two equal regions (row means removed), best over +-shift. */
    private static double halvesCorrelation(int[] luma, int width, int ax0, int ay0, int bx0, int by0, int w, int h,
                                            int shift) {
        double best = -1;
        for (int s = -shift; s <= shift; s++) {
            double sumXY = 0, sumXX = 0, sumYY = 0;
            for (int y = 0; y < h; y++) {
                int rowA = (ay0 + y) * width + ax0;
                int rowB = (by0 + y) * width + bx0;
                int x0 = Math.max(0, -s);
                int x1 = Math.min(w, w - s);
                if (x1 - x0 < 4) continue;
                double meanA = 0, meanB = 0;
                for (int x = x0; x < x1; x++) {
                    meanA += luma[rowA + x];
                    meanB += luma[rowB + x + s];
                }
                meanA /= x1 - x0;
                meanB /= x1 - x0;
                for (int x = x0; x < x1; x++) {
                    double da = luma[rowA + x] - meanA;
                    double db = luma[rowB + x + s] - meanB;
                    sumXY += da * db;
                    sumXX += da * da;
                    sumYY += db * db;
                }
            }
            double denom = Math.sqrt(sumXX * sumYY);
            if (denom > 0) best = Math.max(best, sumXY / denom);
        }
        return best;
    }

    /**
     * Looks at one frame (luma 0..255) and says whether the left/right or top/bottom halves look like
     * a stereo pair. Returns "sbs", "tb", "mono", or null when the frame is too flat to judge.
     */
    public static String sniffStereo(int[] luma, int width, int height) {
        if (luma == null || width < 16 || height < 16 || luma.length < width * height) return null;
        double sum = 0, sumSq = 0;
        int n = width * height;
        for (int i = 0; i < n; i++) {
            sum += luma[i];
            sumSq += (double) luma[i] * luma[i];
        }
        double mean = sum / n;
        double std = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
        if (std < 6) return null;
        int hw = width / 2;
        int hh = height / 2;
        int shiftX = Math.max(2, (int) Math.round(hw * 0.06));
        double sbs = halvesCorrelation(luma, width, 0, 0, hw, 0, hw, height, shiftX);
        double tb = halvesCorrelation(luma, width, 0, 0, 0, hh, width, hh, Math.max(2, (int) Math.round(width * 0.03)));
        final double threshold = 0.8;
        if (sbs >= threshold && sbs >= tb + 0.05) return "sbs";
        if (tb >= threshold && tb >= sbs + 0.05) return "tb";
        return "mono";
    }

    /** Refines a ratio-only ("low") guess with the frame sniff result. */
    public static Result refineWithSniff(Result detected, String sniff, double ratio) {
        if (detected == null || !"low".equals(detected.confidence) || sniff == null) return detected;
        if (MONO360.equals(detected.layout) && ratio >= 1.9 && ratio <= 2.15 && "sbs".equals(sniff)) {
            List<String> r = new ArrayList<>(detected.reasons);
            r.add("화면 내용을 보니 좌우 그림이 거의 같아 VR180 좌우(SBS)로 판단");
            return new Result(SBS180, "medium", r);
        }
        if (TB360.equals(detected.layout) && "mono".equals(sniff)) {
            List<String> r = new ArrayList<>(detected.reasons);
            r.add("화면 내용을 보니 위아래 그림이 달라 360 모노로 판단");
            return new Result(MONO360, "low", r);
        }
        return detected;
    }
}
