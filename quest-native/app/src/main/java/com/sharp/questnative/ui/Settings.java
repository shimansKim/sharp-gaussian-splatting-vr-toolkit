package com.sharp.questnative.ui;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * The ui module's own settings: render resolution scale, refresh rate, foveation, slideshow
 * interval. Stored in SharedPreferences and applied through native commands. ui draw thread only.
 * Owner: ui.
 */
final class Settings {
    static final float[] REFRESH = {72, 90, 120};
    static final String[] REFRESH_LABELS = {"72Hz", "90Hz", "120Hz"};
    static final String[] FOVEATION_LABELS = {"끔", "낮음", "중간", "높음"};
    static final int[] SLIDESHOW = {3, 5, 10, 30};
    static final String[] SLIDESHOW_LABELS = {"3초", "5초", "10초", "30초"};

    private SharedPreferences prefs;
    float scale = 1.0f;
    int refresh = 0;    // index into REFRESH
    int foveation = 0;  // 0..3
    int slideshow = 1;  // index into SLIDESHOW (5 s, image_logic.h default)
    boolean passthrough = false;
    boolean passthroughSupported = false;

    void init(Context c) {
        prefs = c.getSharedPreferences("ui_settings", Context.MODE_PRIVATE);
        scale = prefs.getFloat("scale", 1.0f);
        refresh = clamp(prefs.getInt("refresh", 0), REFRESH.length);
        foveation = clamp(prefs.getInt("foveation", 0), FOVEATION_LABELS.length);
        slideshow = clamp(prefs.getInt("slideshow", 1), SLIDESHOW.length);
        passthrough = prefs.getBoolean("passthrough", false);
    }

    private static int clamp(int v, int n) {
        return Math.max(0, Math.min(n - 1, v));
    }

    void setScale(float v, boolean apply) {
        scale = Math.round(v * 10) / 10f;
        prefs.edit().putFloat("scale", scale).apply();
        if (apply) UiBridge.nativeCommand("settings.scale", scale);
    }

    void setRefresh(int i) {
        refresh = clamp(i, REFRESH.length);
        prefs.edit().putInt("refresh", refresh).apply();
        UiBridge.nativeCommand("settings.refresh", REFRESH[refresh]);
    }

    void setFoveation(int i) {
        foveation = clamp(i, FOVEATION_LABELS.length);
        prefs.edit().putInt("foveation", foveation).apply();
        UiBridge.nativeCommand("settings.foveation", foveation);
    }

    void setSlideshow(int i) {
        slideshow = clamp(i, SLIDESHOW.length);
        prefs.edit().putInt("slideshow", slideshow).apply();
        UiBridge.nativeCommand("slideshow.interval", SLIDESHOW[slideshow]);
    }

    void setPassthrough(boolean v) {
        passthrough = v;
        if (prefs != null) prefs.edit().putBoolean("passthrough", passthrough).apply();
        UiBridge.nativeCommand("settings.passthrough", passthrough ? 1 : 0);
    }

    void setPassthroughSupported(boolean supported) {
        if (passthroughSupported == supported) return;
        passthroughSupported = supported;
        PanelHost.list().relayout();
        PanelHost.hud().relayout();
    }

    void setPassthroughFromNative(boolean supported, boolean enabled, boolean save) {
        boolean changed = passthroughSupported != supported || ((supported || save) && passthrough != enabled);
        passthroughSupported = supported;
        if (supported || save) {
            passthrough = enabled;
            if (save && prefs != null) prefs.edit().putBoolean("passthrough", passthrough).apply();
        }
        if (changed) {
            PanelHost.list().relayout();
            PanelHost.hud().relayout();
        }
    }

    /** Sends everything to native (called when the native side attached the panels). */
    void applyAll() {
        if (Math.abs(scale - 1.0f) > 0.01f) UiBridge.nativeCommand("settings.scale", scale);
        UiBridge.nativeCommand("settings.refresh", REFRESH[refresh]);
        if (foveation != 0) UiBridge.nativeCommand("settings.foveation", foveation);
        UiBridge.nativeCommand("slideshow.interval", SLIDESHOW[slideshow]);
        UiBridge.nativeCommand("settings.passthrough", passthrough ? 1 : 0);
    }
}
