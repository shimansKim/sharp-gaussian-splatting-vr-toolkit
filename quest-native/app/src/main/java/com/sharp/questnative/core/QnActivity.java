package com.sharp.questnative.core;

import android.app.NativeActivity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.SystemClock;
import android.util.Log;
import android.util.SparseArray;

/**
 * App entry. The native side (libquestnative.so, android_main) runs the OpenXR loop on its own
 * thread; this activity loads the library early (so Java "native" methods resolve) and starts the
 * Java halves of the modules. Owner: foundation.
 */
public class QnActivity extends NativeActivity {
    static {
        System.loadLibrary("questnative");
    }

    /** Result of {@link #startForResult}. Runs on the main thread. */
    public interface ResultCallback {
        void onResult(int resultCode, Intent data);
    }

    private static volatile QnActivity current;
    private final SparseArray<ResultCallback> pending = new SparseArray<>();
    private int nextRequest = 1000;

    /** The running activity, or null. */
    public static QnActivity current() {
        return current;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        current = this;
        ModuleLoader.startAll(this);
        openFromIntent(getIntent());
    }

    /**
     * Test hook: {@code adb shell am start -n com.sharp.questnative/.core.QnActivity --es qn.open <uri>}.
     * Modules must not auto-open files themselves (docs/module-contract.md 12).
     */
    private void openFromIntent(Intent intent) {
        String uri = intent == null ? null : intent.getStringExtra("qn.open");
        if (uri == null || uri.isEmpty()) return;
        String name = Uri.parse(uri).getLastPathSegment();
        new Thread(() -> {
            for (int i = 0; i < 75; i++) {  // the native side may need a few seconds to start
                if (NativeBridge.nativeOpenMedia(uri, name == null ? uri : name, "", "intent", "", -1, -1)) {
                    Log.i(ModuleLoader.TAG, "[core] qn.open " + uri);
                    return;
                }
                SystemClock.sleep(200);
            }
            Log.w(ModuleLoader.TAG, "[core] qn.open gave up: native side did not start");
        }, "QnOpenIntent").start();
    }

    /**
     * Starts a system screen (file picker, permission settings) and calls back with its result.
     * On Quest this leaves the immersive view until the user finishes. Any thread.
     */
    public void startForResult(Intent intent, ResultCallback callback) {
        runOnUiThread(() -> {
            int code = nextRequest++;
            pending.put(code, callback);
            try {
                startActivityForResult(intent, code);
            } catch (Exception e) {
                pending.remove(code);
                Log.e(ModuleLoader.TAG, "[core] could not start " + intent, e);
                if (callback != null) callback.onResult(RESULT_CANCELED, null);
            }
        });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        ResultCallback cb = pending.get(requestCode);
        pending.remove(requestCode);
        if (cb != null) cb.onResult(resultCode, data);
    }

    @Override
    protected void onDestroy() {
        ModuleLoader.stopAll();
        if (current == this) current = null;
        super.onDestroy();
    }
}
