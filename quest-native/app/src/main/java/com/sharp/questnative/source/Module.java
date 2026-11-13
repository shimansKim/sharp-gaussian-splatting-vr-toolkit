package com.sharp.questnative.source;

import android.util.Log;

import com.sharp.questnative.core.QnActivity;
import com.sharp.questnative.core.QnModule;

/** Java half of the source module (stub). Owner: encode-guide. Found by name by core ModuleLoader. */
public final class Module implements QnModule {
    @Override
    public void onCreate(QnActivity activity) {
        Log.i("QuestNative", "[source] Java module started (stub)");
    }
}
