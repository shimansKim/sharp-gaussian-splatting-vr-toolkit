package com.sharp.questnative.ui.hud;

import android.util.Log;

import java.util.HashMap;
import java.util.Map;

/**
 * Java entry to the ui module's HUD (mirror of cpp/ui/ui_api.h). Thread-safe. Owner: ui.
 * The ui module asks the provider registered under the active viewer's module id ("video", "image",
 * "splat"); when none is registered it asks the C++ viewer (DescribeHud).
 */
public final class Hud {
    public static final int PHASE_CHANGE = 0;
    public static final int PHASE_COMMIT = 1;

    private static final Map<String, HudProvider> providers = new HashMap<>();

    private Hud() {}

    public static synchronized void register(String viewerId, HudProvider provider) {
        providers.put(viewerId, provider);
    }

    public static synchronized void unregister(String viewerId) {
        providers.remove(viewerId);
    }

    public static synchronized HudProvider provider(String viewerId) {
        return providers.get(viewerId);
    }

    /** The provider's model changed; redraw soon. (Stub until the panel parts land.) */
    public static void invalidate() {}

    public static void toast(String text, float seconds) {
        Log.i("QuestNative", "[ui] toast: " + text);
    }

    public static void setVisible(boolean visible) {}

    public static void notifyMediaEnded() {
        Log.i("QuestNative", "[ui] media ended");
    }
}
