// 새 버전 배포 뒤 옛 화면이 남아 생기는 "failed to fetch dynamically imported module"을 막는다.
//
// 원인: 배포하면 해시가 붙은 파일 이름(assets/spark.module-XXXX.js)이 바뀌고 Pages에서 옛 파일이 사라진다.
// 앱(TWA·탭)이 떠 있는 동안 서비스 워커가 새 버전으로 바뀌면 옛 캐시가 지워지는데,
// 이미 떠 있던 옛 화면이 나중에(PLY를 처음 열 때) 옛 해시의 청크를 요청하면 404(HTML)가 돌아와 실패한다.
//
// 대처: ① 청크를 못 받으면 한 번 자동으로 새로고침(무한 반복 방지) ② 새 서비스 워커가 제어권을 가져가면
// 보던 항목·VR이 없을 때 바로, 있으면 끝난 뒤에 새로고침 ③ 서비스 워커가 보이지 않는 옛 화면은 직접 새로고침한다(sw/shell-cache.js).
// 주의: ①(청크 실패)은 이미 동작이 실패한 뒤라 VR 중이어도 바로 새로고침한다(VR 세션은 끊긴다). ②③은 VR·보던 항목을 지키려고 미룬다.
// 표식은 sessionStorage에 두고, 쓸 수 없으면 window.name(같은 탭의 새로고침에서 유지됨)을 쓴다. 둘 다 안 되면 새로고침하지 않는다(무한 반복 방지).

const RELOAD_KEY = "sharp-quest.chunk-reload";
const RELOAD_WINDOW_MS = 60_000;

/** 동적 import·청크 로드 실패인지(브라우저마다 문구가 다르다). */
export function isChunkLoadError(error) {
  const text = `${error?.message ?? error ?? ""}`;
  return /dynamically imported module|Importing a module script failed|Unable to preload CSS|Failed to load module script/i.test(text);
}

/**
 * 짧은 시간 안에 이미 한 번 새로고침했으면 다시 하지 않는다(서버가 정말 고장일 때 무한 새로고침 방지).
 * @param {Pick<Storage, 'getItem' | 'setItem'> | null} storage
 * @param {() => number} now
 */
export function createReloadGuard(storage, now = () => Date.now()) {
  return {
    /** 새로고침해도 되면 true(그리고 기록한다) */
    tryReload() {
      if (!storage) return false; // 표식을 남길 수 없으면 반복될 수 있으니 새로고침하지 않는다
      try {
        const last = Number(storage.getItem(RELOAD_KEY) ?? 0);
        if (last && now() - last < RELOAD_WINDOW_MS) return false;
        storage.setItem(RELOAD_KEY, String(now()));
        return true;
      } catch {
        return false;
      }
    },
    /** 새로 시작한 직후인지(안내 문구용) */
    reloadedRecently() {
      try {
        const last = Number(storage?.getItem(RELOAD_KEY) ?? 0);
        return !!last && now() - last < RELOAD_WINDOW_MS;
      } catch {
        return false;
      }
    },
  };
}

/** window.name에 표식을 남기는 저장소(같은 탭에서 새로고침해도 유지된다). */
export function createNameStorage(win) {
  const read = () => {
    try {
      const value = JSON.parse(win.name || "{}");
      return value && typeof value === "object" ? value : {};
    } catch {
      return {}; // 다른 용도로 쓰던 window.name이면 건드리지 않고 비운 것으로 본다
    }
  };
  return {
    getItem: (key) => read()[key] ?? null,
    setItem: (key, value) => {
      win.name = JSON.stringify({ ...read(), [key]: value });
    },
  };
}

function safeSession() {
  try {
    const session = globalThis.sessionStorage;
    if (session) {
      const probe = "sharp-quest.probe";
      session.setItem(probe, "1"); // 접근만 되고 쓰기가 막힌 환경 거르기
      session.removeItem(probe);
      return session;
    }
  } catch {
    /* 아래 대체 저장소로 */
  }
  return globalThis.window ? createNameStorage(globalThis.window) : null;
}

/**
 * @param {{
 *   win?: Window,
 *   storage?: Storage | null,
 *   reload?: () => void,
 *   notify?: (text: string) => void,
 *   canReloadNow: () => boolean,
 * }} options
 *   canReloadNow: 지금 새로고침해도 보던 것이 없는지(VR 중·항목을 보는 중이면 false)
 */
export function installUpdateGuard({ win = window, storage = safeSession(), reload = () => win.location.reload(), notify = () => {}, canReloadNow }) {
  const guard = createReloadGuard(storage);
  let pending = false;

  function reloadFor(reason) {
    if (!guard.tryReload()) return false;
    notify(reason);
    reload();
    return true;
  }

  // 청크 로드 실패: 지금 하던 동작은 어차피 실패했으니 바로 새로고침한다.
  win.addEventListener("vite:preloadError", (event) => {
    event.preventDefault?.();
    reloadFor("새 버전을 받아 다시 시작합니다…");
  });
  win.addEventListener("unhandledrejection", (event) => {
    if (isChunkLoadError(event.reason)) reloadFor("새 버전을 받아 다시 시작합니다…");
  });

  // 새 서비스 워커가 제어권을 가져갔다(처음 설치는 제외): 새 파일 이름으로 바뀌었을 수 있다.
  const serviceWorker = win.navigator?.serviceWorker;
  const hadController = !!serviceWorker?.controller;
  function onUpdated() {
    if (canReloadNow()) reloadFor("새 버전이 적용되어 다시 시작합니다…");
    else pending = true;
  }
  if (hadController) {
    serviceWorker.addEventListener("controllerchange", onUpdated);
    serviceWorker.addEventListener("message", (event) => {
      if (event.data?.type === "sharp:updated") onUpdated();
    });
  }

  return {
    /** 보던 항목이 닫히거나 VR이 끝났을 때 부른다: 미뤄 둔 새로고침을 한다. */
    flush() {
      if (pending && canReloadNow()) {
        pending = false;
        reloadFor("새 버전이 적용되어 다시 시작합니다…");
      }
    },
    get pending() {
      return pending;
    },
    wasReloaded: () => guard.reloadedRecently(),
    reloadFor,
  };
}
