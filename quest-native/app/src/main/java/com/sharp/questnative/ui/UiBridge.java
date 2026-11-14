package com.sharp.questnative.ui;

import android.view.Surface;

/**
 * Native <-> Java boundary of the ui module (cpp/ui/ui_module.cpp). Static methods are called from
 * the render thread and hop to the ui draw thread. Natives are safe from any thread. Owner: ui.
 */
public final class UiBridge {
    private UiBridge() {}

    // ---- called by native (render thread)
    static void attachSurface(int panel, Surface surface, int width, int height) {
        UiThread.post(() -> PanelHost.attach(panel, surface, width, height));
    }

    /** [버튼 바꾸기] capture: the button the user pressed ("X.long", ...). */
    static void bindingCaptured(String slot) {
        UiThread.post(() -> PanelHost.list().pages().onCaptured(slot));
    }

    /** The controller-ray texture (drawn once). */
    static void attachRaySurface(Surface surface, int width, int height) {
        UiThread.post(() -> RayTexture.draw(surface, width, height));
    }

    /** type: 0 hover, 1 down, 2 up, 3 leave, 4 scroll (value = stick y * seconds). Pixels from the top-left. */
    static void pointer(int panel, int hand, int type, float x, float y, float value) {
        UiThread.post(() -> PanelHost.pointer(panel, hand, type, x, y, value));
    }

    static void setPanelVisible(int panel, boolean visible) {
        UiThread.post(() -> PanelHost.setVisible(panel, visible));
    }

    /** json: hud::Model from the active C++ viewer, or null (Java provider or no HUD). */
    static void setHudModel(String viewerId, String json) {
        UiThread.post(() -> PanelHost.hud().setNativeModel(viewerId, json));
    }

    /** Previous (-1) / next (+1) file in the current list (X button, HUD dock). */
    static void navigate(int dir) {
        UiThread.post(() -> PanelHost.list().library.step(dir));
    }

    /** Slideshow state for the HUD dock button. */
    static void setSlideshow(boolean running, int seconds) {
        UiThread.post(() -> PanelHost.hud().setSlideshow(running));
    }

    /** A button shortcut to a control of a Java HudProvider ("hud:<id>" binding). */
    static void hudShortcut(String viewerId, String controlId) {
        UiThread.post(() -> PanelHost.hud().shortcut(viewerId, controlId));
    }

    /** Reports passthrough runtime support and current toggle state from native. */
    static void setPassthroughState(boolean supported, boolean enabled) {
        UiThread.post(() -> PanelHost.settings().setPassthroughFromNative(supported, enabled));
    }

    /** Also used by Java (Hud.toast). */
    public static void showToast(String text, float seconds) {
        UiThread.post(() -> PanelHost.toast().show(text));
        nativeCommand("toast", seconds);
    }

    // ---- implemented in cpp/ui/ui_module.cpp
    /** "list.open", "list.close", "list.toggle", "hud.show", "hud.hide", "ui.hide", "ui.place", "interact", "toast". */
    public static native void nativeCommand(String command, float value);

    static native void nativeHudAction(String id, float value, int phase);

    /**
     * Opens a file through the ui module so a failure shows the viewer's error as a toast.
     * Returns false before the native side started (the caller then closes fd).
     */
    static native boolean nativeOpen(String uri, String name, String mimeType, String sourceId, int fd, long size);
}
