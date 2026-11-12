// UI 켜기·끄기와 옮기기. 어느 버튼인지는 배정 표(core/bindings.js의 common.uiToggle·common.uiMove, 기본은 B/Y 짧게·길게)가 정한다.
//  - UI 켜기·끄기(기본 B/Y 짧게): 모든 UI(공용 패널·미디어 재생 컨트롤·PLY 안내) 켜기·끄기. 켜고 꺼도 위치는 바뀌지 않는다.
//    UI가 켜져 있는데 보이는 것이 하나도 없으면(패널도 재생 컨트롤도 안내도 닫힘) 패널을 연다 — 빈 화면에서 B/Y로 목록을 부르는 길.
//  - UI 옮기기(기본 B/Y 길게, HOLD_MS): UI를 지금 보는 곳으로 옮긴다(ui.relocate). 옮기면 UI가 켜지고, 보이는 것이 없으면 패널을 연다.
// 두 동작 모두 떼는 순간(짧게) 또는 HOLD_MS가 지나는 순간(길게)에 한 번만 일어난다(core/input-map.js createActionTracker).

import { createActionTracker } from "../core/input-map.js";

/**
 * @param {{
 *   ui: ReturnType<typeof import('../core/ui-state.js').createUiState>,
 *   camera: import('three').Camera,
 *   panel: { isOpen: boolean, wantsOpen: boolean, open: () => void, showMessage: (text: string) => void },
 *   viewerHasUi?: () => boolean,
 *   getBindings?: () => Record<string, any>,
 *   now?: () => number,
 * }} options
 */
export function createUiControls({ ui, camera, panel, viewerHasUi = () => false, getBindings, now }) {
  const tracker = createActionTracker(["common.uiToggle", "common.uiMove"], { ...(getBindings ? { getBindings } : {}), ...(now ? { now } : {}) });
  /** 켜 놓고도 아무것도 안 보이면 패널을 열어 준다. */
  function ensureSomethingShown() {
    if (!panel.wantsOpen && !viewerHasUi()) panel.open();
  }

  return {
    /**
     * 매 프레임 호출.
     * @param {import('../core/types.js').XrInput} input
     * @returns {'toggle' | 'relocate' | null} 이번 프레임에 일어난 동작
     */
    update(input) {
      const fired = tracker.update(input);
      if (fired.has("common.uiMove")) {
        ui.relocate(camera);
        ensureSomethingShown();
        panel.showMessage("UI를 지금 보는 곳으로 옮겼습니다");
        return "relocate";
      }
      if (fired.has("common.uiToggle")) {
        const anythingShown = ui.visible && (panel.isOpen || viewerHasUi());
        if (anythingShown) {
          ui.setVisible(false);
        } else {
          ui.setVisible(true);
          ensureSomethingShown();
        }
        return "toggle";
      }
      return null;
    },
  };
}
