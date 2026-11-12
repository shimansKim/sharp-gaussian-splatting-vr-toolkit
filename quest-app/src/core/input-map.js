// Quest 컨트롤러 입력 판정(공용). 어떤 입력이 어떤 동작인지는 core/bindings.js의 배정 표(기본값 + 사람이 바꾼 값)가 정하고,
// 이 파일은 그 표대로 이번 프레임의 입력을 읽는다(버튼 누름·짧게/길게, 스틱 축). 모든 뷰어가 여기 함수로만 판정한다.
// 사람이 읽는 조작표는 notes/quest-app-controls-ko.md, 바꾸는 곳은 앱 2D [설정]과 PC 설정 페이지(/settings/bindings).
//
// 기본 배정의 근거(Quest 기본 앱의 관례):
//  - 트리거 = 선택(레이로 가리킨 버튼·패널 누르기). Meta 시스템 UI·브라우저·Skybox·Quest TV가 모두 같다.
//  - 그립 = 잡기(Horizon·갤러리 3D 보기·Gravity Sketch 등에서 쥐어서 끌기, 두 손이면 크기).
//  - 오른쪽 스틱 = 시점·장면 회전(Meta 이동 표준은 좌우 스냅 회전). 영상 플레이어(Skybox·Quest TV)는 좌우가 되감기·빨리감기, 갤러리는 좌우 튕기기가 이전/다음 사진.
//    이 앱의 영상·사진은 사람 요청(실기기 2026-11-12)으로 두 스틱을 맞바꿨다: 왼쪽 스틱 = 화면 회전·L3 위치 맞춤, 오른쪽 스틱 = 좌우 되감기·이전/다음, 상하 줌. PLY는 그대로다.
//  - A/X = 확인·다음 단계, B/Y = 뒤로·메뉴. 앱마다 다르지만 B/Y가 취소·메뉴인 것은 공통.
//    판 2(사람 요청 2026-11-13): A = 파일 선택 화면, X 짧게·길게 = 이전·다음, 오른쪽 트리거(패널 밖) = 영상·사진 재생 컨트롤 표시·숨김, 재생·일시정지는 버튼 없음.
//  - 왼쪽 ≡(메뉴)와 오른쪽 Meta(오큘러스) 버튼은 WebXR에 넘어오지 않는다(시스템이 쓴다). 그래서 UI 켜기·끄기는 B/Y로 한다.
//  - B/Y 짧게 = 모든 UI(공용 패널·미디어 재생 컨트롤·PLY 안내) 켜기·끄기. 위치는 안 바뀐다.
//    B/Y 길게(HOLD_MS) = UI를 지금 보는 곳으로 옮기기. UI 위치는 이 길게 누르기와 패널의 [여기로 옮기기]로만 바뀐다(core/ui-state.js).
//  - 스틱 누르기(L3/R3)는 앱마다 자유. 뷰어 쪽에서 '맞춤'·'초기화' 같은 보조 동작에 쓴다.
//
// 스틱으로 장면을 돌리거나 움직일 때의 방향은 사람 요청대로 상하·좌우를 뒤집는다: "민 쪽으로 장면이 움직인다"
// (오른쪽으로 밀면 장면이 오른쪽으로 돈다 = 카메라는 왼쪽으로 돈다). 구현과 부호는 viewers/splat/splat-math.js의
// STICK_INVERT 한 곳에 있다. 뷰어가 스틱 회전·이동을 새로 넣으면 그 값을 가져다 쓴다(여기서 따로 정하지 않는다).

import { bindings as bindingStore, hasHoldSibling } from "./bindings.js";

/** 버튼을 이만큼(ms) 이상 누르고 있으면 "길게 누르기"다(기본: B/Y 길게 = UI 옮기기). */
export const HOLD_MS = 800;
/** 트리거·그립을 누른 것으로 보는 값 */
const PRESS_LEVEL = 0.6;

// ── 배정 표대로 입력 읽기 ─────────────────────────────────────────────────

const handsOf = (hand) => (hand === "either" ? ["left", "right"] : [hand]);

