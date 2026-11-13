package com.sharp.questnative.video;

import android.util.Log;

import com.sharp.questnative.core.QnActivity;
import com.sharp.questnative.core.QnModule;
import com.sharp.questnative.ui.UiPages;
import com.sharp.questnative.ui.hud.Hud;

/**
 * Java half of the video module: starts the player thread, registers the HUD provider and the
 * decoder diagnostics page ([설정] > [진단], contract 16). Found by name by core ModuleLoader.
 * Modules never open files by themselves (module-contract.md 12); tests use the qn.open intent extra.
 * Owner: video-dev.
 */
public final class Module implements QnModule {
    @Override
    public void onCreate(QnActivity activity) {
        VideoPlayer.init(activity);
        DiagRunner.init(activity);
        Hud.register("video", new VideoHud());
        UiPages.register(new DiagPage());
        Log.i("QuestNative", "[video] Java module started; diagnostics folder " + DiagRunner.baseDir());
    }

    @Override
    public void onDestroy() {
        Hud.unregister("video");
        UiPages.unregister(DiagPage.ID);
        DiagRunner.shutdown();
        VideoPlayer.shutdown();
    }
}
