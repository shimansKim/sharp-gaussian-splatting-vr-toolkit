package com.sharp.questnative.ui;

import com.sharp.questnative.ui.hud.Hud;
import com.sharp.questnative.ui.hud.HudControl;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Lays out HUD controls (docs/module-contract.md 14.2) as rows of widgets. Shared by the HUD panel
 * and the pages on the list panel (16). Owner: ui.
 */
final class ControlGrid {
    interface Actions {
        void action(String id, float value, int phase);
    }

    private ControlGrid() {}

    static float weight(HudControl c) {
        return c.kind == HudControl.SLIDER || c.kind == HudControl.SEEK ? 3 : c.kind == HudControl.CHOICE ? 2 : 1;
    }

    /**
     * Adds widgets for controls into the box. Rows are ordered by HudControl.row; each row splits
     * the width by weight. Returns the y below the last row.
     */
    static float layout(List<Widget> out, List<HudControl> controls, float left, float top, float right,
                        float bottom, float maxRowH, Actions actions) {
        if (controls.isEmpty()) return top;
        List<Integer> rowIds = new ArrayList<>();
        for (HudControl c : controls) if (!rowIds.contains(c.row)) rowIds.add(c.row);
        Collections.sort(rowIds);
        float rowH = Math.min(maxRowH, (bottom - top - 8 * (rowIds.size() - 1)) / rowIds.size());
        float y = top;
        for (Integer rowId : rowIds) {
            List<HudControl> row = new ArrayList<>();
            float total = 0;
            for (HudControl c : controls) {
                if (c.row == rowId) {
                    row.add(c);
                    total += weight(c);
                }
            }
            float x = left;
            float avail = right - left - 10 * (row.size() - 1);
            for (HudControl c : row) {
                float w = avail * weight(c) / total;
                Widget wd = make(c, actions);
                wd.enabled = wd.enabled && c.enabled;
                out.add(wd.at(x, y, x + w, y + rowH));
                x += w + 10;
            }
            y += rowH + 8;
        }
        return y;
    }

    static Widget make(HudControl c, Actions actions) {
        final String id = c.id;
        switch (c.kind) {
            case HudControl.TOGGLE: {
                Widgets.Button b = new Widgets.Button(id, c.label, c.icon, null);
                b.toggle = true;
                b.on = c.value >= 0.5f;
                b.onClick = () -> actions.action(id, b.on ? 0 : 1, Hud.PHASE_COMMIT);
                return b;
            }
            case HudControl.SLIDER:
            case HudControl.SEEK: {
                Widgets.Slider s = new Widgets.Slider(id, c.label, c.value, c.min, c.max, c.step, c.format,
                        (v, phase) -> actions.action(id, v, phase == 0 ? Hud.PHASE_CHANGE : Hud.PHASE_COMMIT));
                s.seek = c.kind == HudControl.SEEK;
                s.secondary = c.secondary;
                return s;
            }
            case HudControl.CHOICE:
                return new Widgets.Choice(id, c.label, c.options, Math.round(c.value),
                        (v, phase) -> actions.action(id, v, Hud.PHASE_COMMIT));
            case HudControl.LABEL: {
                Widgets.Label l = new Widgets.Label(c.label, Theme.TEXT, 24, false, false);
                l.id = id;
                return l;
            }
            default:
                return new Widgets.Button(id, c.label, c.icon, () -> actions.action(id, 1, Hud.PHASE_COMMIT));
        }
    }

    /** The value a shortcut button press should send for this control (toggle flips, choice steps). */
    static float shortcutValue(HudControl c) {
        switch (c.kind) {
            case HudControl.TOGGLE:
                return c.value >= 0.5f ? 0 : 1;
            case HudControl.CHOICE:
                return c.options.isEmpty() ? 0 : (Math.round(c.value) + 1) % c.options.size();
            default:
                return 1;
        }
    }
}
