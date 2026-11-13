package com.sharp.questnative.ui;

import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.PorterDuff;
import android.graphics.RectF;
import android.util.Log;
import android.view.Surface;

import java.util.ArrayList;
import java.util.List;

/**
 * One VR panel: a Surface (from an OpenXR Android surface swapchain) drawn with Canvas on the ui
 * draw thread, plus pointer handling for two controller rays. Subclasses build widgets in
 * {@link #layout()} and may draw extra content in {@link #drawContent(Canvas)}. Owner: ui.
 */
abstract class Panel {
    Surface surface;
    int width, height;
    boolean visible;
    final List<Widget> widgets = new ArrayList<>();

    private boolean drawScheduled;
    private final float[] cursorX = new float[2], cursorY = new float[2];
    private final boolean[] cursorOn = new boolean[2];
    private final Widget[] hover = new Widget[2], press = new Widget[2];
    private final Paint bg = Theme.fill(Theme.PANEL_BG);
    private final Paint border = Theme.fill(Theme.PANEL_BORDER);
    private final Paint cursor = Theme.fill(Theme.CURSOR);
    private final RectF tmp = new RectF();

    void attach(Surface s, int w, int h) {
        surface = s;
        width = w;
        height = h;
        relayout();
    }

    void setVisible(boolean v) {
        visible = v;
        onVisibility(v);
        if (v) invalidate();
    }

    void onVisibility(boolean v) {}

    /** Rebuild widgets (call after the content changed). Keeps a pressed widget alive during a drag. */
    final void relayout() {
        if (width == 0) return;
        widgets.clear();
        layout();
        for (int h = 0; h < 2; h++) {
            if (press[h] != null) {
                Widget fresh = find(press[h].id);
                if (fresh != null && !press[h].id.isEmpty()) {
                    press[h].bounds.set(fresh.bounds);
                    widgets.set(widgets.indexOf(fresh), press[h]);
                } else {
                    press[h] = null;
                }
            }
            hover[h] = null;
        }
        invalidate();
    }

    abstract void layout();

    void drawContent(Canvas c) {}

    boolean drawBackground() {
        return true;
    }

    final void invalidate() {
        if (drawScheduled) return;
        drawScheduled = true;
        UiThread.post(this::drawNow);
    }

    private void drawNow() {
        drawScheduled = false;
        if (surface == null || !visible || !surface.isValid()) return;
        Canvas c;
        try {
            c = surface.lockHardwareCanvas();
        } catch (Exception e) {
            Log.w("QuestNative", "[ui] lockHardwareCanvas failed", e);
            return;
        }
        try {
            c.drawColor(0, PorterDuff.Mode.CLEAR);
            if (drawBackground()) {
                tmp.set(0, 0, width, height);
                c.drawRoundRect(tmp, 28, 28, border);
                tmp.inset(2, 2);
                c.drawRoundRect(tmp, 26, 26, bg);
            }
            drawContent(c);
            for (Widget w : widgets) w.draw(c);
            for (int h = 0; h < 2; h++) {
                if (cursorOn[h]) c.drawCircle(cursorX[h], cursorY[h], 7, cursor);
            }
        } finally {
            surface.unlockCanvasAndPost(c);
        }
    }

    Widget find(String id) {
        for (Widget w : widgets) {
            if (id.equals(w.id)) return w;
        }
        return null;
    }

    private Widget hit(float x, float y) {
        for (int i = widgets.size() - 1; i >= 0; i--) {
            Widget w = widgets.get(i);
            if (w.enabled && w.contains(x, y)) return w;
        }
        return null;
    }

    void pointer(int hand, int type, float x, float y, float value) {
        cursorX[hand] = x;
        cursorY[hand] = y;
        cursorOn[hand] = type != 3;
        Widget target = hit(x, y);
        switch (type) {
            case 0: // hover / drag
                if (press[hand] != null) press[hand].onDrag(x, y);
                setHover(hand, press[hand] != null && press[hand].capturesDrag() ? press[hand] : target);
                break;
            case 1: // down
                press[hand] = target;
                if (target != null) {
                    target.pressed = true;
                    target.onDown(x, y);
                }
                break;
            case 2: // up
                if (press[hand] != null) {
                    Widget p = press[hand];
                    press[hand] = null;
                    p.pressed = false;
                    p.onUp(x, y, p.contains(x, y));
                }
                break;
            case 3: // leave
                setHover(hand, null);
                break;
            case 4: // scroll
                if (target != null) target.onScroll(value);
                break;
            default:
                break;
        }
        invalidate();
    }

    private void setHover(int hand, Widget w) {
        if (hover[hand] == w) return;
        if (hover[hand] != null) hover[hand].hovered = hover[1 - hand] == hover[hand];
        hover[hand] = w;
        if (w != null) w.hovered = true;
    }
}
