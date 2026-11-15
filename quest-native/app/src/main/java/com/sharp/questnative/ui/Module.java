package com.sharp.questnative.ui;

import android.util.Log;

import com.sharp.questnative.core.QnActivity;
import com.sharp.questnative.core.QnModule;

/** Java half of the ui module: starts the ui draw thread. Owner: ui (image-dev). */
public final class Module implements QnModule {
    private android.app.Application application;
    private android.app.Application.ActivityLifecycleCallbacks lifecycle;
    @Override
    public void onCreate(QnActivity activity) {
        UiThread.start();
        com.sharp.questnative.ui.hud.Hud.setInvalidator(() -> UiThread.post(() -> PanelHost.hud().invalidateProvider()));
        application = activity.getApplication();
        lifecycle = new android.app.Application.ActivityLifecycleCallbacks() {
            @Override public void onActivityResumed(android.app.Activity a) {
                if (a == activity) BindingsSync.request();
            }
            @Override public void onActivityCreated(android.app.Activity a, android.os.Bundle b) {}
            @Override public void onActivityStarted(android.app.Activity a) {}
            @Override public void onActivityPaused(android.app.Activity a) {}
            @Override public void onActivityStopped(android.app.Activity a) {}
            @Override public void onActivitySaveInstanceState(android.app.Activity a, android.os.Bundle b) {}
            @Override public void onActivityDestroyed(android.app.Activity a) {}
        };
        application.registerActivityLifecycleCallbacks(lifecycle);
        Log.i("QuestNative", "[ui] Java module started");
    }

    @Override public void onDestroy() {
        if (application != null && lifecycle != null) application.unregisterActivityLifecycleCallbacks(lifecycle);
    }
}
