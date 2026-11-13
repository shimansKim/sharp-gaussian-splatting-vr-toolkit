package com.sharp.questnative.ui;

import com.sharp.questnative.ui.hud.HudControl;
import com.sharp.questnative.ui.hud.HudModel;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/** Parses the JSON made by cpp/ui/hud_json.cpp into a HudModel. Owner: ui. */
final class HudJson {
    private HudJson() {}

    static HudModel parse(String json) throws JSONException {
        JSONObject o = new JSONObject(json);
        HudModel m = new HudModel();
        m.title = o.optString("title");
        m.subtitle = o.optString("subtitle");
        m.status = o.optString("status");
        JSONArray diag = o.optJSONArray("diagnostics");
        if (diag != null) for (int i = 0; i < diag.length(); i++) m.diagnostics.add(diag.getString(i));
        JSONArray cs = o.optJSONArray("controls");
        if (cs != null) {
            for (int i = 0; i < cs.length(); i++) {
                JSONObject j = cs.getJSONObject(i);
                HudControl c = new HudControl();
                c.id = j.optString("id");
                c.kind = j.optInt("kind");
                c.label = j.optString("label");
                c.icon = j.optString("icon");
                c.value = (float) j.optDouble("value", 0);
                c.min = (float) j.optDouble("min", 0);
                c.max = (float) j.optDouble("max", 1);
                c.step = (float) j.optDouble("step", 0);
                c.secondary = (float) j.optDouble("secondary", 0);
                c.format = j.optString("format");
                JSONArray opts = j.optJSONArray("options");
                List<String> list = new ArrayList<>();
                if (opts != null) for (int k = 0; k < opts.length(); k++) list.add(opts.getString(k));
                c.options = list;
                c.enabled = j.optBoolean("enabled", true);
                c.page = j.optString("page", "main");
                c.row = j.optInt("row");
                m.controls.add(c);
            }
        }
        return m;
    }
}
