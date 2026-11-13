package com.sharp.questnative.ui;

import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;

import java.util.List;
import java.util.Locale;

/** Standard widgets: button/toggle, slider/seek bar, choice (◀ ▶), label. Owner: ui. */
final class Widgets {
    private Widgets() {}

    interface ValueListener {
        /** phase: 0 change (dragging), 1 commit. */
        void onValue(float value, int phase);
    }

    static String formatValue(String format, float v) {
        switch (format) {
            case "time": {
                int s = Math.max(0, Math.round(v));
                return s >= 3600 ? String.format(Locale.ROOT, "%d:%02d:%02d", s / 3600, (s / 60) % 60, s % 60)
                        : String.format(Locale.ROOT, "%d:%02d", s / 60, s % 60);
            }
            case "percent":
                return Math.round(v * 100) + "%";
            case "x":
                return (Math.abs(v - Math.round(v)) < 0.001f ? String.valueOf(Math.round(v))
                        : String.format(Locale.ROOT, "%.2f", v).replaceAll("0$", "")) + "x";
            default:
                return "";
        }
    }

    /** Button; when toggle is true it shows an on/off state. */
    static final class Button extends Widget {
        String label, icon;
        boolean toggle, on;
        Runnable onClick;
        private final Paint bg = Theme.fill(Theme.BUTTON);
        private final Paint text = Theme.text(Theme.TEXT, 26, false);

        Button(String id, String label, String icon, Runnable onClick) {
            this.id = id;
            this.label = label == null ? "" : label;
            this.icon = icon == null ? "" : icon;
            this.onClick = onClick;
        }

        @Override
        void draw(Canvas c) {
            bg.setColor(!enabled ? Theme.BUTTON : pressed ? Theme.BUTTON_PRESSED : (toggle && on) ? Theme.BUTTON_ON
                    : hovered ? Theme.BUTTON_HOVER : Theme.BUTTON);
            c.drawRoundRect(bounds, Theme.RADIUS, Theme.RADIUS, bg);
            int color = enabled ? Theme.TEXT : Theme.TEXT_DISABLED;
            text.setColor(color);
            float h = bounds.height();
            boolean hasIcon = Icons.has(icon);
            if (hasIcon && label.isEmpty()) {
                Icons.draw(c, icon, bounds.centerX(), bounds.centerY(), Math.min(h, bounds.width()) * 0.5f, color);
                return;
            }
            float left = bounds.left + 12;
            if (hasIcon) {
                float iconSize = h * 0.45f;
                Icons.draw(c, icon, left + iconSize / 2f + 4, bounds.centerY(), iconSize, color);
                left += iconSize + 14;
            }
            float maxW = bounds.right - 12 - left;
            LabelFit.draw(c, text, label, (left + bounds.right - 12) / 2f, bounds.centerY(), maxW,
                    LabelFit.DEFAULT_SIZES, 2, h - 8, false, 0);
        }

        @Override
        void onUp(float x, float y, boolean inside) {
            if (inside && enabled && onClick != null) onClick.run();
        }
    }

    /** Slider (format "x"/"percent"/"") or seek bar (format "time", secondary = buffered). */
    static final class Slider extends Widget {
        String label, format;
        float min, max, step, value, secondary;
        boolean seek;
        ValueListener listener;
        private boolean dragging;
        private final Paint track = Theme.fill(Theme.TRACK);
        private final Paint buffered = Theme.fill(Theme.BUFFERED);
        private final Paint fill = Theme.fill(Theme.ACCENT);
        private final Paint knob = Theme.fill(Theme.TEXT);
        private final Paint text = Theme.text(Theme.TEXT, 22, false);
        private final RectF tmp = new RectF();

        Slider(String id, String label, float value, float min, float max, float step, String format,
               ValueListener listener) {
            this.id = id;
            this.label = label == null ? "" : label;
            this.value = value;
            this.min = min;
            this.max = max > min ? max : min + 1;
            this.step = step;
            this.format = format == null ? "" : format;
            this.listener = listener;
        }

        private float labelWidth() {
            return label.isEmpty() ? 0 : Math.min(150, bounds.width() * 0.25f);
        }

        private float valueWidth() {
            return format.isEmpty() ? 0 : (seek ? 190 : 90);
        }

        private float trackLeft() {
            return bounds.left + labelWidth() + 18;
        }

        private float trackRight() {
            return bounds.right - valueWidth() - 18;
        }

