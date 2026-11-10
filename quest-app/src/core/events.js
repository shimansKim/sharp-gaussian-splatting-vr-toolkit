// 작은 이벤트 버스. 모듈 사이 느슨한 연결에 쓴다.
// 이벤트 이름 규칙: "<영역>:<동작>" (예: "library:changed", "item:opened", "xr:sessionstart").

/** @type {Map<string, Set<(detail: any) => void>>} */
const handlers = new Map();

/**
 * @param {string} name
 * @param {(detail: any) => void} fn
 * @returns {() => void} 해제 함수
 */
export function on(name, fn) {
  let set = handlers.get(name);
  if (!set) {
    set = new Set();
    handlers.set(name, set);
  }
  set.add(fn);
  return () => set.delete(fn);
}

/**
 * @param {string} name
 * @param {any} [detail]
 */
export function emit(name, detail) {
  const set = handlers.get(name);
  if (!set) return;
  for (const fn of [...set]) {
    try {
      fn(detail);
    } catch (error) {
      console.error(`[events] ${name} handler failed`, error);
    }
  }
}
