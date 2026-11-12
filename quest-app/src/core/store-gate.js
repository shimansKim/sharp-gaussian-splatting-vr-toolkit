// 스토어판(VITE_STORE_BUILD=1) 전용: 앱이 Horizon Store에서 설치한 앱(TWA) 안에서 열렸는지 판별한다.
// 일반 브라우저로 주소를 직접 열면 앱 대신 "Horizon Store에서 설치하세요" 안내만 보여 준다(src/store-entry.js).
// 기본 빌드(플래그 꺼짐)는 이 파일을 쓰지 않는다.
//
// 판별은 보수적으로 한다: 정상 사용자가 막히는 것이 더 나쁘므로, 신호가 하나라도 있으면 통과시킨다.
//  1) document.referrer가 android-app://<TWA 패키지> 로 시작한다(TWA가 처음 페이지를 열 때 붙인다).
//     한 번 확인되면 sessionStorage에 기억한다. 같은 창 안에서 다시 불러오기(화질 변경·새 버전 적용)하면 referrer가 비기 때문이다.
//  2) 설치된 앱 화면(display-mode: standalone·fullscreen·minimal-ui, iOS navigator.standalone)으로 열렸다.
//     TWA는 standalone으로 열린다. 일반 브라우저 탭은 browser라서 여기서 걸러진다.

/** 허용하는 TWA 패키지(twa/twa-manifest.json, twa/twa-manifest.vr.json). 하위 패키지(이름.xxx)도 허용한다. */
export const TWA_PACKAGES = ["io.github.shimanskim.sharpquest", "io.github.shimanskim.sharpquest.vr"];

export const TWA_SESSION_KEY = "sharp-quest.in-twa";

/** referrer가 허용한 TWA 패키지에서 왔는가. 예: "android-app://io.github.shimanskim.sharpquest/" */
export function isTwaReferrer(referrer, packages = TWA_PACKAGES) {
  const match = /^android-app:\/\/([^/?#]+)/i.exec(String(referrer ?? "").trim());
  if (!match) return false;
  const pkg = match[1].toLowerCase();
  return packages.some((name) => pkg === name || pkg.startsWith(`${name}.`));
}

/** 설치된 앱 화면으로 열렸는가(보조 신호). matchMedia가 없거나 오류면 false. */
export function isStandaloneDisplay(win = globalThis) {
  try {
    if (win.navigator?.standalone === true) return true;
    return ["standalone", "fullscreen", "minimal-ui"].some((mode) => !!win.matchMedia?.(`(display-mode: ${mode})`)?.matches);
  } catch {
    return false;
  }
}

/**
 * 스토어 앱(TWA) 안에서 열렸는가. referrer로 확인되면 sessionStorage에 기억한다.
 * @param {{ referrer?: string, session?: { getItem(k: string): string|null, setItem(k: string, v: string): void } | null, standalone?: boolean }} env
 * @returns {{ allowed: boolean, via: 'referrer'|'session'|'standalone'|null }}
 */
export function detectStoreApp({ referrer = "", session = null, standalone = false } = {}) {
  if (isTwaReferrer(referrer)) {
    try {
      session?.setItem(TWA_SESSION_KEY, "1");
    } catch {
      /* 저장 불가 환경: 이번 화면에서만 통과 */
    }
    return { allowed: true, via: "referrer" };
  }
  try {
    if (session?.getItem(TWA_SESSION_KEY) === "1") return { allowed: true, via: "session" };
  } catch {
    /* 저장소를 못 읽으면 다음 신호로 */
  }
  if (standalone) return { allowed: true, via: "standalone" };
  return { allowed: false, via: null };
}

/** 브라우저 전역에서 판별한다. 어떤 이유로든 판별 자체가 실패하면 막지 않는다(보수적). */
export function detectStoreAppInBrowser(win = globalThis) {
  try {
    let session = null;
    try {
      session = win.sessionStorage ?? null;
    } catch {
      session = null;
    }
    return detectStoreApp({ referrer: win.document?.referrer ?? "", session, standalone: isStandaloneDisplay(win) });
  } catch {
    return { allowed: true, via: null };
  }
}
