package com.sharp.questnative.ui.hud;

import java.util.Collections;
import java.util.List;

/** One HUD control. Same fields as qn::hud::Control (cpp/core/qn_hud.h). Owner: ui. */
public final class HudControl {
    public static final int BUTTON = 0;
    public static final int TOGGLE = 1;
    public static final int SLIDER = 2;
    public static final int SEEK = 3;
    public static final int CHOICE = 4;
    public static final int LABEL = 5;

    public String id = "";
    public int kind = BUTTON;
    public String label = "";
    public String icon = "";
    public float value, min, max = 1, step;
    public float secondary;  // SEEK: buffered position (s)
    public String format = "";  // "time", "percent", "x", ""
    public List<String> options = Collections.emptyList();  // CHOICE
    public boolean enabled = true;
    public String page = "main";  // "main" or "more"
    public int row;

    public static HudControl button(String id, String label, String icon, int row) {
        HudControl c = new HudControl();
        c.id = id;
        c.kind = BUTTON;
        c.label = label;
        c.icon = icon;
        c.row = row;
        return c;
    }

    public static HudControl toggle(String id, String label, boolean on, int row) {
        HudControl c = button(id, label, "", row);
        c.kind = TOGGLE;
        c.value = on ? 1 : 0;
        return c;
    }

    public static HudControl slider(String id, String label, float value, float min, float max, float step,
                                    String format, int row) {
        HudControl c = button(id, label, "", row);
        c.kind = SLIDER;
        c.value = value;
        c.min = min;
        c.max = max;
        c.step = step;
        c.format = format;
        return c;
    }

    public static HudControl seek(String id, float positionS, float durationS, float bufferedS, int row) {
        HudControl c = slider(id, "", positionS, 0, durationS, 0, "time", row);
        c.kind = SEEK;
        c.secondary = bufferedS;
        return c;
    }

    public static HudControl choice(String id, String label, List<String> options, int index, int row) {
        HudControl c = button(id, label, "", row);
        c.kind = CHOICE;
        c.options = options;
        c.value = index;
        return c;
    }

    public HudControl onPage(String page) {
        this.page = page;
        return this;
    }
}
