// HUD connection contract (C++ side). Owner: foundation; drawn by the ui module.
// Viewers describe their controls as data; the ui module draws them on its panels and sends the
// user's commands back. Viewers never draw HUD pixels themselves. See docs/module-contract.md §14.
// The Java mirror is com.sharp.questnative.ui.hud (HudModel, HudControl, HudProvider).
#pragma once

#include <string>
#include <vector>

namespace qn {
namespace hud {

enum class Kind {
    kButton,  // press -> OnHudAction(id, 1, kCommit)
    kToggle,  // value 0/1; press -> OnHudAction(id, newValue, kCommit)
    kSlider,  // min..max (step); drag -> kChange..., release -> kCommit
    kSeek,    // value = position s, max = duration s, secondary = buffered s; drag -> kChange..., release -> kCommit
    kChoice,  // options[value]; ◀ ▶ -> OnHudAction(id, newIndex, kCommit)
    kLabel,   // text only (label), not clickable
};

enum class Phase {
    kChange,  // continuous change while dragging (preview; may arrive every frame)
    kCommit,  // final value (button press, release of a drag)
};

struct Control {
    std::string id;     // stable id; see the recommended ids in module-contract.md §14.4
    Kind kind = Kind::kButton;
    std::string label;  // Korean text shown to the user
    std::string icon;   // optional icon name from §14.5 ("play", "pause", ...); empty = text only
    float value = 0, min = 0, max = 1, step = 0;  // step 0 = continuous
    float secondary = 0;                         // kSeek: buffered position
    std::string format;  // value display: "time" (mm:ss), "percent", "x" (1.25x), "" (none)
    std::vector<std::string> options;  // kChoice labels
    bool enabled = true;
    std::string page = "main";  // "main" (always visible) or "more" ([더 보기] page)
    int row = 0;                // controls with the same row on a page share a line, in order
};

struct Model {
    std::string title;      // e.g. file name
    std::string subtitle;   // e.g. "VR180 좌우 · 3840×1920 · 2 / 9"
    std::string status;     // one warning/notice line, empty = none
    std::vector<Control> controls;
    std::vector<std::string> diagnostics;  // shown only when the user turns on diagnostics
};

}  // namespace hud
}  // namespace qn