/** 버튼이 눌려 있는가(배정 값 기준, either면 두 손 중 아무 쪽). */
export function buttonDown(input, binding) {
  if (!binding) return false;
  return handsOf(binding.hand).some((hand) => {
    const h = input?.[hand];
    if (!h) return false;
    if (binding.button === "trigger") return (h.trigger ?? 0) > PRESS_LEVEL;
    if (binding.button === "grip") return (h.grip ?? 0) > PRESS_LEVEL;
    return !!h[binding.button];
  });
}

/** 이번 프레임에 버튼을 누르기 시작했는가(xr-stage가 계산한 *Pressed 값). */
export function buttonPressed(input, binding) {
  if (!binding) return false;
  return handsOf(binding.hand).some((hand) => !!input?.[hand]?.[`${binding.button}Pressed`]);
}

/** 스틱 한 축의 원래 값(x는 오른쪽 +, y는 아래 +, xr-standard 그대로). 지정 안 함이면 0. */
export function axisRaw(input, binding) {
  if (!binding) return 0;
  return input?.[binding.hand]?.[binding.axis] ?? 0;
}

/** 스틱 한 축을 "앞쪽이 +"로: 좌우는 오른쪽이 +, 상하는 위가 +. 줌·되감기·회전처럼 방향만 보는 동작이 쓴다. */
export function axisForward(input, binding) {
  if (!binding) return 0;
  const v = axisRaw(input, binding);
  return binding.axis === "y" ? -v : v;
}

/** 스틱 두 축 전체 { x, y }(원래 값). 지정 안 함이면 0. */
export function stickRaw(input, binding) {
  if (!binding) return { x: 0, y: 0 };
  const h = input?.[binding.hand];
  return { x: h?.x ?? 0, y: h?.y ?? 0 };
}

/** 두 축 동작이 같은 스틱의 서로 다른 축인가(대각선 분리·높이 막기 판단). */
export function sameStick(a, b) {
  return !!a && !!b && a.hand === b.hand && a.axis !== b.axis;
}

/**
 * 영상·사진의 되감기(넘기기)·줌 축 값. 둘이 같은 스틱의 다른 축이면 한 번에 한 가지만: 더 크게 민 축만 남긴다
 * (|좌우|>|상하|면 좌우, 같거나 작으면 상하 — core/stick-rules.js의 splitRightStick 규칙). 값은 "앞쪽이 +"다.
 * @returns {{ scrub: number, zoom: number }}
 */
export function mediaStickValues(input, map = bindingStore.get()) {
  const scrubB = map["media.scrub"];
  const zoomB = map["media.zoom"];
  let scrub = axisForward(input, scrubB);
  let zoom = axisForward(input, zoomB);
  if (sameStick(scrubB, zoomB)) {
    const horizontal = scrubB.axis === "x" ? scrub : zoom;
    const vertical = scrubB.axis === "x" ? zoom : scrub;
    const keepHorizontal = Math.abs(horizontal) > Math.abs(vertical);
    const scrubIsHorizontal = scrubB.axis === "x";
    if (keepHorizontal === scrubIsHorizontal) zoom = 0;
    else scrub = 0;
  }
  return { scrub, zoom };
}

/**
 * 범위 안 버튼 동작들의 이번 프레임 발생을 센다. 뷰어·공용 UI가 하나씩 갖고 매 프레임 update(input)을 한 번 부른다.
 * - mode 'hold': HOLD_MS 이상 누르면 한 번.
 * - mode 'press': 같은 버튼에 'hold' 동작이 함께 있으면 짧게 눌렀다 뗄 때, 없으면 누르는 순간 한 번.
 * @param {string[]} ids 이 판정기가 맡는 동작 id
 * @param {{ getBindings?: () => Record<string, any>, now?: () => number, holdMs?: number }} [options]
 */
