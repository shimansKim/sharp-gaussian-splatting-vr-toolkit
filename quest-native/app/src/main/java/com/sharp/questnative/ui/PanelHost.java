package com.sharp.questnative.ui;

import android.view.Surface;

/** The three VR panels (ids match cpp/ui/ui_module.cpp). ui draw thread only. Owner: ui. */
final class PanelHost {
    static final int LIST = 0, HUD = 1, TOAST = 2;

    private static final ListPanel list = new ListPanel();
    private static final HudPanel hud = new HudPanel();
    private static final ToastPanel toast = new ToastPanel();
    private static final Panel[] panels = {list, hud, toast};

    private PanelHost() {}

    static HudPanel hud() {
        return hud;
    }

    static ToastPanel toast() {
        return toast;
    }

    static void attach(int id, Surface s, int w, int h) {
        if (id >= 0 && id < panels.length) panels[id].attach(s, w, h);
    }

    static void pointer(int id, int hand, int type, float x, float y, float value) {
        if (id >= 0 && id < panels.length && hand >= 0 && hand < 2) panels[id].pointer(hand, type, x, y, value);
    }

    static void setVisible(int id, boolean v) {
        if (id >= 0 && id < panels.length) panels[id].setVisible(v);
    }
}
