// VR 안에서 "지정할 버튼을 누르세요" 상태로 사람이 누른 입력을 받아 배정 값으로 바꾼다(ui/vr-bindings-page.js가 쓴다).
// - 버튼 동작: 누른 손·버튼. 떼면 'press', HOLD_MS 넘게 누르고 있으면 'hold'. 스틱 누르기(L3/R3)도 버튼이다.
//   트리거는 패널 버튼을 누르는 데도 쓰므로, 레이가 패널 밖을 가리킬 때 당긴 트리거만 지정으로 받는다.
// - 축 동작: 스틱을 끝까지 민 손과 더 크게 민 축(좌우 x·상하 y).
// - 스틱 동작: 스틱을 끝까지 민 손.
// 지정이 끝나도 사람이 손을 다 떼기(버튼 놓고 스틱 가운데) 전까지는 settled가 false다: 그동안 그 입력이 다른 동작을 실행하지 않게 막는다.
import { HOLD_MS } from "./input-map.js";

const PRESS_LEVEL = 0.6;
const STICK_ON = 0.7;
const STICK_OFF = 0.3;
const BUTTONS = ["trigger", "grip", "primary", "secondary", "stick"];

function level(h, button) {
  if (!h) return false;
  if (button === "trigger") return (h.trigger ?? 0) > PRESS_LEVEL;
  if (button === "grip") return (h.grip ?? 0) > PRESS_LEVEL;
  return !!h[button];
}

/** 버튼·스틱이 하나도 눌리거나 밀리지 않았는가 */
export function inputIsNeutral(input) {
  for (const side of ["left", "right"]) {
    const h = input?.[side];
    if (!h) continue;
    if (BUTTONS.some((b) => level(h, b))) return false;
    if (Math.abs(h.x ?? 0) > STICK_OFF || Math.abs(h.y ?? 0) > STICK_OFF) return false;
  }
  return true;
}

/**
 * @param {{ kind: 'button'|'axis'|'stick', either?: boolean, holdMs?: number, now?: () => number }} options
 *   either: 버튼을 '양손(어느 손이든)'으로 지정한다(B/Y처럼).
 */
export function createBindingCapture({ kind, either = false, holdMs = HOLD_MS, now = () => performance.now() }) {
  /** 누르고 있는 버튼(떼거나 길게가 될 때까지) */
  let pending = null;
  /** 끝나면 값 */
  let result;
  return {
    get done() {
      return result !== undefined;
    },
    get value() {
      return result;
    },
    get pending() {
      return pending ? { ...pending } : null;
    },
    /**
     * 매 프레임. 끝났으면 배정 값을 돌려준다(그 전에는 undefined).
     * @param {import('./types.js').XrInput} input
     * @param {{ left?: boolean, right?: boolean }} [rayOnPanel] 그 손의 레이가 패널을 가리키는가(트리거는 패널 밖일 때만 받는다)
     */
    update(input, rayOnPanel = {}) {
      if (result !== undefined || !input?.presenting) return result;
      const t = now();
      if (kind === "button") {
        if (pending) {
          const down = level(input[pending.hand], pending.button);
          if (!down) result = { hand: either ? "either" : pending.hand, button: pending.button, mode: "press" };
          else if (t - pending.since >= holdMs) result = { hand: either ? "either" : pending.hand, button: pending.button, mode: "hold" };
          return result;
        }
        for (const side of ["left", "right"]) {
          const h = input[side];
          if (!h) continue;
          for (const button of BUTTONS) {
            if (!h[`${button}Pressed`]) continue;
            if (button === "trigger" && rayOnPanel[side]) continue; // 패널 버튼 누르기
            pending = { hand: side, button, since: t || 1 };
            return result;
          }
        }
        return result;
      }
      // 축·스틱: 끝까지 민 스틱
      let best = null;
      for (const side of ["left", "right"]) {
        const h = input[side];
        const x = Math.abs(h?.x ?? 0);
        const y = Math.abs(h?.y ?? 0);
        const m = Math.max(x, y);
        if (m > STICK_ON && (!best || m > best.m)) best = { side, m, axis: x > y ? "x" : "y" };
      }
      if (best) result = kind === "axis" ? { hand: best.side, axis: best.axis } : { hand: best.side };
      return result;
    },
  };
}
