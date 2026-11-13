package com.sharp.questnative.video;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;

import java.util.ArrayList;
import java.util.List;

/**
 * Per-item layout memory (quest-app layout-memory.js, last 500 items) and the player settings that
 * persist across files: screen zoom, volume, speed, loop. Owner: video-dev.
 */
final class VideoPrefs {
    private static final String FILE = "qn_video";
    private static final String KEY_LAYOUTS = "layoutByItem.v1";
    private static final int MAX_ENTRIES = 500;

    private final SharedPreferences prefs;

    VideoPrefs(Context context) {
        prefs = context.getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    /** Item key: source plus uri (or name). */
    static String itemKey(String sourceId, String uri, String name) {
        String id = uri != null && !uri.isEmpty() ? uri : name;
        return (sourceId == null ? "" : sourceId) + "|" + (id == null ? "" : id);
    }

    private List<String[]> readAll() {
        List<String[]> out = new ArrayList<>();
        try {
            JSONArray arr = new JSONArray(prefs.getString(KEY_LAYOUTS, "[]"));
            for (int i = 0; i < arr.length(); i++) {
                JSONArray e = arr.optJSONArray(i);
                if (e != null && e.length() == 2 && FormatDetect.isLayout(e.optString(1))) {
                    out.add(new String[] {e.optString(0), e.optString(1)});
                }
            }
        } catch (Exception ignored) {
            // corrupt: start over
        }
        return out;
    }

    String recallLayout(String key) {
        for (String[] e : readAll()) {
            if (e[0].equals(key)) return e[1];
        }
        return null;
    }

    void rememberLayout(String key, String layout) {
        if (!FormatDetect.isLayout(layout)) return;
        List<String[]> all = readAll();
        all.removeIf(e -> e[0].equals(key));
        all.add(new String[] {key, layout});
        JSONArray arr = new JSONArray();
        for (int i = Math.max(0, all.size() - MAX_ENTRIES); i < all.size(); i++) {
            JSONArray e = new JSONArray();
            e.put(all.get(i)[0]);
            e.put(all.get(i)[1]);
            arr.put(e);
        }
        prefs.edit().putString(KEY_LAYOUTS, arr.toString()).apply();
    }

    float getFloat(String key, float fallback) {
        return prefs.getFloat(key, fallback);
    }

    void putFloat(String key, float value) {
        prefs.edit().putFloat(key, value).apply();
    }

    boolean getBool(String key, boolean fallback) {
        return prefs.getBoolean(key, fallback);
    }

    void putBool(String key, boolean value) {
        prefs.edit().putBoolean(key, value).apply();
    }
}
