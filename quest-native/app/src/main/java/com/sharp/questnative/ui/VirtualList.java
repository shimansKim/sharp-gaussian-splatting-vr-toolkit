package com.sharp.questnative.ui;

import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;

/**
 * Scrolling list that only draws the visible rows, so 20,000 entries cost the same as 20.
 * Scroll with the stick (faster the longer it is held) or by dragging with the trigger; a trigger
 * click without dragging picks the row. Owner: ui.
 */
final class VirtualList extends Widget {
    interface Rows {
        int count();

        void drawRow(Canvas c, int index, RectF row, boolean hovered);

        void onClick(int index);
    }

    final float rowHeight;
    Rows rows;
    float scroll;  // pixels from the top
    private float hoverY = -1;
    private float downY, downScroll;
    private boolean dragging;
    private long scrollStartMs;
    private long lastScrollMs;
    private final Paint thumb = Theme.fill(Theme.TRACK);
    private final Paint hoverBg = Theme.fill(Theme.ROW_HOVER);
    private final RectF row = new RectF();

    VirtualList(String id, float rowHeight, Rows rows) {
        this.id = id;
        this.rowHeight = rowHeight;
        this.rows = rows;
    }

    float maxScroll() {
        return Math.max(0, rows.count() * rowHeight - bounds.height());
    }

    void scrollTo(float px) {
        scroll = Math.max(0, Math.min(maxScroll(), px));
    }

    /** Makes row index visible (e.g. the file that is open). */
    void reveal(int index) {
        float top = index * rowHeight;
        if (top < scroll) scrollTo(top);
        else if (top + rowHeight > scroll + bounds.height()) scrollTo(top + rowHeight - bounds.height());
    }

    int rowAt(float y) {
        int i = (int) Math.floor((y - bounds.top + scroll) / rowHeight);
        return i >= 0 && i < rows.count() ? i : -1;
    }

    @Override
    void draw(Canvas c) {
        int n = rows.count();
        c.save();
        c.clipRect(bounds);
        int first = Math.max(0, (int) Math.floor(scroll / rowHeight));
        int last = Math.min(n - 1, (int) Math.floor((scroll + bounds.height()) / rowHeight));
        int hoverRow = hovered && !dragging ? rowAt(hoverY) : -1;
        for (int i = first; i <= last; i++) {
            float top = bounds.top + i * rowHeight - scroll;
            row.set(bounds.left, top, bounds.right - 14, top + rowHeight);
            if (i == hoverRow) c.drawRoundRect(row, 10, 10, hoverBg);
            rows.drawRow(c, i, row, i == hoverRow);
        }
        c.restore();
        float total = n * rowHeight;
        if (total > bounds.height()) {
            float h = Math.max(30, bounds.height() * bounds.height() / total);
            float y = bounds.top + (bounds.height() - h) * (scroll / maxScroll());
            row.set(bounds.right - 8, y, bounds.right - 2, y + h);
            c.drawRoundRect(row, 3, 3, thumb);
        }
        if (!hovered) hoverY = -1;
    }

    @Override
    boolean contains(float x, float y) {
        boolean in = super.contains(x, y);
        if (in) hoverY = y;
        return in;
    }

    @Override
    void onDown(float x, float y) {
        downY = y;
        downScroll = scroll;
        dragging = false;
    }

    @Override
    void onDrag(float x, float y) {
        hoverY = y;
        if (!dragging && Math.abs(y - downY) > 14) dragging = true;
        if (dragging) scrollTo(downScroll - (y - downY));
    }

    @Override
    void onUp(float x, float y, boolean inside) {
        if (!dragging && inside) {
            int i = rowAt(y);
            if (i >= 0) rows.onClick(i);
        }
        dragging = false;
    }

    @Override
    void onScroll(float value) {
        long now = android.os.SystemClock.uptimeMillis();
        if (now - lastScrollMs > 250) scrollStartMs = now;
        lastScrollMs = now;
        float held = (now - scrollStartMs) / 1000f;
        float rowsPerSecond = 8f * (1f + Math.min(held, 3f) * 2f);  // longer push -> faster (max 56 rows/s)
        scrollTo(scroll - value * rowsPerSecond * rowHeight);
    }

    @Override
    boolean capturesDrag() {
        return dragging;
    }
}
