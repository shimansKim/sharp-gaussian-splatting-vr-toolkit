package com.sharp.questnative.ui;

import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;

/** One-line notice above the list panel. Visibility (timing) is decided by native. Owner: ui. */
final class ToastPanel extends Panel {
    private String text = "";
    private final Paint bg = Theme.fill(Theme.PANEL_BG);
    private final Paint paint = Theme.text(Theme.TEXT, 30, false);
    private final RectF r = new RectF();

    void show(String t) {
        text = t == null ? "" : t;
        invalidate();
    }

    @Override
    void layout() {}

    @Override
    boolean drawBackground() {
        return false;
    }

    @Override
    void drawContent(Canvas c) {
        if (text.isEmpty()) return;
        paint.setTextSize(30);
        float w = Math.min(width - 8, paint.measureText(text) + 64);
        r.set((width - w) / 2f, 4, (width + w) / 2f, height - 4);
        c.drawRoundRect(r, r.height() / 2f, r.height() / 2f, bg);
        LabelFit.draw(c, paint, text, width / 2f, height / 2f, w - 48, new float[] {30, 27, 24}, 1, height, false, 0);
    }
}
