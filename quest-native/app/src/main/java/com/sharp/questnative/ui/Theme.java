package com.sharp.questnative.ui;

import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;

/** Colors and paints shared by all panels. Text uses the system font (Korean included). Owner: ui. */
final class Theme {
    static final int PANEL_BG = Color.argb(240, 22, 26, 34);
    static final int PANEL_BORDER = Color.argb(255, 58, 66, 82);
    static final int BUTTON = Color.argb(255, 42, 49, 62);
    static final int BUTTON_HOVER = Color.argb(255, 60, 70, 88);
    static final int BUTTON_PRESSED = Color.argb(255, 76, 132, 255);
    static final int BUTTON_ON = Color.argb(255, 46, 92, 190);
    static final int TEXT = Color.argb(255, 242, 244, 248);
    static final int TEXT_DIM = Color.argb(255, 154, 163, 178);
    static final int TEXT_DISABLED = Color.argb(255, 96, 104, 118);
    static final int ACCENT = Color.argb(255, 76, 132, 255);
    static final int TRACK = Color.argb(255, 70, 78, 94);
    static final int BUFFERED = Color.argb(255, 110, 120, 140);
    static final int WARNING = Color.argb(255, 255, 179, 71);
    static final int CURSOR = Color.argb(230, 255, 255, 255);
    static final int ROW_HOVER = Color.argb(255, 48, 56, 72);

    static final float RADIUS = 14f;
    static final Typeface FONT = Typeface.create(Typeface.DEFAULT, Typeface.NORMAL);
    static final Typeface FONT_BOLD = Typeface.create(Typeface.DEFAULT, Typeface.BOLD);

    private Theme() {}

    static Paint fill(int color) {
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setStyle(Paint.Style.FILL);
        p.setColor(color);
        return p;
    }

    static Paint text(int color, float size, boolean bold) {
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setColor(color);
        p.setTextSize(size);
        p.setTypeface(bold ? FONT_BOLD : FONT);
        return p;
    }
}
