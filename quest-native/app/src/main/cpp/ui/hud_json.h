// hud::Model -> JSON for the Java panel (parsed by com.sharp.questnative.ui.HudJson). Owner: ui.
#pragma once
#include <string>

#include "core/qn_hud.h"

namespace qn {
namespace ui {
std::string HudToJson(const hud::Model& model);
}  // namespace ui
}  // namespace qn