export function createActionTracker(ids, { getBindings = () => bindingStore.get(), now = () => performance.now(), holdMs = HOLD_MS } = {}) {
  const timers = new Map(ids.map((id) => [id, createHoldTap({ holdMs, now })]));
  return {
    /** @returns {Set<string>} 이번 프레임에 일어난 동작 id */
    update(input) {
      const fired = new Set();
      if (!input?.presenting) {
        for (const t of timers.values()) t.reset();
        return fired;
      }
      const map = getBindings();
      for (const id of ids) {
        const b = map[id];
        const timer = timers.get(id);
        if (!b) {
          timer.reset();
          continue;
        }
        if (b.mode === "hold") {
          if (timer.update(buttonDown(input, b)) === "hold") fired.add(id);
        } else if (hasHoldSibling(map, id)) {
          if (timer.update(buttonDown(input, b)) === "tap") fired.add(id);
        } else {
          timer.reset();
          if (buttonPressed(input, b)) fired.add(id);
        }
      }
      return fired;
    },
    reset() {
      for (const t of timers.values()) t.reset();
    },
  };
}

/**
 * 이번 프레임에 눌린 이전·다음(공통). 누르는 순간만 본다(짧게/길게 구분이 필요하면 createActionTracker를 쓴다).
 * @param {import('./types.js').XrInput} input
 * @returns {Array<'prev'|'next'>}
 */
export function commonActions(input, map = bindingStore.get()) {
  if (!input.presenting) return [];
  const actions = [];
  if (buttonPressed(input, map["common.prev"])) actions.push("prev");
  if (buttonPressed(input, map["common.next"])) actions.push("next");
  return actions;
}

/**
 * 버튼 하나를 "짧게(탭)"와 "길게(홀드)"로 나눈다. 탭은 떼는 순간, 홀드는 holdMs가 지나는 순간 한 번만 나온다
 * (홀드가 나온 뒤 떼어도 탭은 나오지 않는다). createActionTracker가 버튼 동작마다 하나씩 쓴다(기본: B/Y 탭 = UI 켜기·끄기, 홀드 = 옮기기).
 * @param {{ holdMs?: number, now?: () => number }} [options]
 * @returns {{ update: (pressed: boolean) => 'tap' | 'hold' | null, reset: () => void, readonly holding: boolean }}
 */
export function createHoldTap({ holdMs = HOLD_MS, now = () => performance.now() } = {}) {
  let since = 0; // 누르기 시작한 시각(0이면 안 눌림)
  let fired = false;
  return {
    update(pressed) {
      const t = now();
      if (pressed) {
        if (!since) {
          since = t || 1;
          fired = false;
          return null;
        }
        if (!fired && t - since >= holdMs) {
          fired = true;
          return "hold";
        }
        return null;
      }
      if (!since) return null;
      const wasFired = fired;
      since = 0;
      fired = false;
      return wasFired ? null : "tap";
    },
    reset() {
      since = 0;
      fired = false;
    },
    /** 누르고 있는 중이며 아직 홀드가 나오지 않았다. */
    get holding() {
      return since !== 0 && !fired;
    },
  };
}

/**
 * 스틱 한 축을 "한 번 튕기기"로 바꾼다(밀면 1회, 중립으로 돌아와야 다시). 사진 이전/다음(media.scrub 배정 축)에 쓴다.
 * 간격은 프레임 수가 아니라 실제 시간(ms)으로 센다(프레임이 느려도 같게 동작).
 * @param {{ on?: number, off?: number, cooldownMs?: number, now?: () => number }} [options]
 * @returns {{ update: (x: number) => -1 | 0 | 1, reset: () => void }}
 */
export function createFlick({ on = 0.7, off = 0.4, cooldownMs = 350, now = () => performance.now() } = {}) {
  let armed = true;
  let blockedUntil = 0;
  return {
    update(x) {
      if (Math.abs(x) < off) {
        armed = true;
        return 0;
      }
      if (armed && now() >= blockedUntil && Math.abs(x) > on) {
        armed = false;
        blockedUntil = now() + cooldownMs;
        return x > 0 ? 1 : -1;
      }
      return 0;
    },
    reset() {
      armed = true;
      blockedUntil = 0;
    },
  };
}

/** 시스템이 쓰는 버튼(앱에 전달되지 않아 배정할 수 없다). 조작표에 안내로만 적는다. */
export const SYSTEM_BUTTONS = "메뉴(≡)·Meta 버튼";
