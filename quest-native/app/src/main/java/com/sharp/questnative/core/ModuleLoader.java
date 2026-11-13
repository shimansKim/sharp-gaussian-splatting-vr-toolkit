package com.sharp.questnative.core;

import android.util.Log;

import java.util.ArrayList;
import java.util.List;

/** Starts the Java half of every module ("com.sharp.questnative.<id>.Module"). Owner: foundation. */
public final class ModuleLoader {
    public static final String TAG = "QuestNative";
    /** Start order. Sources first so viewers and UI can list files in their onCreate. */
    static final String[] MODULE_IDS = {"source", "video", "image", "splat", "ui"};

    private static final List<QnModule> started = new ArrayList<>();

    private ModuleLoader() {}

    static synchronized void startAll(QnActivity activity) {
        for (String id : MODULE_IDS) {
            String cls = "com.sharp.questnative." + id + ".Module";
            try {
                QnModule m = (QnModule) Class.forName(cls).getDeclaredConstructor().newInstance();
                m.onCreate(activity);
                started.add(m);
            } catch (ClassNotFoundException e) {
                Log.i(TAG, "[core] no Java module " + cls);
            } catch (Exception e) {
                Log.e(TAG, "[core] Java module " + cls + " failed to start", e);
            }
        }
        Log.i(TAG, "[core] Java modules started: " + started.size());
    }

    static synchronized void stopAll() {
        for (int i = started.size() - 1; i >= 0; i--) {
            try {
                started.get(i).onDestroy();
            } catch (Exception e) {
                Log.e(TAG, "[core] Java module stop failed", e);
            }
        }
        started.clear();
    }
}
