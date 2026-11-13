// Controller actions: every physical control is its own action, so button remapping can happen
// in the app (same model as quest-app core/bindings.js). Owner: foundation.
#include <cstring>

#include "core/app.h"
#include "core/qn_log.h"
#include "core/xr_util.h"

namespace qn {

namespace {

XrPath Path(XrInstance inst, const char* s) {
    XrPath p = XR_NULL_PATH;
    xrStringToPath(inst, s, &p);
    return p;
}

bool MakeAction(XrInstance, XrActionSet set, XrActionType type, const char* name, const char* localized,
                const XrPath* subPaths, uint32_t subCount, XrAction* out) {
    XrActionCreateInfo ci{XR_TYPE_ACTION_CREATE_INFO};
    ci.actionType = type;
    strncpy(ci.actionName, name, XR_MAX_ACTION_NAME_SIZE - 1);
    strncpy(ci.localizedActionName, localized, XR_MAX_LOCALIZED_ACTION_NAME_SIZE - 1);
    ci.countSubactionPaths = subCount;
    ci.subactionPaths = subPaths;
    XR_TRY(xrCreateAction(set, &ci, out));
    return true;
}

void UpdateButton(Button& b, bool down) {
    b.pressed = down && !b.down;
    b.released = !down && b.down;
    b.down = down;
}

void UpdateAnalogButton(Button& b, float value) {
    bool down = b.down ? value > 0.45f : value > 0.55f;  // hysteresis
    UpdateButton(b, down);
}

}  // namespace

bool App::CreateActions() {
    XrInstance inst = xr_.instance;
    XrActionSetCreateInfo si{XR_TYPE_ACTION_SET_CREATE_INFO};
    strncpy(si.actionSetName, "qn", XR_MAX_ACTION_SET_NAME_SIZE - 1);
    strncpy(si.localizedActionSetName, "Quest Native", XR_MAX_LOCALIZED_ACTION_SET_NAME_SIZE - 1);
    XR_TRY(xrCreateActionSet(inst, &si, &actions_.set));

    actions_.handPath[kLeft] = Path(inst, "/user/hand/left");
    actions_.handPath[kRight] = Path(inst, "/user/hand/right");
    const XrPath* hands = actions_.handPath;
    auto set = actions_.set;
    bool ok = MakeAction(inst, set, XR_ACTION_TYPE_POSE_INPUT, "aim", "Aim", hands, 2, &actions_.aim) &&
              MakeAction(inst, set, XR_ACTION_TYPE_POSE_INPUT, "grip", "Grip pose", hands, 2, &actions_.grip) &&
              MakeAction(inst, set, XR_ACTION_TYPE_FLOAT_INPUT, "trigger", "Trigger", hands, 2, &actions_.trigger) &&
              MakeAction(inst, set, XR_ACTION_TYPE_FLOAT_INPUT, "squeeze", "Squeeze", hands, 2, &actions_.squeeze) &&
              MakeAction(inst, set, XR_ACTION_TYPE_VECTOR2F_INPUT, "stick", "Thumbstick", hands, 2, &actions_.stick) &&
              MakeAction(inst, set, XR_ACTION_TYPE_BOOLEAN_INPUT, "stick_click", "Thumbstick click", hands, 2,
                         &actions_.stickClick) &&
              MakeAction(inst, set, XR_ACTION_TYPE_BOOLEAN_INPUT, "primary", "A / X", hands, 2, &actions_.primary) &&
              MakeAction(inst, set, XR_ACTION_TYPE_BOOLEAN_INPUT, "secondary", "B / Y", hands, 2,
                         &actions_.secondary) &&
              MakeAction(inst, set, XR_ACTION_TYPE_BOOLEAN_INPUT, "menu", "Menu", hands, 2, &actions_.menu) &&
              MakeAction(inst, set, XR_ACTION_TYPE_VIBRATION_OUTPUT, "haptic", "Haptic", hands, 2, &actions_.haptic);
    if (!ok) return false;

    struct B {
        XrAction a;
        const char* path;
    };
    const B binds[] = {
        {actions_.aim, "/user/hand/left/input/aim/pose"},
        {actions_.aim, "/user/hand/right/input/aim/pose"},
        {actions_.grip, "/user/hand/left/input/grip/pose"},
        {actions_.grip, "/user/hand/right/input/grip/pose"},
        {actions_.trigger, "/user/hand/left/input/trigger/value"},
        {actions_.trigger, "/user/hand/right/input/trigger/value"},
        {actions_.squeeze, "/user/hand/left/input/squeeze/value"},
        {actions_.squeeze, "/user/hand/right/input/squeeze/value"},
        {actions_.stick, "/user/hand/left/input/thumbstick"},
        {actions_.stick, "/user/hand/right/input/thumbstick"},
        {actions_.stickClick, "/user/hand/left/input/thumbstick/click"},
        {actions_.stickClick, "/user/hand/right/input/thumbstick/click"},
        {actions_.primary, "/user/hand/left/input/x/click"},
        {actions_.primary, "/user/hand/right/input/a/click"},
        {actions_.secondary, "/user/hand/left/input/y/click"},
        {actions_.secondary, "/user/hand/right/input/b/click"},
        {actions_.menu, "/user/hand/left/input/menu/click"},
        {actions_.haptic, "/user/hand/left/output/haptic"},
        {actions_.haptic, "/user/hand/right/output/haptic"},
    };
    std::vector<XrActionSuggestedBinding> sb;
    for (auto& b : binds) sb.push_back({b.a, Path(inst, b.path)});
    XrInteractionProfileSuggestedBinding ps{XR_TYPE_INTERACTION_PROFILE_SUGGESTED_BINDING};
    ps.interactionProfile = Path(inst, "/interaction_profiles/oculus/touch_controller");
    ps.countSuggestedBindings = (uint32_t)sb.size();
    ps.suggestedBindings = sb.data();
    XR_TRY(xrSuggestInteractionProfileBindings(inst, &ps));

    for (int h = 0; h < 2; ++h) {
        XrActionSpaceCreateInfo asi{XR_TYPE_ACTION_SPACE_CREATE_INFO};
        asi.subactionPath = actions_.handPath[h];
        asi.poseInActionSpace.orientation.w = 1.0f;
        asi.action = actions_.aim;
        XR_TRY(xrCreateActionSpace(xr_.session, &asi, &actions_.aimSpace[h]));
        asi.action = actions_.grip;
        XR_TRY(xrCreateActionSpace(xr_.session, &asi, &actions_.gripSpace[h]));
    }
    XrSessionActionSetsAttachInfo att{XR_TYPE_SESSION_ACTION_SETS_ATTACH_INFO};
    att.countActionSets = 1;
    att.actionSets = &actions_.set;
    XR_TRY(xrAttachSessionActionSets(xr_.session, &att));
    return true;
}

void App::SyncInput(XrTime time, InputState& out) {
    InputState prev = out;
    out = InputState{};
    out.time = time;
    out.focused = focused_;
    if (!focused_) return;  // edges reset; modules get an all-zero state

    XrActiveActionSet active{actions_.set, XR_NULL_PATH};
    XrActionsSyncInfo sync{XR_TYPE_ACTIONS_SYNC_INFO};
    sync.countActiveActionSets = 1;
    sync.activeActionSets = &active;
    if (XR_FAILED(xrSyncActions(xr_.session, &sync))) return;

    for (int h = 0; h < 2; ++h) {
        HandInput& hi = out.hand[h];
        const HandInput& ph = prev.hand[h];
        hi.triggerButton = ph.triggerButton;
        hi.squeezeButton = ph.squeezeButton;
        hi.stickClick = ph.stickClick;
        hi.primary = ph.primary;
        hi.secondary = ph.secondary;
        hi.menu = ph.menu;

        XrActionStateGetInfo gi{XR_TYPE_ACTION_STATE_GET_INFO};
        gi.subactionPath = actions_.handPath[h];

        XrActionStatePose pose{XR_TYPE_ACTION_STATE_POSE};
        gi.action = actions_.aim;
        xrGetActionStatePose(xr_.session, &gi, &pose);
        hi.active = pose.isActive;

        XrActionStateFloat f{XR_TYPE_ACTION_STATE_FLOAT};
        gi.action = actions_.trigger;
        if (XR_SUCCEEDED(xrGetActionStateFloat(xr_.session, &gi, &f))) hi.trigger = f.currentState;
        gi.action = actions_.squeeze;
        if (XR_SUCCEEDED(xrGetActionStateFloat(xr_.session, &gi, &f))) hi.squeeze = f.currentState;
        XrActionStateVector2f v{XR_TYPE_ACTION_STATE_VECTOR2F};
        gi.action = actions_.stick;
        if (XR_SUCCEEDED(xrGetActionStateVector2f(xr_.session, &gi, &v))) hi.stick = v.currentState;

        auto boolState = [&](XrAction a) {
            XrActionStateBoolean b{XR_TYPE_ACTION_STATE_BOOLEAN};
            gi.action = a;
            return XR_SUCCEEDED(xrGetActionStateBoolean(xr_.session, &gi, &b)) && b.currentState;
        };
        UpdateButton(hi.stickClick, boolState(actions_.stickClick));
        UpdateButton(hi.primary, boolState(actions_.primary));
        UpdateButton(hi.secondary, boolState(actions_.secondary));
        UpdateButton(hi.menu, boolState(actions_.menu));
        UpdateAnalogButton(hi.triggerButton, hi.trigger);
        UpdateAnalogButton(hi.squeezeButton, hi.squeeze);

        XrSpaceLocation loc{XR_TYPE_SPACE_LOCATION};
        const XrSpaceLocationFlags valid = XR_SPACE_LOCATION_POSITION_VALID_BIT | XR_SPACE_LOCATION_ORIENTATION_VALID_BIT;
        if (XR_SUCCEEDED(xrLocateSpace(actions_.aimSpace[h], xr_.appSpace, time, &loc)) &&
            (loc.locationFlags & valid) == valid) {
            hi.aim = loc.pose;
            hi.aimValid = true;
        }
        loc = {XR_TYPE_SPACE_LOCATION};
        if (XR_SUCCEEDED(xrLocateSpace(actions_.gripSpace[h], xr_.appSpace, time, &loc)) &&
            (loc.locationFlags & valid) == valid) {
            hi.grip = loc.pose;
            hi.gripValid = true;
        }
    }
}

void App::Haptic(Hand hand, float amplitude, float seconds) {
    if (!actions_.haptic || !focused_) return;
    XrHapticVibration vib{XR_TYPE_HAPTIC_VIBRATION};
    vib.amplitude = amplitude;
    vib.duration = (XrDuration)(seconds * 1e9);
    vib.frequency = XR_FREQUENCY_UNSPECIFIED;
    XrHapticActionInfo hi{XR_TYPE_HAPTIC_ACTION_INFO};
    hi.action = actions_.haptic;
    hi.subactionPath = actions_.handPath[hand];
    xrApplyHapticFeedback(xr_.session, &hi, (const XrHapticBaseHeader*)&vib);
}

void App::DestroyActions() {
    for (int h = 0; h < 2; ++h) {
        if (actions_.aimSpace[h]) xrDestroySpace(actions_.aimSpace[h]);
        if (actions_.gripSpace[h]) xrDestroySpace(actions_.gripSpace[h]);
    }
    if (actions_.set) xrDestroyActionSet(actions_.set);  // destroys its actions
    actions_ = ActionHandles{};
}

}  // namespace qn
