package com.sharp.questnative.ui;

import android.graphics.Canvas;
import android.graphics.Paint;
import android.util.Log;

import com.sharp.questnative.ui.hud.Hud;
import com.sharp.questnative.ui.hud.HudControl;
import com.sharp.questnative.ui.hud.HudModel;
import com.sharp.questnative.ui.hud.HudProvider;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Draws the active viewer's HUD model (docs/module-contract.md 14). Model comes from a Java
 * HudProvider (pulled here every 100 ms while visible) or from the C++ viewer (pushed by native).
 * Pages: "main", "more" ([더 보기] / [PLY 옵션]) and "diag" (diagnostics lines). Owner: ui.
 */
final class HudPanel extends Panel {
    private static final long PULL_MS = 100;

    private String viewerId = "";
    private String nativeJson;
    private HudModel model = new HudModel();
    private String page = "main";
    private boolean pulling;

    void setNativeModel(String id, String json) {
        boolean changedViewer = !id.equals(viewerId);
        viewerId = id;
        if (changedViewer) page = "main";
        if (provider() != null) {
            pullProvider();
            return;
        }
        if (json == null) {
            if (nativeJson != null || changedViewer) {
                nativeJson = null;
                model = new HudModel();
                relayout();
            }
            return;
        }
        if (!changedViewer && json.equals(nativeJson)) return;
        nativeJson = json;
        try {
            model = HudJson.parse(json);
        } catch (Exception e) {
            Log.w("QuestNative", "[ui] bad HUD json from " + id, e);
            model = new HudModel();
        }
        relayout();
    }

    void invalidateProvider() {
        if (provider() != null) pullProvider();
    }

    private HudProvider provider() {
        return viewerId.isEmpty() ? null : Hud.provider(viewerId);
    }

    @Override
    void onVisibility(boolean v) {
        if (v && !pulling) {
            pulling = true;
            pullLoop();
        }
    }

    private void pullLoop() {
        if (!visible) {
            pulling = false;
            return;
        }
        if (provider() != null) pullProvider();
        UiThread.postDelayed(this::pullLoop, PULL_MS);
    }

    private void pullProvider() {
        HudProvider p = provider();
        if (p == null) return;
        try {
            HudModel m = p.describe();
            model = m == null ? new HudModel() : m;
        } catch (Exception e) {
            Log.w("QuestNative", "[ui] HudProvider.describe failed (" + viewerId + ")", e);
            model = new HudModel();
        }
        relayout();
    }

    private void action(String id, float value, int phase) {
        UiBridge.nativeCommand("interact", 0);
        HudProvider p = provider();
        if (p != null) {
            try {
                p.onAction(id, value, phase);
            } catch (Exception e) {
                Log.w("QuestNative", "[ui] HudProvider.onAction failed (" + id + ")", e);
            }
            pullProvider();
        } else {
            UiBridge.nativeHudAction(id, value, phase);
        }
    }

