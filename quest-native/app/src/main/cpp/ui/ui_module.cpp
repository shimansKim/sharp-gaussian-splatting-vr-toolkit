// ui module stub. Owner: UI owner (image-dev). Replace the body; keep the QN_REGISTER_MODULE line.
// Planned path (compare-ui.md): Java draws panels with android.graphics.Canvas into a Surface from
// Host::CreateSurfaceSwapchain; this module submits it as a quad layer (kOrderUi) and turns
// controller rays into panel pixels. inputPriority 100: the UI sees input before viewers.
#include "core/qn_api.h"
#include "core/qn_log.h"
#include "ui/ui_api.h"

namespace {

class UiModule final : public qn::Module {
public:
    void OnStart(qn::Host&) override { QN_LOGI("[ui] started (stub)"); }
    bool OnInput(const qn::InputState&) override { return false; }
};

qn::ModuleInfo Info() {
    qn::ModuleInfo info;
    info.id = "ui";
    info.kind = qn::ModuleKind::kOverlay;
    info.inputPriority = 100;
    info.create = [] { return std::make_unique<UiModule>(); };
    return info;
}

}  // namespace

QN_REGISTER_MODULE(Info());

// ui_api.h: stubs until the panel parts land (next PR).
namespace qn {
namespace ui {
namespace {
bool g_hudVisible = false;
}
void Toast(const std::string& text, float) { QN_LOGI("[ui] toast: %s", text.c_str()); }
void InvalidateHud() {}
void SetHudVisible(bool visible) { g_hudVisible = visible; }
bool HudVisible() { return g_hudVisible; }
bool PanelOpen() { return false; }
void NotifyMediaEnded() { QN_LOGI("[ui] media ended"); }
}  // namespace ui
}  // namespace qn
