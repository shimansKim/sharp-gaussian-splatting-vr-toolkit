package com.sharp.questnative.ui;

import android.util.Log;

import com.sharp.questnative.core.QnActivity;
import com.sharp.questnative.core.QnModule;

/** Java half of the ui module: starts the ui draw thread. Owner: ui (image-dev). */
public final class Module implements QnModule {
    @Override
    public void onCreate(QnActivity activity) {
        UiThread.start();
        com.sharp.questnative.ui.hud.Hud.setInvalidator(() -> UiThread.post(() -> PanelHost.hud().invalidateProvider()));
        Log.i("QuestNative", "[ui] Java module started");
    }
}
