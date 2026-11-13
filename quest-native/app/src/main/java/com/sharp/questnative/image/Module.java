package com.sharp.questnative.image;

import android.util.Log;

import com.sharp.questnative.core.QnActivity;
import com.sharp.questnative.core.QnModule;

/** Java half of the image module (stub). Owner: image-dev. Found by name by core ModuleLoader. */
public final class Module implements QnModule {
    @Override
    public void onCreate(QnActivity activity) {
        Log.i("QuestNative", "[image] Java module started (stub)");
    }
}
