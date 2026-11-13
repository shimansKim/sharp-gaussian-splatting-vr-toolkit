// hud::Model -> JSON. Owner: ui.
#include "ui/hud_json.h"

#include <cstdio>

namespace qn {
namespace ui {

namespace {

void Str(std::string& out, const std::string& s) {
    out += '"';
    for (unsigned char c : s) {
        switch (c) {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:
                if (c < 0x20) {
                    char buf[8];
                    snprintf(buf, sizeof(buf), "\\u%04x", c);
                    out += buf;
                } else {
                    out += (char)c;  // UTF-8 bytes pass through
                }
        }
    }
    out += '"';
}

void Num(std::string& out, float v) {
    char buf[32];
    snprintf(buf, sizeof(buf), "%.6g", v);
    out += buf;
}

void Key(std::string& out, const char* k) {
    out += '"';
    out += k;
    out += "\":";
}

}  // namespace

std::string HudToJson(const hud::Model& m) {
    std::string o = "{";
    Key(o, "title"); Str(o, m.title); o += ',';
    Key(o, "subtitle"); Str(o, m.subtitle); o += ',';
    Key(o, "status"); Str(o, m.status); o += ',';
    Key(o, "diagnostics"); o += '[';
    for (size_t i = 0; i < m.diagnostics.size(); ++i) {
        if (i) o += ',';
        Str(o, m.diagnostics[i]);
    }
    o += "],";
    Key(o, "controls"); o += '[';
    for (size_t i = 0; i < m.controls.size(); ++i) {
        const auto& c = m.controls[i];
        if (i) o += ',';
        o += '{';
        Key(o, "id"); Str(o, c.id); o += ',';
        Key(o, "kind"); Num(o, (float)(int)c.kind); o += ',';
        Key(o, "label"); Str(o, c.label); o += ',';
        Key(o, "icon"); Str(o, c.icon); o += ',';
        Key(o, "value"); Num(o, c.value); o += ',';
        Key(o, "min"); Num(o, c.min); o += ',';
        Key(o, "max"); Num(o, c.max); o += ',';
        Key(o, "step"); Num(o, c.step); o += ',';
        Key(o, "secondary"); Num(o, c.secondary); o += ',';
        Key(o, "format"); Str(o, c.format); o += ',';
        Key(o, "options"); o += '[';
        for (size_t k = 0; k < c.options.size(); ++k) {
            if (k) o += ',';
            Str(o, c.options[k]);
        }
        o += "],";
        Key(o, "enabled"); o += c.enabled ? "true" : "false"; o += ',';
        Key(o, "page"); Str(o, c.page); o += ',';
        Key(o, "row"); Num(o, (float)c.row);
        o += '}';
    }
    o += "]}";
    return o;
}

}  // namespace ui
}  // namespace qn
