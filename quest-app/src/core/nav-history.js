// 뒤로 가기(브라우저·TWA·Quest B/뒤로 버튼)가 앱을 끄지 않게 한다.
// 되돌릴 단계(layer)가 하나라도 있으면(VR 중 / 항목을 보는 중 / 폴더 안) 기록에 "가드" 한 칸을 더 쌓아 둔다.
// 뒤로 가기가 그 가드를 꺼내면(popstate) 맨 위 단계 하나만 되돌리고, 단계가 남았으면 가드를 다시 쌓는다.
// 단계가 모두 사라지면(목록 최상위) 가드를 치워 두므로, 그 상태의 뒤로 가기만 앱(브라우저)을 끝낸다.
//
// 단계 순서(위가 먼저 되돌려짐): vr → viewer → folder.
//   vr     VR 종료(stage.exitVR)
//   viewer 보던 항목 닫고 목록으로(library.close)
//   folder 상위 폴더로(library.upFolder)

/** @typedef {'vr'|'viewer'|'folder'} NavLayer */

const ORDER = /** @type {const} */ (["vr", "viewer", "folder"]);

/**
 * @param {{
 *   win?: { history: History, addEventListener: Function },
 *   layers: () => NavLayer[],
 *   pop: Record<NavLayer, () => unknown>,
 * }} options
 */
export function createNavHistory({ win = window, layers, pop }) {
  const history = win.history;
  /** 기록에 가드 한 칸이 쌓여 있다고 믿는지 */
  let guarded = false;
  /** 가드를 치우려고 history.back()을 부른 뒤 popstate를 기다리는 중 */
  let removing = false;

  const top = () => ORDER.find((name) => layers().includes(name)) ?? null;

  /** 되돌릴 단계가 있으면 가드를 쌓고, 없으면 치운다. 상태가 바뀔 때마다 부른다. */
  function sync() {
    if (removing) return;
    const need = top() !== null;
    if (need && !guarded) {
      try {
        history.pushState({ sharpGuard: true }, "");
        guarded = true;
      } catch {
        /* 기록을 쓸 수 없는 환경이면 뒤로 가기는 브라우저 기본 동작 */
      }
    } else if (!need && guarded) {
      removing = true;
      history.back();
    }
  }

  win.addEventListener("popstate", () => {
    if (removing) {
      // 우리가 가드를 치운 것이다. 그 사이 상태가 또 바뀌었을 수 있으니 다시 맞춘다.
      removing = false;
      guarded = false;
      sync();
      return;
    }
    if (!guarded) return; // 우리가 모르는 이동(앞으로 가기 등)
    guarded = false; // 사용자의 뒤로 가기가 가드를 꺼냈다
    const layer = top();
    if (layer) {
      try {
        const result = pop[layer]();
        if (result && typeof result.catch === "function") result.catch((error) => console.error("[nav] 되돌리기 실패", layer, error));
      } catch (error) {
        console.error("[nav] 되돌리기 실패", layer, error);
      }
    }
    sync();
  });

  // 새로고침 뒤에는 이전 가드 기록이 남아 있을 수 있다. 상태 표시만 지운다.
  try {
    if (history.state?.sharpGuard) history.replaceState(null, "");
  } catch {
    /* 무시 */
  }

  return {
    sync,
    get guarded() {
      return guarded;
    },
  };
}
