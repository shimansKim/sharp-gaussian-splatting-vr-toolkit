// VR 앱("SHARP VR" APK, 몰입 모드)으로 열렸을 때의 시작 동작. 주소가 `?vr=1`이면 2D 화면 없이 바로 VR로 들어간다.
//
// 배경(m34 실측): 2D 모드 APK·일반 PWA 창에서는 몰입 세션이 안 열린다. immersive 모드 APK("SHARP VR")만 몰입 세션을 준다.
// 그 앱은 아이콘을 누르면 바로 VR이므로, 앱이 스스로 VR에 들어가고(requestSession) 빈 화면이 되지 않게 파일 패널을 띄워야 한다.
//  - VR에서는 <input type=file> 선택창을 못 쓴다 → 마지막에 쓴 소스(없으면 PC)의 목록을 열어 둔다. 기기 파일은 2D 앱("SHARP 뷰어")이 맡는다.
//  - 세션이 시작되면 열린 파일이 없을 때 VR 패널을 바로 띄운다(소스 선택·목록).
//  - 자동 진입이 막히면(사용자 제스처가 필요한 환경) 첫 클릭·트리거·키 입력에서 다시 시도하고, 실패 이유는 상태줄에 보인다.

const SOURCE_KEY = "sharp-quest.last-source";
const SOURCES = ["library", "pc", "gdrive"]; // "이번에 연 파일"(session)은 VR에서 못 쓰므로 기억·복원하지 않는다
export const DEFAULT_VR_SOURCE = "pc";

/** VR 시작 실패를 사람이 읽을 문장으로. NotSupportedError는 2D 모드 앱·창에서 나는 전형적인 오류라 해결 방법을 붙인다. */
export function explainVrError(error) {
  const name = error?.name ?? "";
  const message = error?.message ?? String(error ?? "");
  const base = name && name !== "Error" ? `${name}: ${message}` : message;
  if (name === "NotSupportedError") return `${base} — 이 화면(2D 앱·창)에서는 VR을 열 수 없습니다. 'SHARP VR' 앱 또는 Quest 브라우저 탭에서 열어 주세요.`;
  if (name === "SecurityError" || name === "NotAllowedError") return `${base} — 사용자 동작(버튼 누르기)이 필요합니다. 'VR 보기' 버튼을 눌러 주세요.`;
  return base;
}

/** @param {string} search location.search */
export function isVrLaunch(search) {
  try {
    return new URLSearchParams(search).get("vr") === "1";
  } catch {
    return false;
  }
}

/** 마지막으로 본 소스 탭을 기억한다(VR 앱이 같은 목록으로 열리도록). 저장소를 못 쓰면 기억하지 않는다. */
export function createSourceMemory(storage = globalThis.localStorage) {
  return {
    load() {
      try {
        const value = storage?.getItem(SOURCE_KEY);
        return SOURCES.includes(value) ? value : null;
      } catch {
        return null;
      }
    },
    save(sourceId) {
      try {
        if (SOURCES.includes(sourceId)) storage?.setItem(SOURCE_KEY, sourceId);
      } catch {
        /* 무시 */
      }
    },
  };
}

/**
 * @param {{
 *   stage: { isVRSupported: () => Promise<boolean>, enterVR: () => Promise<void>, isPresenting: () => boolean },
 *   library: { setListSource: (id: string) => unknown, current: unknown },
 *   panel: { isOpen: boolean, openAfterPose: () => void },
 *   status: (text: string, kind?: string) => void,
 *   memory: ReturnType<typeof createSourceMemory>,
 *   on: (name: string, fn: (detail: any) => void) => () => void,
 *   win?: Pick<Window, 'addEventListener' | 'removeEventListener'>,
 *   fallbackSource?: string,
 * }} options
 * fallbackSource: 기억한 소스가 없을 때 열 목록(기본 PC). PC에 한 번도 연결한 적이 없으면 "library"(보관함)를 넘겨
 * PC 없이도 첫 화면이 오류 없이 열리게 한다(스토어 심사: PC 스트리밍 없이도 동작).
 */
export function startVrLaunch({ stage, library, panel, status, memory, on, win = window, fallbackSource = DEFAULT_VR_SOURCE }) {
  library.setListSource(memory.load() ?? fallbackSource);
  status("VR로 시작하는 중…");

  let entering = false;
  async function enter(reason) {
    if (entering || stage.isPresenting()) return;
    entering = true;
    try {
      await stage.enterVR();
    } catch (error) {
      status(`VR을 시작하지 못했습니다(${reason}): ${explainVrError(error)}`, "error");
      armRetry();
    } finally {
      entering = false;
    }
  }

  // 자동 진입이 사용자 동작을 요구하면, 첫 입력에서 다시 시도한다.
  const retryEvents = ["pointerdown", "keydown", "click"];
  let armed = false;
  function armRetry() {
    if (armed) return;
    armed = true;
    const once = () => {
      for (const name of retryEvents) win.removeEventListener(name, once);
      armed = false;
      enter("입력으로 다시 시도");
    };
    for (const name of retryEvents) win.addEventListener(name, once);
  }

  on("xr:sessionstart", () => {
    // 열린 파일이 없으면 패널을 바로 띄워 빈 화면을 피한다.
    status(""); // "VR로 시작하는 중…" 문구를 지운다
    // 바로 열면 카메라가 아직 헤드셋 자세를 받기 전이라 패널이 바닥·뒤쪽에 고정된다. 몇 프레임 뒤(패널이 정한다)에 연다.
    if (!library.current && !panel.isOpen) panel.openAfterPose();
  });

  return stage.isVRSupported().then((supported) => {
    if (!supported) {
      status("이 앱에서는 VR을 시작할 수 없습니다. 'SHARP VR'(몰입) 앱으로 열었는지 확인하세요.", "error");
      armRetry(); // 판정이 틀렸을 수 있으니 입력 때 한 번 더 시도한다
      return false;
    }
    return enter("자동").then(() => true);
  });
}
