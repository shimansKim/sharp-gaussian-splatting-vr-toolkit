package com.sharp.questnative.image;

/** Independent approximate equidistant projection. Angles/FOV are not a manufacturer specification. */
public final class DualFisheye {
    private DualFisheye() {}
    public static final class Calibration {
        final double[] cx = new double[2], cy = new double[2], radius = new double[2];
        final boolean estimated;
        Calibration(boolean estimated) { this.estimated = estimated; }
    }
    public static Calibration defaults(int width, int height) {
        Calibration c = new Calibration(true);
        c.cx[0] = width * .25; c.cx[1] = width * .75;
        c.cy[0] = c.cy[1] = height * .5;
        c.radius[0] = c.radius[1] = Math.min(width * .25, height * .5);
        return c;
    }
    /** Observed older calibration order is tentatively radius, x, y, three angles per lens. */
    public static Calibration calibration(String text, int width, int height) {
        if (text == null || text.isEmpty()) return defaults(width, height);
        String[] p = text.split("_", -1);
        // Two observed older files have an additional numeric suffix of unknown meaning.
        if ((p.length != 15 && !(p.length == 16 && "2323".equals(p[15]))) || !"2".equals(p[0])) return null;
        try {
            double refW = Double.parseDouble(p[13]), refH = Double.parseDouble(p[14]);
            if (!Double.isFinite(refW) || !Double.isFinite(refH) || refW <= 0 || refH <= 0 || Math.abs(refW / refH - 2) > .1) return null;
            Calibration c = new Calibration(false);
            for (int i = 0; i < 2; i++) {
                int j = 1 + i * 6;
                double r = Double.parseDouble(p[j]), x = Double.parseDouble(p[j + 1]), y = Double.parseDouble(p[j + 2]);
                for (int k = 0; k < 6; k++) if (!Double.isFinite(Double.parseDouble(p[j + k]))) return null;
                c.cx[i] = x / refW * width; c.cy[i] = y / refH * height;
                c.radius[i] = r / refH * height;
                if (r < refH * .2 || r > refH * .55 || c.cx[i] < 0 || c.cx[i] >= width || c.cy[i] < 0 || c.cy[i] >= height) return null;
            }
            return c;
        } catch (NumberFormatException e) { return null; }
    }
    /** Bilinear RGB sampling with edge clamping. */
    public static int sample(int[] pixels, int width, int height, double x, double y) {
        x = Math.max(0, Math.min(width - 1, x));
        y = Math.max(0, Math.min(height - 1, y));
        int x0 = (int) x, y0 = (int) y;
        int x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
        double dx = x - x0, dy = y - y0;
        int a = pixels[y0 * width + x0], b = pixels[y0 * width + x1];
        int c = pixels[y1 * width + x0], d = pixels[y1 * width + x1];
        int color = 0xff000000;
        for (int shift = 0; shift <= 16; shift += 8) {
            double top = ((a >>> shift) & 255) * (1 - dx) + ((b >>> shift) & 255) * dx;
            double bottom = ((c >>> shift) & 255) * (1 - dx) + ((d >>> shift) & 255) * dx;
            color |= (int) Math.round(top * (1 - dy) + bottom * dy) << shift;
        }
        return color;
    }
    /** Returns the two source positions and blend weight. 200 degrees is an empirical approximation. */
    public static void map(double u, double v, Calibration c, double[] out) {
        double lon = (u - .5) * 2 * Math.PI, lat = (.5 - v) * Math.PI;
        double x = Math.cos(lat) * Math.sin(lon), y = Math.sin(lat), z = Math.cos(lat) * Math.cos(lon);
        double planar = Math.hypot(x, y);
        double nx = planar < 1e-12 ? 0 : x / planar, ny = planar < 1e-12 ? 0 : y / planar;
        double a = Math.acos(Math.max(-1, Math.min(1, z))), b = Math.PI - a;
        double r0 = c.radius[0] * a / Math.toRadians(100), r1 = c.radius[1] * b / Math.toRadians(100);
        // Axis mapping and opposed lens orientation are inferred from two photos, not a format guarantee.
        double t = Math.max(0, Math.min(1, (Math.toRadians(100) - a) / Math.toRadians(20)));
        t = t * t * (3 - 2 * t);
        out[0] = c.cx[0] + ny * r0; out[1] = c.cy[0] + nx * r0;
        out[2] = c.cx[1] - ny * r1; out[3] = c.cy[1] + nx * r1; out[4] = t;
    }
}
