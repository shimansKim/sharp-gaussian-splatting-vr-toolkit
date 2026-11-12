// B/Y(두 손 어느 쪽이든)로 하는 UI 조작. 그립·스틱·A/X는 쓰지 않는다(core/input-map.js의 COMMON_ACTIONS).
//  - 짧게 누르기: 모든 UI(공용 패널·미디어 재생 컨트롤·PLY 안내) 켜기·끄기. 켜고 꺼도 위치는 바뀌지 않는다.
//    UI가 켜져 있는데 보이는 것이 하나도 없으면(패널도 재생 컨트롤도 안내도 닫힘) 패널을 연다 — 빈 화면에서 B/Y로 목록을 부르는 길.
//  - 길게 누르기(HOLD_MS): UI를 지금 보는 곳으로 옮긴다(ui.relocate). 옮기면 UI가 켜지고, 보이는 것이 없으면 패널을 연다.
// 두 동작 모두 떼는 순간(짧게) 또는 HOLD_MS가 지나는 순간(길게)에 한 번만 일어난다.

import { createHoldTap } from "../core/input-map.js";

/**
 * @param {{
 *   ui: ReturnType<typeof import('../core/ui-state.js').createUiState>,
 *   camera: import('three').Camera,
 *   panel: { isOpen: boolean, wantsOpen: boolean, open: () => void, showMessage: (text: string) => void },
 *   viewerHasUi?: () => boolean,
 *   holdTap?: ReturnType<typeof createHoldTap>,
 * }} options
 */
export function createUiControls({ ui, camera, panel, viewerHasUi = () => false, holdTap = createHoldTap() }) {
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
      if (!input.presenting) {
        holdTap.reset();
        return null;
      }
      const event = holdTap.update(!!(input.left.secondary || input.right.secondary));
      if (event === "hold") {
        ui.relocate(camera);
        ensureSomethingShown();
        panel.showMessage("UI를 지금 보는 곳으로 옮겼습니다");
        return "relocate";
      }
      if (event === "tap") {
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
