package com.sharp.questnative.video;

import com.sharp.questnative.ui.UiPage;
import com.sharp.questnative.ui.hud.HudModel;

/**
 * The decoder diagnostics page in the list panel: [설정] > [진단] > 디코더 진단
 * (module-contract.md 16). Content and actions come from DiagRunner. Owner: video-dev.
 */
final class DiagPage implements UiPage {
    static final String ID = "video.diag";

    @Override
    public String id() {
        return ID;
    }

    @Override
    public String title() {
        return "디코더 진단";
    }

    @Override
    public String group() {
        return GROUP_DIAGNOSTICS;
    }

    @Override
    public HudModel describe() {
        return DiagRunner.describe();
    }

    @Override
    public void onAction(String controlId, float value, int phase) {
        DiagRunner.onAction(controlId, value, phase);
    }
}
