package com.sharp.questnative.core;

import android.app.NativeActivity;
import android.os.Bundle;

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
    }

    @Override
    protected void onDestroy() {
        ModuleLoader.stopAll();
        super.onDestroy();
    }
}
