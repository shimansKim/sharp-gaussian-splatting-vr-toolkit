package com.sharp.questnative.ui.hud;

import java.util.ArrayList;
import java.util.List;

/** A viewer's HUD as data. Same fields as qn::hud::Model (cpp/core/qn_hud.h). Owner: ui. */
public final class HudModel {
    public String title = "";
    public String subtitle = "";
    public String status = "";
    public final List<HudControl> controls = new ArrayList<>();
    public final List<String> diagnostics = new ArrayList<>();

    public HudModel add(HudControl c) {
        controls.add(c);
        return this;
    }
}
