package com.sharp.questnative.splat;

import android.util.Log;

import com.sharp.questnative.core.QnActivity;
import com.sharp.questnative.core.QnModule;

/** Java half of the splat module (stub). Owner: splat-dev. Found by name by core ModuleLoader. */
public final class Module implements QnModule {
    @Override
    public void onCreate(QnActivity activity) {
        Log.i("QuestNative", "[splat] Java module started (stub)");
    }
}
