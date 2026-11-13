package com.sharp.questnative.ui;

import android.graphics.Canvas;
import android.graphics.Paint;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Picks a font size and line split so a label is not cut off (port of quest-app core/label-fit.js):
 * big one line -> smaller one line -> two lines split per character -> smallest size with "…".
 * "\n" in the label is kept. Owner: ui.
 */
final class LabelFit {
    static final float[] DEFAULT_SIZES = {28, 26, 24, 22};

    static final class Fit {
        float size;
        List<String> lines;
        boolean truncated;
    }

    private LabelFit() {}

    static Fit fit(Paint paint, String text, float maxWidth, float[] sizes, int maxLines, float maxHeight,
                   float lineGap) {
        List<String> explicit = Arrays.asList(text.split("\n", -1));
        float original = paint.getTextSize();
        try {
            if (explicit.size() <= maxLines) {
                for (float size : sizes) {
                    if (heightOk(size, explicit.size(), maxHeight, lineGap) && fitsAll(paint, size, explicit, maxWidth)) {
                        return result(size, explicit, false);
                    }
                }
            }
            if (explicit.size() == 1 && maxLines >= 2) {
                for (float size : sizes) {
                    if (!heightOk(size, 2, maxHeight, lineGap)) continue;
                    paint.setTextSize(size);
                    Fit w = wrap(paint, explicit.get(0), maxWidth, maxLines);
                    if (!w.truncated) return result(size, w.lines, false);
                }
            }
            float size = sizes[sizes.length - 1];
            for (int i = sizes.length - 1; i >= 0; i--) {
                if (heightOk(sizes[i], Math.min(maxLines, explicit.size()), maxHeight, lineGap)) {
                    size = sizes[i];
                    break;
                }
            }
            paint.setTextSize(size);
            if (explicit.size() > 1) {
                List<String> out = new ArrayList<>();
                boolean truncated = false;
                for (int i = 0; i < Math.min(maxLines, explicit.size()); i++) {
                    String line = explicit.get(i);
                    truncated |= paint.measureText(line) > maxWidth;
                    out.add(ellipsize(paint, line, maxWidth));
                }
                return result(size, out, truncated);
            }
            Fit w = wrap(paint, explicit.get(0), maxWidth, maxLines);
            return result(size, w.lines, w.truncated);
        } finally {
            paint.setTextSize(original);
        }
    }

    /** Draws a fitted label centred on (cx, cy), or left-aligned at x when left is true. */
    static Fit draw(Canvas c, Paint paint, String text, float cx, float cy, float maxWidth, float[] sizes,
                    int maxLines, float maxHeight, boolean left, float x) {
        Fit f = fit(paint, text, maxWidth, sizes, maxLines, maxHeight, 1.2f);
        float original = paint.getTextSize();
        paint.setTextSize(f.size);
        paint.setTextAlign(left ? Paint.Align.LEFT : Paint.Align.CENTER);
        Paint.FontMetrics fm = paint.getFontMetrics();
        float step = f.size * 1.2f;
        float top = cy - (f.lines.size() - 1) * step / 2f;
        for (int i = 0; i < f.lines.size(); i++) {
            float baseline = top + i * step - (fm.ascent + fm.descent) / 2f;
            c.drawText(f.lines.get(i), left ? x : cx, baseline, paint);
        }
        paint.setTextSize(original);
        return f;
    }

    static String ellipsize(Paint paint, String text, float maxWidth) {
        if (paint.measureText(text) <= maxWidth) return text;
        String out = text;
        while (out.length() > 1 && paint.measureText(out + "…") > maxWidth) {
            out = out.substring(0, out.offsetByCodePoints(out.length(), -1));
        }
        return out + "…";
    }

    private static Fit wrap(Paint paint, String text, float maxWidth, int maxLines) {
        List<String> lines = new ArrayList<>();
        StringBuilder line = new StringBuilder();
        int i = 0;
        while (i < text.length()) {
            int cp = text.codePointAt(i);
            String ch = new String(Character.toChars(cp));
            i += Character.charCount(cp);
            if (line.length() > 0 && paint.measureText(line + ch) > maxWidth) {
                if (lines.size() == maxLines - 1) {
                    lines.add(ellipsize(paint, line + ch, maxWidth));
                    Fit f = new Fit();
                    f.lines = lines;
                    f.truncated = true;
                    return f;
                }
                lines.add(line.toString());
                line.setLength(0);
                if (!ch.equals(" ")) line.append(ch);
            } else {
                line.append(ch);
            }
        }
        if (line.length() > 0) lines.add(line.toString());
        Fit f = new Fit();
        f.lines = lines;
        f.truncated = false;
        return f;
    }

    private static boolean heightOk(float size, int lines, float maxHeight, float lineGap) {
        return lines * size * lineGap <= maxHeight;
    }

    private static boolean fitsAll(Paint paint, float size, List<String> lines, float maxWidth) {
        paint.setTextSize(size);
        for (String l : lines) {
            if (paint.measureText(l) > maxWidth) return false;
        }
        return true;
    }

    private static Fit result(float size, List<String> lines, boolean truncated) {
        Fit f = new Fit();
        f.size = size;
        f.lines = lines;
        f.truncated = truncated;
        return f;
    }
}
