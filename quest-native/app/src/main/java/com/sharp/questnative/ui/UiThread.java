package com.sharp.questnative.ui;

import android.os.Handler;
import android.os.HandlerThread;

/** The ui draw thread ("QnUiDraw"). All panel state lives on it. Owner: ui. */
final class UiThread {
    private static Handler handler;

    private UiThread() {}

    static synchronized void start() {
        if (handler != null) return;
        HandlerThread t = new HandlerThread("QnUiDraw");
        t.start();
        handler = new Handler(t.getLooper());
    }

    static synchronized Handler handler() {
        if (handler == null) start();
        return handler;
    }

    static void post(Runnable r) {
        handler().post(r);
    }

    static void postDelayed(Runnable r, long ms) {
        handler().postDelayed(r, ms);
    }

    static boolean isCurrent() {
        return handler().getLooper().isCurrentThread();
    }
}