    @Override
    void layout() {
        float pad = 20;
        // header: title + subtitle, status line, close
        Widgets.Label title = new Widgets.Label(model.title, Theme.TEXT, 30, true, true);
        title.at(pad, 10, width - 90, 50);
        widgets.add(title);
        Widgets.Label sub = new Widgets.Label(model.subtitle, Theme.TEXT_DIM, 22, false, true);
        sub.at(pad, 50, width - 90, 78);
        widgets.add(sub);
        widgets.add(new Widgets.Button("ui.hudClose", "", "close", () -> UiBridge.nativeCommand("hud.hide", 0))
                .at(width - 76, 12, width - 16, 72));
        float top = 84;
        if (!model.status.isEmpty()) {
            Widgets.Label st = new Widgets.Label(model.status, Theme.WARNING, 22, false, true);
            st.at(pad, 80, width - pad, 108);
            widgets.add(st);
            top = 112;
        }
        float dockTop = height - 80;

        if (page.equals("diag")) {
            float y = top;
            for (String line : model.diagnostics.isEmpty() ? Collections.singletonList("진단 정보가 없어요")
                    : model.diagnostics) {
                if (y + 30 > dockTop) break;
                Widgets.Label l = new Widgets.Label(line, Theme.TEXT, 20, false, true);
                l.at(pad, y, width - pad, y + 28);
                widgets.add(l);
                y += 30;
            }
        } else {
            layoutControls(pad, top, dockTop - 8);
        }

        // dock (ui-owned buttons, contract 14.4)
        List<Widgets.Button> dock = new ArrayList<>();
        if (page.equals("main")) {
            dock.add(new Widgets.Button("ui.prev", "이전", "prev", () -> UiBridge.navigate(-1)));
            dock.add(new Widgets.Button("ui.next", "다음", "next", () -> UiBridge.navigate(1)));
            dock.add(new Widgets.Button("ui.list", "목록", "list", () -> UiBridge.nativeCommand("list.open", 0)));
            boolean hasMore = false;
            for (HudControl c : model.controls) hasMore |= "more".equals(c.page);
            String moreLabel = "splat".equals(viewerId) ? "PLY 옵션" : "더 보기";
            Widgets.Button more = new Widgets.Button("ui.more", moreLabel, "more", () -> {
                page = "more";
                relayout();
            });
            more.enabled = hasMore;
            dock.add(more);
            dock.add(new Widgets.Button("ui.diag", "진단", "diag", () -> {
                page = "diag";
                relayout();
            }));
        } else {
            dock.add(new Widgets.Button("ui.back", "돌아가기", "", () -> {
                page = "main";
                relayout();
            }));
        }
        float bw = Math.min(200, (width - 2 * pad - 10 * (dock.size() - 1)) / dock.size());
        for (int i = 0; i < dock.size(); i++) {
            float x = pad + i * (bw + 10);
            widgets.add(dock.get(i).at(x, dockTop, x + bw, height - 14));
        }
    }

    private static float weight(HudControl c) {
        return c.kind == HudControl.SLIDER || c.kind == HudControl.SEEK ? 3 : c.kind == HudControl.CHOICE ? 2 : 1;
    }

    private void layoutControls(float pad, float top, float bottom) {
        List<HudControl> onPage = new ArrayList<>();
        for (HudControl c : model.controls) if (page.equals(c.page == null ? "main" : c.page)) onPage.add(c);
        if (onPage.isEmpty()) return;
        List<Integer> rowIds = new ArrayList<>();
        for (HudControl c : onPage) if (!rowIds.contains(c.row)) rowIds.add(c.row);
        Collections.sort(rowIds);
        float rowH = Math.min(68, (bottom - top - 8 * (rowIds.size() - 1)) / rowIds.size());
        for (int r = 0; r < rowIds.size(); r++) {
            List<HudControl> row = new ArrayList<>();
            float total = 0;
            for (HudControl c : onPage) {
                if (c.row == rowIds.get(r)) {
                    row.add(c);
                    total += weight(c);
                }
            }
            float y = top + r * (rowH + 8);
            float x = pad;
            float avail = width - 2 * pad - 10 * (row.size() - 1);
            for (HudControl c : row) {
                float w = avail * weight(c) / total;
                Widget wd = make(c);
                wd.enabled = wd.enabled && c.enabled;
                widgets.add(wd.at(x, y, x + w, y + rowH));
                x += w + 10;
            }
        }
    }

    private Widget make(HudControl c) {
        final String id = c.id;
        switch (c.kind) {
            case HudControl.TOGGLE: {
                Widgets.Button b = new Widgets.Button(id, c.label, c.icon, null);
                b.toggle = true;
                b.on = c.value >= 0.5f;
                b.onClick = () -> action(id, b.on ? 0 : 1, Hud.PHASE_COMMIT);
                return b;
            }
            case HudControl.SLIDER:
            case HudControl.SEEK: {
                Widgets.Slider s = new Widgets.Slider(id, c.label, c.value, c.min, c.max, c.step, c.format,
                        (v, phase) -> action(id, v, phase == 0 ? Hud.PHASE_CHANGE : Hud.PHASE_COMMIT));
                s.seek = c.kind == HudControl.SEEK;
                s.secondary = c.secondary;
                return s;
            }
            case HudControl.CHOICE:
                return new Widgets.Choice(id, c.label, c.options, Math.round(c.value),
                        (v, phase) -> action(id, v, Hud.PHASE_COMMIT));
            case HudControl.LABEL: {
                Widgets.Label l = new Widgets.Label(c.label, Theme.TEXT, 24, false, false);
                l.id = id;
                return l;
            }
            default:
                return new Widgets.Button(id, c.label, c.icon, () -> action(id, 1, Hud.PHASE_COMMIT));
        }
    }

    @Override
    void drawContent(Canvas c) {}
}
