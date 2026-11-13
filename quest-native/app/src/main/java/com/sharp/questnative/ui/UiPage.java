package com.sharp.questnative.ui;

import com.sharp.questnative.ui.hud.HudModel;

/**
 * A page another module puts on the shared list panel: a settings section (PC address, Drive
 * sign-in, ...) or a diagnostics screen (codec list, test-video measurement, ...). The page is
 * described with the same data as the HUD (HudModel: title, controls, diagnostics lines) and drawn
 * by the ui module. Register with {@link UiPages#register}. docs/module-contract.md 16. Owner: ui.
 * describe/onAction run on the ui draw thread: keep them fast and thread-safe.
 */
public interface UiPage {
    String GROUP_SETTINGS = "settings";
    String GROUP_DIAGNOSTICS = "diagnostics";

    /** Stable id, e.g. "source.pc", "video.diag". */
    String id();

    /** Shown in the menu and as the page title, Korean. */
    String title();

    /** {@link #GROUP_SETTINGS} or {@link #GROUP_DIAGNOSTICS}. */
    String group();

    /** Current content; pulled at most 10 times a second while the page is open. */
    HudModel describe();

    /** Same meaning as HudProvider.onAction (phase: Hud.PHASE_CHANGE / PHASE_COMMIT). */
    void onAction(String controlId, float value, int phase);
}
