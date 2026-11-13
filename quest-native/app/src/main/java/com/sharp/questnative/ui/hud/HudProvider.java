package com.sharp.questnative.ui.hud;

/**
 * HUD source for a viewer whose state lives on the Java side (e.g. video with Media3). Register with
 * {@link Hud#register}. C++ viewers implement qn::Viewer::DescribeHud/OnHudAction instead.
 * Both methods run on the ui draw thread (not main, not render): keep them fast and thread-safe.
 * Owner: ui.
 */
public interface HudProvider {
    /** Current controls. Called at most 10 times a second while the HUD is visible. */
    HudModel describe();

    /** phase: {@link Hud#PHASE_CHANGE} while dragging, {@link Hud#PHASE_COMMIT} for the final value. */
    void onAction(String controlId, float value, int phase);
}
