package com.sharp.questnative.video;

import android.util.Log;

import com.sharp.questnative.core.QnActivity;
import com.sharp.questnative.core.QnModule;
import com.sharp.questnative.core.SourceRegistry;
import com.sharp.questnative.ui.hud.Hud;

/**
 * Java half of the video module: starts the player thread, registers the HUD provider and the
 * "decoder diagnostics" source (list panel entry). Found by name by core ModuleLoader.
 * Modules never open files by themselves (module-contract.md 12); tests use the qn.open intent extra.
 * Owner: video-dev.
 */
public final class Module implements QnModule {
    @Override
    public void onCreate(QnActivity activity) {
        VideoPlayer.init(activity);
        DiagRunner.init(activity);
        Hud.register("video", new VideoHud());
        SourceRegistry.register(new DiagSource());
        Log.i("QuestNative", "[video] Java module started; diagnostics folder " + DiagRunner.baseDir());
    }

    @Override
    public void onDestroy() {
        Hud.unregister("video");
        DiagRunner.shutdown();
        VideoPlayer.shutdown();
    }
}
