package com.sharp.questnative.image;

import android.util.Log;

import com.sharp.questnative.core.QnActivity;
import com.sharp.questnative.core.QnModule;

/**
 * Java half of the image module. Owner: image-dev. Found by name by core ModuleLoader.
 *
 * <p>The module never opens files by itself (module-contract.md §12). To try a picture:
 * <pre>
 *   adb shell am start -n com.sharp.questnative/.core.QnActivity --es qn.open file:///sdcard/Pictures/a.jpg
 * </pre>
 */
public final class Module implements QnModule {
    @Override
    public void onCreate(QnActivity activity) {
        ImageBridge.init(activity);
        Log.i("QuestNative", "[image] Java module started");
    }
}
