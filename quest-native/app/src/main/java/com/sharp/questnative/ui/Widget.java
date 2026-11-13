package com.sharp.questnative.ui;

import android.graphics.Canvas;
import android.graphics.RectF;

/** Something on a panel that can be drawn and pointed at. Coordinates are panel pixels. Owner: ui. */
abstract class Widget {
    final RectF bounds = new RectF();
    String id = "";
    boolean enabled = true;
    boolean hovered;
    boolean pressed;

    Widget at(float left, float top, float right, float bottom) {
        bounds.set(left, top, right, bottom);
        return this;
    }

    boolean contains(float x, float y) {
        return bounds.contains(x, y);
    }

    abstract void draw(Canvas c);

    void onDown(float x, float y) {}

    void onDrag(float x, float y) {}

    /** inside: the pointer was released over this widget (a click). */
    void onUp(float x, float y, boolean inside) {}

    /** value: stick y * seconds (positive = pushed up). */
    void onScroll(float value) {}

    /** True while a drag must keep this widget even when the pointer leaves it. */
    boolean capturesDrag() {
        return false;
    }
}
