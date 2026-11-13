package com.sharp.questnative.core;

import android.app.NativeActivity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.SystemClock;
import android.util.Log;

/**
 * App entry. The native side (libquestnative.so, android_main) runs the OpenXR loop on its own
 * thread; this activity loads the library early (so Java "native" methods resolve) and starts the
 * Java halves of the modules. Owner: foundation.
 */
public class QnActivity extends NativeActivity {
    static {
        System.loadLibrary("questnative");
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
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

    @Override
    protected void onDestroy() {
        ModuleLoader.stopAll();
        super.onDestroy();
    }
}
