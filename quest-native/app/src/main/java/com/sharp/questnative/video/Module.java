package com.sharp.questnative.video;

import android.util.Log;

import com.sharp.questnative.core.QnActivity;
import com.sharp.questnative.core.QnModule;

/** Java half of the video module (stub). Owner: video-dev. Found by name by core ModuleLoader. */
public final class Module implements QnModule {
    @Override
    public void onCreate(QnActivity activity) {
        Log.i("QuestNative", "[video] Java module started (stub)");
    }
}
