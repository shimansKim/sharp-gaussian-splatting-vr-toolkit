// 슬라이드쇼: 간격을 정해 두면 현재 항목을 다 연 뒤 그 시간이 지나 다음 파일로 넘어간다. 영상은 간격이 아니라 "끝나면" 넘어간다.
// 사진·PLY: item:opened부터 interval초 뒤에 library.next(). 직접 이전/다음을 눌러도 타이머는 새 항목 기준으로 다시 시작한다.
// 열기에 실패(item:error)하거나 항목을 닫으면(item:closed) 멈춘다. 이동할 다른 파일이 없어도 멈춘다.
// 목록 끝에서는 library.next()가 처음으로 돌아가므로 쇼는 계속 돈다.
//
// 이벤트: "slideshow:changed" { running, interval }

import { emit, on } from "./events.js";

export const INTERVALS = [3, 5, 10, 30];
export const DEFAULT_INTERVAL = 5;
const STORAGE_KEY = "sharp-quest.slideshow-interval";

function loadInterval(storage) {
  try {
    const value = Number(storage?.getItem(STORAGE_KEY));
    return INTERVALS.includes(value) ? value : DEFAULT_INTERVAL;
  } catch {
    return DEFAULT_INTERVAL;
  }
}

/**
 * 영상이 끝났는지 매 프레임 본다. 끝난 순간(ended=true)에 한 번만 알리고, ended가 다시 false가 되면(되감아 재생·탐색) 다시 알릴 수 있게 한다.
 * 쇼가 꺼져 있는 동안 끝난 영상은 알리지 않고 기다리므로, 끝에 멈춘 채로 쇼를 켜면 바로 다음으로 넘어간다.
 * @param {{ isRunning: () => boolean, notify: (itemId: string) => void }} options
 * @returns {(item: { id: string, kind: string } | null, ended: boolean) => void}
 */
export function createEndWatch({ isRunning, notify }) {
  let reported = "";
  return (item, ended) => {
    if (!item || item.kind !== "video") {
      reported = "";
      return;
    }
    if (!ended) {
      reported = "";
      return;
    }
    if (reported === item.id || !isRunning()) return;
    reported = item.id;
    notify(item.id);
  };
}

/**
 * @param {{
 *   library: ReturnType<typeof import('./library.js').createLibrary>,
 *   storage?: Pick<Storage, 'getItem' | 'setItem'>,
 *   timers?: { set: typeof setTimeout, clear: typeof clearTimeout },
 *   subscribe?: typeof on,
 * }} options
 */
export function createSlideshow({
  library,
  storage = globalThis.localStorage,
  timers = { set: (...args) => setTimeout(...args), clear: (id) => clearTimeout(id) },
  subscribe = on,
}) {
  let running = false;
  let interval = loadInterval(storage);
  let timer = 0;
  const changed = () => emit("slideshow:changed", { running, interval });

  function clear() {
    timers.clear(timer);
    timer = 0;
  }

  /** 현재 항목 기준으로 다음 넘김을 예약한다(영상은 끝 알림을 기다리므로 예약하지 않는다). */
  function arm() {
    clear();
    const current = library.current;
    if (!running || !current || library.loading) return;
    if (current.kind === "video") return;
    timer = timers.set(advance, interval * 1000);
  }

  function advance() {
    timer = 0;
    if (!running) return;
    if (!library.canStep) {
      stop();
      return;
    }
    library.next();
  }

  function start() {
    if (running) return;
    running = true;
    changed();
    if (library.current) arm();
    else {
      const first = library.items.find((item) => library.canOpen(item));
      if (first) library.open(first, { playlist: library.items });
      else stop();
    }
  }

  function stop() {
    clear();
    if (!running) return;
    running = false;
    changed();
  }

  subscribe("item:opened", () => arm());
  subscribe("item:loading", clear);
  subscribe("item:error", () => stop());
  subscribe("item:closed", () => stop());

  function setIntervalSeconds(seconds) {
    if (!INTERVALS.includes(seconds)) return;
    interval = seconds;
    try {
      storage?.setItem(STORAGE_KEY, String(seconds));
    } catch {
      /* 저장이 막혀도 이번 실행에는 적용 */
    }
    changed();
    arm();
  }

  return {
    start,
    stop,
    toggle: () => (running ? stop() : start()),

    /** 간격을 다음 값으로 돌린다(3→5→10→30→3초). 쇼가 돌고 있으면 새 간격으로 다시 센다. */
    cycleInterval: () => setIntervalSeconds(INTERVALS[(INTERVALS.indexOf(interval) + 1) % INTERVALS.length]),
    setInterval: setIntervalSeconds,

    /** 영상이 끝났을 때 main.js가 알린다. 쇼가 돌고 있고 지금 그 영상이면 다음으로 넘긴다. */
    notifyEnded(itemId) {
      // 같은 영상의 중복 알림은 createEndWatch가 막는다.
      if (!running || library.current?.id !== itemId) return;
      advance();
    },

    get running() {
      return running;
    },
    get interval() {
      return interval;
    },
  };
}
