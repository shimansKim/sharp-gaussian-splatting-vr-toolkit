package com.sharp.questnative.ui;

import android.util.Log;

import com.sharp.questnative.core.QnActivity;
import com.sharp.questnative.core.QnModule;

/** Java half of the ui module (stub). Owner: UI owner (image-dev). Found by name by core ModuleLoader. */
public final class Module implements QnModule {
    @Override
    public void onCreate(QnActivity activity) {
        Log.i("QuestNative", "[ui] Java module started (stub)");
    }
}
