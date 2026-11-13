// Calls any module may make into the ui module (render thread only). Owner: ui.
// See docs/module-contract.md §14.
#pragma once

#include <string>

namespace qn {
namespace ui {

// Short notice near the HUD/panel, e.g. "형식: VR180 좌우". seconds <= 0 uses the default (3 s).
void Toast(const std::string& text, float seconds = 0);

// The active viewer's HUD model changed; the ui module pulls DescribeHud before the next draw.
void InvalidateHud();

// Show or hide the active viewer's HUD (e.g. video: trigger outside panels toggles it).
void SetHudVisible(bool visible);
bool HudVisible();

// True while the shared list panel is open (the viewer HUD is hidden then: one window at a time).
bool PanelOpen();

// The current media finished (video end). The ui module decides what happens next
// (slideshow -> next file, otherwise nothing).
void NotifyMediaEnded();

}  // namespace ui
}  // namespace qn
