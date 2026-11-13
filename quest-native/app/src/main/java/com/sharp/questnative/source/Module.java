package com.sharp.questnative.source;

import android.util.Log;

import com.sharp.questnative.core.QnActivity;
import com.sharp.questnative.core.QnModule;
import com.sharp.questnative.core.SourceRegistry;

/** Java half of the source module: registers the file sources. Owners: ui (device), encode-guide (PC, Drive). */
public final class Module implements QnModule {
    @Override
    public void onCreate(QnActivity activity) {
        SourceRegistry.register(new DeviceSource(activity));
        Log.i("QuestNative", "[source] device source registered");
    }
}
