package com.sharp.questnative.video;

/**
 * Turns Media3's Format.stereoMode / Format.projectionData into {@link FormatDetect.Spatial}.
 *
 * Media3 reads the MP4 st3d box into Format.stereoMode and keeps the sv3d "proj" box bytes in
 * Format.projectionData (Matroska: the ProjectionPrivate payload). We look for the equi / cbmp /
 * mshp child and read the equirect projection bounds (0.32 fixed point), like quest-app mp4-meta.js.
 * No Android or Media3 classes here, so JVM unit tests can run it. Owner: video-dev.
 */
public final class SpatialMeta {
    private SpatialMeta() {}

    // Same values as androidx.media3.common.C.STEREO_MODE_* and Format.NO_VALUE.
    public static final int STEREO_NONE = -1;
    public static final int STEREO_MONO = 0;
    public static final int STEREO_TOP_BOTTOM = 1;
    public static final int STEREO_LEFT_RIGHT = 2;
    public static final int STEREO_MESH = 3;

    /** Returns null when neither field carries information. */
    public static FormatDetect.Spatial fromFormat(int stereoMode, byte[] projectionData) {
        String stereo = null;
        switch (stereoMode) {
            case STEREO_MONO: stereo = "mono"; break;
            case STEREO_TOP_BOTTOM: stereo = "top-bottom"; break;
            case STEREO_LEFT_RIGHT: stereo = "left-right"; break;
            default: break;  // NONE, MESH (per-eye meshes: no simple layout)
        }
        String projection = null;
        double[] bounds = null;
        if (projectionData != null && projectionData.length >= 8) {
            Object[] p = parseProjection(projectionData, 0, projectionData.length, 0);
            if (p != null) {
                projection = (String) p[0];
                bounds = (double[]) p[1];
            }
        }
        if (stereo == null && projection == null) return null;
        return new FormatDetect.Spatial(stereo, projection, bounds);
    }

    private static long u32(byte[] b, int o) {
        return ((b[o] & 0xFFL) << 24) | ((b[o + 1] & 0xFFL) << 16) | ((b[o + 2] & 0xFFL) << 8) | (b[o + 3] & 0xFFL);
    }

    private static String type(byte[] b, int o) {
        return new String(new char[] {(char) (b[o] & 0xFF), (char) (b[o + 1] & 0xFF), (char) (b[o + 2] & 0xFF),
                (char) (b[o + 3] & 0xFF)});
    }

    /** Walks boxes in [start, end). Returns {projection, bounds} or null. */
    private static Object[] parseProjection(byte[] b, int start, int end, int depth) {
        if (depth > 4) return null;
        int o = start;
        while (o + 8 <= end) {
            long size = u32(b, o);
            String t = type(b, o + 4);
            int header = 8;
            if (size == 1) {
                if (o + 16 > end) return null;
                size = (u32(b, o + 8) << 32) | u32(b, o + 12);
                header = 16;
            } else if (size == 0) {
                size = end - o;
            }
            if (size < header || o + size > end) return null;
            int body = o + header;
            int boxEnd = (int) (o + size);
            switch (t) {
                case "equi": {
                    double[] bounds = null;
                    // FullBox: version(1) flags(3), then top, bottom, left, right (uint32, 0.32 fixed).
                    if (boxEnd - body >= 20) {
                        double f = 4294967296.0;
                        bounds = new double[] {u32(b, body + 4) / f, u32(b, body + 8) / f, u32(b, body + 12) / f,
                                u32(b, body + 16) / f};
                    }
                    return new Object[] {"equirect", bounds};
                }
                case "cbmp":
                    return new Object[] {"cubemap", null};
                case "mshp":
                    return new Object[] {"mesh", null};
                case "proj":
                case "sv3d": {
                    Object[] inner = parseProjection(b, body, boxEnd, depth + 1);
                    if (inner != null) return inner;
                    break;
                }
                default:
                    break;
            }
            o = boxEnd;
        }
        return null;
    }
}