        @Override
        void draw(Canvas c) {
            float cy = bounds.centerY();
            if (!label.isEmpty()) {
                text.setColor(Theme.TEXT_DIM);
                LabelFit.draw(c, text, label, 0, cy, labelWidth(), new float[] {22, 20, 18}, 1, bounds.height(), true,
                        bounds.left + 8);
            }
            float l = trackLeft(), r = trackRight();
            tmp.set(l, cy - 5, r, cy + 5);
            c.drawRoundRect(tmp, 5, 5, track);
            if (seek && secondary > min) {
                tmp.set(l, cy - 5, l + (r - l) * norm(Math.min(secondary, max)), cy + 5);
                c.drawRoundRect(tmp, 5, 5, buffered);
            }
            float kx = l + (r - l) * norm(value);
            fill.setColor(enabled ? Theme.ACCENT : Theme.TEXT_DISABLED);
            tmp.set(l, cy - 5, kx, cy + 5);
            c.drawRoundRect(tmp, 5, 5, fill);
            c.drawCircle(kx, cy, hovered || dragging ? 15 : 12, knob);
            if (!format.isEmpty()) {
                text.setColor(Theme.TEXT);
                String s = formatValue(format, value);
                if (seek) s = s + " / " + formatValue(format, max);
                text.setTextSize(22);
                text.setTextAlign(Paint.Align.RIGHT);
                Paint.FontMetrics fm = text.getFontMetrics();
                c.drawText(s, bounds.right - 6, cy - (fm.ascent + fm.descent) / 2f, text);
            }
        }

        private float norm(float v) {
            return Math.max(0, Math.min(1, (v - min) / (max - min)));
        }

        private float valueAt(float x) {
            float t = Math.max(0, Math.min(1, (x - trackLeft()) / Math.max(1, trackRight() - trackLeft())));
            float v = min + t * (max - min);
            if (step > 0) v = min + Math.round((v - min) / step) * step;
            return Math.max(min, Math.min(max, v));
        }

        @Override
        void onDown(float x, float y) {
            dragging = true;
            value = valueAt(x);
            if (listener != null) listener.onValue(value, 0);
        }

        @Override
        void onDrag(float x, float y) {
            if (!dragging) return;
            value = valueAt(x);
            if (listener != null) listener.onValue(value, 0);
        }

        @Override
        void onUp(float x, float y, boolean inside) {
            if (!dragging) return;
            dragging = false;
            value = valueAt(x);
            if (listener != null) listener.onValue(value, 1);
        }

        @Override
        boolean capturesDrag() {
            return true;
        }

        boolean dragging() {
            return dragging;
        }
    }

    /** "label  ◀ option ▶": the left/right thirds step backwards/forwards. */
    static final class Choice extends Widget {
        String label;
        List<String> options;
        int index;
        ValueListener listener;
        private final Paint bg = Theme.fill(Theme.BUTTON);
        private final Paint text = Theme.text(Theme.TEXT, 24, false);
        private float lastX;

        Choice(String id, String label, List<String> options, int index, ValueListener listener) {
            this.id = id;
            this.label = label == null ? "" : label;
            this.options = options;
            this.index = index;
            this.listener = listener;
        }

        @Override
        void draw(Canvas c) {
            bg.setColor(pressed ? Theme.BUTTON_PRESSED : hovered ? Theme.BUTTON_HOVER : Theme.BUTTON);
            c.drawRoundRect(bounds, Theme.RADIUS, Theme.RADIUS, bg);
            text.setColor(enabled ? Theme.TEXT : Theme.TEXT_DISABLED);
            float arrowW = Math.min(56, bounds.width() / 5f);
            Paint.FontMetrics fm = text.getFontMetrics();
            float base = bounds.centerY() - (fm.ascent + fm.descent) / 2f;
            text.setTextAlign(Paint.Align.CENTER);
            text.setTextSize(26);
            c.drawText("◀", bounds.left + arrowW / 2f, base, text);
            c.drawText("▶", bounds.right - arrowW / 2f, base, text);
            String current = options.isEmpty() ? "" : options.get(Math.max(0, Math.min(options.size() - 1, index)));
            String shown = label.isEmpty() ? current : label + ": " + current;
            LabelFit.draw(c, text, shown, bounds.centerX(), bounds.centerY(), bounds.width() - 2 * arrowW - 8,
                    LabelFit.DEFAULT_SIZES, 2, bounds.height() - 8, false, 0);
        }

        @Override
        void onDown(float x, float y) {
            lastX = x;
        }

        @Override
        void onUp(float x, float y, boolean inside) {
            if (!inside || options.isEmpty() || listener == null) return;
            int dir = lastX < bounds.centerX() ? -1 : 1;
            index = (index + dir + options.size()) % options.size();
            listener.onValue(index, 1);
        }
    }

    /** Text only. */
    static final class Label extends Widget {
        String text;
        final Paint paint;
        boolean left;
        int maxLines = 1;

        Label(String text, int color, float size, boolean bold, boolean left) {
            this.text = text == null ? "" : text;
            this.paint = Theme.text(color, size, bold);
            this.left = left;
            this.enabled = false;  // not clickable
        }

        @Override
        void draw(Canvas c) {
            if (text.isEmpty()) return;
            float size = paint.getTextSize();
            LabelFit.draw(c, paint, text, bounds.centerX(), bounds.centerY(), bounds.width(),
                    new float[] {size, size * 0.9f, size * 0.8f}, maxLines, bounds.height(), left, bounds.left);
        }
    }
}
