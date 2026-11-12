// Quest 컨트롤러 조작 매핑(공용). 어느 뷰어든 같은 버튼이 같은 뜻이 되도록 여기서 정한다.
// 표(사람이 읽는 판)는 notes/quest-app-controls-ko.md. 이 파일의 BINDINGS가 원본이고, 표와 VR 패널 안내문이 이걸 쓴다.
//
// 근거(Quest 기본 앱의 관례):
//  - 트리거 = 선택(레이로 가리킨 버튼·패널 누르기). Meta 시스템 UI·브라우저·Skybox·Quest TV가 모두 같다.
//  - 그립 = 잡기(Horizon·갤러리 3D 보기·Gravity Sketch 등에서 쥐어서 끌기, 두 손이면 크기).
//  - 오른쪽 스틱 = 시점·장면 회전(Meta 이동 표준은 좌우 스냅 회전). 영상 플레이어(Skybox·Quest TV)는 좌우가 되감기·빨리감기, 갤러리는 좌우 튕기기가 이전/다음 사진.
//    이 앱의 영상·사진은 사람 요청(실기기 2026-11-12)으로 두 스틱을 맞바꿨다: 왼쪽 스틱 = 화면 회전·L3 위치 맞춤, 오른쪽 스틱 = 좌우 되감기·이전/다음, 상하 줌. PLY는 그대로다.
//  - A/X = 확인·다음 단계, B/Y = 뒤로·메뉴. 앱마다 다르지만 B/Y가 취소·메뉴인 것은 공통.
//  - 왼쪽 ≡(메뉴)와 오른쪽 Meta(오큘러스) 버튼은 WebXR에 넘어오지 않는다(시스템이 쓴다). 그래서 UI 켜기·끄기는 B/Y로 한다.
//  - B/Y 짧게 = 모든 UI(공용 패널·미디어 재생 컨트롤·PLY 안내) 켜기·끄기. 위치는 안 바뀐다.
//    B/Y 길게(HOLD_MS) = UI를 지금 보는 곳으로 옮기기. UI 위치는 이 길게 누르기와 패널의 [여기로 옮기기]로만 바뀐다(core/ui-state.js).
//  - 스틱 누르기(L3/R3)는 앱마다 자유. 뷰어 쪽에서 '맞춤'·'초기화' 같은 보조 동작에 쓴다.
//
// 스틱으로 장면을 돌리거나 움직일 때의 방향은 사람 요청대로 상하·좌우를 뒤집는다: "민 쪽으로 장면이 움직인다"
// (오른쪽으로 밀면 장면이 오른쪽으로 돈다 = 카메라는 왼쪽으로 돈다). 구현과 부호는 viewers/splat/splat-math.js의
// STICK_INVERT 한 곳에 있다. 뷰어가 스틱 회전·이동을 새로 넣으면 그 값을 가져다 쓴다(여기서 따로 정하지 않는다).

/** 모든 뷰어가 같게 쓰는 공통 버튼. 뷰어는 이 버튼들을 다른 뜻으로 쓰지 않는다. */
export const COMMON_ACTIONS = {
  prev: { hand: "left", button: "primary", label: "X: 이전 파일" },
  next: { hand: "right", button: "primary", label: "A: 다음 파일" },
  ui: { hand: "either", button: "secondary", label: "B/Y: UI 켜기·끄기" },
  uiMove: { hand: "either", button: "secondary", hold: true, label: "B/Y 길게: UI를 지금 보는 곳으로 옮기기" },
};

/** B/Y를 이만큼(ms) 이상 누르고 있으면 "길게 누르기"(UI 재배치)다. */
export const HOLD_MS = 800;

/**
 * 이번 프레임에 눌린 공통 동작들(B/Y의 UI 켜기·끄기·재배치는 createHoldTap이 따로 처리한다).
 * @param {import('./types.js').XrInput} input
 * @returns {Array<'prev'|'next'>}
 */
export function commonActions(input) {
  if (!input.presenting) return [];
  const actions = [];
  if (input.left.primaryPressed) actions.push("prev");
  if (input.right.primaryPressed) actions.push("next");
  return actions;
}

/**
 * 버튼 하나를 "짧게(탭)"와 "길게(홀드)"로 나눈다. 탭은 떼는 순간, 홀드는 holdMs가 지나는 순간 한 번만 나온다
 * (홀드가 나온 뒤 떼어도 탭은 나오지 않는다). B/Y에 쓴다: 탭 = UI 켜기·끄기, 홀드 = UI 재배치.
 * 두 손의 B/Y 중 먼저 누른 쪽을 따른다(pressed = 둘 중 하나라도 눌림).
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
 * 스틱 좌우를 "한 번 튕기기"로 바꾼다(밀면 1회, 중립으로 돌아와야 다시). 사진 이전/다음(오른쪽 스틱)에 쓴다.
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

/**
 * 조작표 원본. 표(notes)·VR 패널 안내가 이 배열을 쓴다.
 * 열: input(입력), common(모든 뷰어), splat(PLY), image(사진), video(영상)
 */
export const BINDINGS = [
  { input: "트리거", common: "선택(패널·재생 컨트롤을 레이로 눌러 고른다)", splat: "패널 선택만", image: "패널 밖을 누르면 컨트롤 표시·숨김", video: "패널 밖을 누르면 재생·일시정지" },
  { input: "그립", common: "잡기", splat: "한 손: 장면 잡아 이동·회전 / 두 손: 확대·축소", image: "쓰지 않음(UI·화면이 저절로 옮겨지지 않게)", video: "쓰지 않음(UI·화면이 저절로 옮겨지지 않게)" },
  { input: "왼쪽 스틱", common: "(패널이 열리면) 목록 위·아래 넘기기", splat: "이동(앞뒤·좌우)", image: "화면 회전(민 쪽으로 장면이 움직임, 상하좌우 반전)", video: "화면 회전(민 쪽으로 장면이 움직임, 상하좌우 반전)" },
  { input: "오른쪽 스틱", common: "(패널이 열리면) 목록 위·아래 넘기기", splat: "좌우: 30° 스냅 회전, 상하: 높이(민 쪽으로 장면이 움직임)", image: "좌우 한 번 튕기기: 이전·다음 사진, 상하: 줌(위로 밀면 확대)", video: "좌우: 10초 되감기·빨리감기, 상하: 줌(위로 밀면 확대)" },
  { input: "스틱 누르기", common: "뷰어의 보조 동작", splat: "오른쪽: 맞춤/1:1, 왼쪽: 크기 초기화", image: "왼쪽(L3): 화면을 지금 보는 방향 앞으로 맞춤", video: "왼쪽(L3): 화면을 지금 보는 방향 앞으로 맞춤" },
  { input: "X / A", common: "X: 이전 파일, A: 다음 파일(끝에서는 처음으로)", splat: "같음", image: "같음", video: "같음" },
  { input: "B / Y", common: "짧게: 모든 UI(패널·재생 컨트롤·PLY 안내) 켜기·끄기, 위치는 그대로 / 길게: UI를 지금 보는 곳으로 옮기기", splat: "같음", image: "같음", video: "같음" },
  { input: "메뉴(≡)·Meta 버튼", common: "시스템 예약: 앱에 전달되지 않음", splat: "-", image: "-", video: "-" },
];
