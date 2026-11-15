// 컨트롤러 입력 배정(동작 → 입력) 표. 기본값과 사람이 바꾼 배정을 합쳐 모든 뷰어가 이 표로 판정한다.
// 사람 요청(2026-11-13): "조이스틱 버튼을 하나씩 지정할 수 있게 설정창" — 앱 2D 설정과 PC 설정 페이지 양쪽에서 바꾼다.
//
// 이 파일은 다른 모듈을 가져오지 않는 순수 데이터·함수다. PC 서버(scripts/quest_media_server.py)가 이 파일을
// 그대로 내보내 PC 브라우저 설정 페이지가 같은 목록·충돌 검사·설명 문구를 쓴다. three·DOM·이벤트 버스를 쓰지 말 것.
//
// 입력 값의 모양
//   button: { hand: 'left'|'right'|'either', button: 'trigger'|'grip'|'primary'|'secondary'|'stick', mode: 'press'|'hold' }
//           'either'는 두 손 중 아무 쪽. mode 'hold'는 HOLD_MS 이상 누르기.
//           같은 버튼에 'hold' 동작이 함께 있으면 'press' 동작은 "짧게 눌렀다 떼기"로 판정한다(B/Y 짧게=UI 켜기·끄기, 길게=옮기기).
//   axis:   { hand: 'left'|'right', axis: 'x'|'y' }   스틱 한 축(줌·되감기·높이 등)
//   stick:  { hand: 'left'|'right' }                   스틱 두 축 전체(화면 회전·이동)
//   null    = 지정 안 함(그 동작을 끈다)

export const STORAGE_KEY = "sharp.input.bindings.v1";
// 2(2026-11-13 사람 요청): A = 파일 선택 화면 열기, 다음 파일은 X 길게, 오른쪽 트리거 = 영상·사진 재생 컨트롤 표시·숨김,
//   재생·일시정지는 기본 버튼 없음(재생 컨트롤 UI로만). 1에서 바꾼 값은 그대로 두고 기본값만 바뀐다(migrateOverrides).
export const BINDINGS_VERSION = 2;

/** 손 이름 */
export const HANDS = /** @type {const} */ (["left", "right", "either"]);
/** 버튼 종류 */
export const BUTTONS = /** @type {const} */ (["trigger", "grip", "primary", "secondary", "stick"]);
export const MODES = /** @type {const} */ (["press", "hold"]);
export const AXES = /** @type {const} */ (["x", "y"]);

/** 범위: common은 모든 뷰어, media는 영상·사진, splat은 PLY. 범위가 겹치는 동작끼리만 충돌을 본다. */
export const SCOPES = {
  common: "모든 화면",
  media: "영상·사진",
  splat: "PLY",
};

/**
 * 바꿀 수 있는 동작 목록과 기본 배정. 순서는 설정창에 보이는 순서다.
 * required: 지정 안 함(null)으로 둘 수 없다. avoidButtons: 그 버튼에는 둘 수 없다.
 * @type {Array<{ id: string, scope: keyof typeof SCOPES, kind: 'button'|'axis'|'stick', label: string, default: any, note?: string, required?: boolean, avoidButtons?: string[] }>}
 */
export const ACTIONS = [
  // 이전·다음 파일은 X 한 버튼에: 짧게 = 이전, 길게 = 다음(A는 파일 선택 화면). 영상·사진은 오른쪽 스틱 좌우로도 넘긴다.
  { id: "common.prev", scope: "common", kind: "button", label: "이전 파일", default: { hand: "left", button: "primary", mode: "press" } },
  { id: "common.next", scope: "common", kind: "button", label: "다음 파일(끝에서는 처음으로)", default: { hand: "left", button: "primary", mode: "hold" } },
  { id: "common.openList", scope: "common", kind: "button", label: "파일 선택 화면 열기·닫기", default: { hand: "right", button: "primary", mode: "press" } },
  // UI 켜기·끄기는 메뉴로 돌아오는 길이라 비워 둘 수 없고(required), 트리거에는 둘 수 없다(패널 선택과 겹쳐 누를 때마다 UI가 꺼진다).
  { id: "common.uiToggle", scope: "common", kind: "button", label: "UI 켜기·끄기(위치는 그대로)", default: { hand: "either", button: "secondary", mode: "press" }, required: true, avoidButtons: ["trigger"] },
  { id: "common.uiMove", scope: "common", kind: "button", label: "UI를 지금 보는 곳으로 옮기기", default: { hand: "either", button: "secondary", mode: "hold" } },
  { id: "media.turn", scope: "media", kind: "stick", label: "화면 회전(민 쪽으로 장면이 움직임)", default: { hand: "left" } },
  { id: "media.zoom", scope: "media", kind: "axis", label: "줌(위·오른쪽으로 밀면 확대)", default: { hand: "right", axis: "y" } },
  { id: "media.scrub", scope: "media", kind: "axis", label: "영상 10초 되감기·빨리감기 / 사진 이전·다음(한 번 튕기기)", default: { hand: "right", axis: "x" } },
  { id: "media.recenter", scope: "media", kind: "button", label: "화면을 지금 보는 방향 앞으로 맞추기", default: { hand: "left", button: "stick", mode: "press" } },
  { id: "media.controls", scope: "media", kind: "button", label: "재생 컨트롤 표시·숨김", default: { hand: "right", button: "trigger", mode: "press" }, note: "트리거로 지정하면 레이가 패널을 가리킬 때는 패널 선택이 우선이다" },
  // 재생·일시정지는 기본 버튼 없이 재생 컨트롤 UI로만 한다(사람 요청). 원하면 설정창에서 따로 지정할 수 있다.
  { id: "media.playPause", scope: "media", kind: "button", label: "재생·일시정지(사진: 컨트롤 표시·숨김)", default: null, note: "기본은 지정 안 함: 재생 컨트롤의 ▶/❚❚ 버튼으로 한다" },
  { id: "splat.move", scope: "splat", kind: "stick", label: "이동(앞뒤·좌우)", default: { hand: "left" } },
  { id: "splat.turn", scope: "splat", kind: "axis", label: "30° 스냅 회전", default: { hand: "right", axis: "x" } },
  { id: "splat.height", scope: "splat", kind: "axis", label: "높이(민 쪽으로 장면이 움직임)", default: { hand: "right", axis: "y" } },
  { id: "splat.fit", scope: "splat", kind: "button", label: "크기·위치 맞춤(한 번 더: 1:1 몰입)", default: { hand: "right", button: "stick", mode: "press" } },
  { id: "splat.resetSize", scope: "splat", kind: "button", label: "크기만 맞춤 크기로 되돌리기", default: { hand: "left", button: "stick", mode: "press" } },
];

/**
 * 바꿀 수 없는(고정) 입력. 설정창에 안내로 보이고, splat.grab처럼 범위 안의 다른 동작과 겹치면 충돌로 본다.
 * reserves가 없으면 안내만 한다(트리거 선택은 레이가 패널을 가리킬 때만이라 다른 동작과 함께 쓸 수 있다).
 */
export const FIXED = [
  { id: "fixed.select", scope: "common", label: "선택(레이로 패널 버튼을 가리키고)", text: "트리거" },
  { id: "fixed.scroll", scope: "common", label: "목록 넘기기(패널이 열려 있을 때만, 뷰어 조작은 멈춤)", text: "두 스틱 위·아래" },
  { id: "splat.grab", scope: "splat", label: "장면 잡고 이동·돌리기 / 양손으로 확대·축소", text: "그립(양손)", reserves: [{ kind: "button", hand: "either", button: "grip", mode: "*" }] },
];

const ACTION_BY_ID = new Map(ACTIONS.map((a) => [a.id, a]));

export function actionById(id) {
  return ACTION_BY_ID.get(id) ?? null;
}

const clone = (value) => (value == null ? null : { ...value });

// ── 값 검사 ───────────────────────────────────────────────────────────────

/** 동작 종류에 맞는 입력 값인지. null(지정 안 함)도 맞는 값이다. 맞으면 정리한 값, 아니면 undefined. */
export function normalizeInput(kind, value) {
  if (value === null) return null;
  if (!value || typeof value !== "object") return undefined;
  if (kind === "button") {
    if (!HANDS.includes(value.hand) || !BUTTONS.includes(value.button)) return undefined;
    const mode = value.mode ?? "press";
    if (!MODES.includes(mode)) return undefined;
    return { hand: value.hand, button: value.button, mode };
  }
  if (kind === "axis") {
    if (value.hand !== "left" && value.hand !== "right") return undefined;
    if (!AXES.includes(value.axis)) return undefined;
    return { hand: value.hand, axis: value.axis };
  }
  if (kind === "stick") {
    if (value.hand !== "left" && value.hand !== "right") return undefined;
    return { hand: value.hand };
  }
  return undefined;
}

/** 이 동작에 이 입력(정리한 값)을 둘 수 있는가: 비워 둘 수 없는 동작·둘 수 없는 버튼을 거른다. */
export function allowedFor(action, value) {
  if (!action) return false;
  if (value === null) return !action.required;
  if (action.kind === "button" && action.avoidButtons?.includes(value?.button)) return false;
  return true;
}

/**
 * 예전 판(version)의 바꾼 값을 지금 판으로. 사람이 바꾼 값은 그대로 두고 기본값만 바뀐다.
 * 다만 기본값이 새로 생기거나 바뀐 동작이, 사람이 직접 고른 입력과 겹치면 그 동작은 '지정 안 함'으로 둔다
 * (예: 사람이 A에 위치 맞춤을 둬 썼다면 새 기본값 'A = 파일 선택'이 그것을 빼앗지 않는다).
 * @param {Record<string, any>} overrides cleanOverrides 결과
 * @param {number} fromVersion 저장된 판(없으면 1)
 */
export function migrateOverrides(overrides, fromVersion = 1) {
  const out = { ...overrides };
  if (fromVersion >= BINDINGS_VERSION || !Object.keys(out).length) return out;
  const changedDefaults = fromVersion < 2 ? ["common.openList", "common.next", "media.controls"] : [];
  const userIds = new Set(Object.keys(out));
  const merged = { ...defaultBindings(), ...out };
  for (const id of changedDefaults) {
    if (userIds.has(id)) continue;
    const clash = findConflicts(merged).some((c) => (c.a === id && userIds.has(c.b)) || (c.b === id && userIds.has(c.a)));
    if (clash) {
      out[id] = null;
      merged[id] = null;
    }
  }
  return out;
}

/** 기본 배정 { id: 입력 } */
export function defaultBindings() {
  return Object.fromEntries(ACTIONS.map((a) => [a.id, clone(a.default)]));
}

/** 사람이 바꾼 값(overrides)에서 알 수 없는 동작·잘못된 값을 버린다. */
export function cleanOverrides(overrides) {
  const out = {};
  if (!overrides || typeof overrides !== "object") return out;
  for (const [id, value] of Object.entries(overrides)) {
    const action = ACTION_BY_ID.get(id);
    if (!action) continue;
    const normalized = normalizeInput(action.kind, value);
    if (normalized === undefined || !allowedFor(action, normalized)) continue;
    if (sameInput(normalized, action.default)) continue; // 기본값과 같으면 바꾼 게 아니다
    out[id] = normalized;
  }
  return out;
}

/** 기본값 위에 사람이 바꾼 값을 덮는다. */
export function mergeBindings(overrides) {
  return { ...defaultBindings(), ...cleanOverrides(overrides) };
}

export function sameInput(a, b) {
  if (a == null || b == null) return a == null && b == null;
  return a.hand === b.hand && a.button === b.button && (a.mode ?? "press") === (b.mode ?? "press") && a.axis === b.axis;
}

// ── 충돌 검사 ─────────────────────────────────────────────────────────────

const scopesOverlap = (a, b) => a === "common" || b === "common" || a === b;
const handsOverlap = (a, b) => a === b || a === "either" || b === "either";

/** 입력 하나가 차지하는 물리 입력 조각들. 버튼은 (손, 버튼, 방식), 스틱은 (손, 축). */
function slots(kind, value) {
  if (value == null) return [];
  if (kind === "button") return [{ type: "button", hand: value.hand, button: value.button, mode: value.mode ?? "press" }];
  if (kind === "axis") return [{ type: "axis", hand: value.hand, axis: value.axis }];
  if (kind === "stick") return [{ type: "axis", hand: value.hand, axis: "x" }, { type: "axis", hand: value.hand, axis: "y" }];
  return [];
}

function slotsClash(a, b) {
  if (a.type !== b.type || !handsOverlap(a.hand, b.hand)) return false;
  if (a.type === "axis") return a.axis === b.axis;
  if (a.button !== b.button) return false;
  // 같은 버튼이라도 '짧게(press)'와 '길게(hold)'는 함께 쓸 수 있다. 고정 입력('*')은 어느 방식과도 겹친다.
  return a.mode === "*" || b.mode === "*" || a.mode === b.mode;
}

/**
 * 같은 입력에 두 동작이 걸린 곳들.
 * 단, 같은 스틱의 서로 다른 축(예: 줌=상하, 되감기=좌우)은 충돌이 아니다(대각선은 더 크게 민 축 하나만 쓴다).
 * @param {Record<string, any>} map mergeBindings 결과
 * @returns {Array<{ a: string, b: string, input: string }>}
 */
export function findConflicts(map) {
  const entries = ACTIONS.map((a) => ({ id: a.id, scope: a.scope, slots: slots(a.kind, map[a.id]), describe: () => describeInput(a.kind, map[a.id]) }));
  for (const f of FIXED) {
    if (f.reserves) entries.push({ id: f.id, scope: f.scope, slots: f.reserves.map((r) => ({ type: "button", ...r })), describe: () => f.text });
  }
  const out = [];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i];
      const b = entries[j];
      if (!scopesOverlap(a.scope, b.scope)) continue;
      if (a.slots.some((sa) => b.slots.some((sb) => slotsClash(sa, sb)))) out.push({ a: a.id, b: b.id, input: a.describe() });
    }
  }
  return out;
}

/** 같은 버튼(손이 겹침)에 'hold' 동작이 함께 있는가 — 있으면 'press'는 짧게 눌렀다 떼기로 판정한다. */
export function hasHoldSibling(map, id) {
  const action = ACTION_BY_ID.get(id);
  const value = map[id];
  if (!action || action.kind !== "button" || value == null || value.mode === "hold") return false;
  return ACTIONS.some((other) => {
    if (other.id === id || other.kind !== "button" || !scopesOverlap(other.scope, action.scope)) return false;
    const v = map[other.id];
    return v != null && v.mode === "hold" && v.button === value.button && handsOverlap(v.hand, value.hand);
  });
}

// ── 사람이 읽는 이름 ──────────────────────────────────────────────────────

const HAND_KO = { left: "왼쪽", right: "오른쪽", either: "양손" };
const FACE = { primary: { left: "X", right: "A", either: "X/A" }, secondary: { left: "Y", right: "B", either: "B/Y" } };

/** 입력 값을 사람이 읽는 말로. 예: "B/Y 길게", "왼쪽 스틱 누르기(L3)", "오른쪽 스틱 상하". */
export function describeInput(kind, value) {
  if (value == null) return "지정 안 함";
  if (kind === "stick") return `${HAND_KO[value.hand]} 스틱`;
  if (kind === "axis") return `${HAND_KO[value.hand]} 스틱 ${value.axis === "x" ? "좌우" : "상하"}`;
  let name;
  if (value.button === "primary" || value.button === "secondary") name = FACE[value.button][value.hand];
  else if (value.button === "stick") name = value.hand === "either" ? "스틱 누르기(L3/R3)" : `${HAND_KO[value.hand]} 스틱 누르기(${value.hand === "left" ? "L3" : "R3"})`;
  else name = `${HAND_KO[value.hand]} ${value.button === "trigger" ? "트리거" : "그립"}`;
  return value.mode === "hold" ? `${name} 길게` : name;
}

/** 동작 id의 지금 입력을 사람이 읽는 말로. */
export function describeAction(map, id) {
  const action = ACTION_BY_ID.get(id);
  return action ? describeInput(action.kind, map[id]) : "";
}

/**
 * 설정창 드롭다운 선택지: [{ value: JSON 문자열, label }]. 버튼은 손×버튼×방식, 축은 손×축, 스틱은 손. 맨 앞은 '지정 안 함'.
 * action을 주면 그 동작에 둘 수 없는 값(비워 둘 수 없는 동작의 '지정 안 함', 막힌 버튼)은 뺀다.
 */
export function inputChoices(kind, action = null) {
  const list = [null];
  if (kind === "button") {
    for (const hand of HANDS) for (const button of BUTTONS) for (const mode of MODES) list.push({ hand, button, mode });
  } else if (kind === "axis") {
    for (const hand of ["left", "right"]) for (const axis of AXES) list.push({ hand, axis });
  } else if (kind === "stick") {
    for (const hand of ["left", "right"]) list.push({ hand });
  }
  return list.filter((value) => !action || allowedFor(action, value)).map((value) => ({ value: JSON.stringify(value), label: describeInput(kind, value) }));
}

/** 범위별 조작 안내 줄: [[입력 설명, 동작 이름]]. VR 안내 카드·패널 안내문·설정창이 쓴다. */
export function guideLines(map, scope) {
  const lines = [];
  for (const a of ACTIONS) {
    if (a.scope !== scope) continue;
    const v = map[a.id];
    if (v == null) continue;
    lines.push([describeInput(a.kind, v), a.label]);
  }
  return lines;
}

// ── 저장소 ────────────────────────────────────────────────────────────────

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * 배정 저장소. 바꾼 값만 저장하고 읽을 때 기본값과 합친다. 저장이 막혀도 실행 중에는 값이 유지된다.
 * source: 'device'(이 기기에서 바꿈) | 'pc'(PC에서 받아 옴) | 'default'(바꾼 적 없음). updatedAt은 바꾼 시각(ms).
 * @param {{ storage?: () => Storage | null, now?: () => number }} [options]
 */
export function createBindingStore({ storage = defaultStorage, now = () => Date.now() } = {}) {
  let loaded = false;
  let overrides = {};
  let meta = { updatedAt: 0, source: "default" };
  let merged = null;
  const listeners = new Set();

  function load() {
    if (loaded) return;
    loaded = true;
    try {
      const raw = storage()?.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === "object") {
        overrides = migrateOverrides(cleanOverrides(parsed.bindings), Number(parsed.version) || 1);
        meta = { updatedAt: Number(parsed.updatedAt) || 0, source: parsed.source === "pc" ? "pc" : Object.keys(overrides).length ? "device" : "default" };
        // 예전 판이면 옮긴 값을 지금 판으로 저장해 둔다(바꾼 시각은 그대로: PC와의 "나중에 바꾼 쪽" 비교가 흔들리지 않게).
        if ((Number(parsed.version) || 1) < BINDINGS_VERSION) save();
      }
    } catch {
      overrides = {};
    }
  }

  function save() {
    try {
      storage()?.setItem(STORAGE_KEY, JSON.stringify({ version: BINDINGS_VERSION, updatedAt: meta.updatedAt, source: meta.source, bindings: overrides }));
    } catch {
      // 저장이 막혀도 이번 실행 동안은 유지된다.
    }
  }

  function changed() {
    merged = null;
    save();
    const snapshot = api.get();
    for (const fn of [...listeners]) {
      try {
        fn(snapshot, { ...meta });
      } catch {
        // 구독자 오류가 저장을 막지 않게 한다.
      }
    }
  }

  const api = {
    /** 기본값과 합친 지금 배정 { id: 입력|null }. 바뀌기 전까지 같은 객체를 돌려준다(매 프레임 불러도 된다). */
    get() {
      load();
      merged ??= Object.freeze({ ...defaultBindings(), ...overrides });
      return merged;
    },
    /** 기본값과 다른 것만 { id: 입력 } */
    overrides() {
      load();
      return { ...overrides };
    },
    meta() {
      load();
      return { ...meta };
    },
    /** 동작 하나를 바꾼다. value가 기본값과 같으면 바꾼 값에서 지운다. 잘못된 값이면 false. */
    set(id, value) {
      load();
      const action = ACTION_BY_ID.get(id);
      if (!action) return false;
      const normalized = normalizeInput(action.kind, value);
      if (normalized === undefined || !allowedFor(action, normalized)) return false;
      if (sameInput(normalized, action.default)) delete overrides[id];
      else overrides[id] = normalized;
      meta = { updatedAt: now(), source: "device" };
      changed();
      return true;
    },
    /** 하나(id) 또는 전부를 기본값으로 되돌린다. */
    reset(id) {
      load();
      if (id) delete overrides[id];
      else overrides = {};
      meta = { updatedAt: now(), source: Object.keys(overrides).length ? "device" : "default" };
      changed();
    },
    /** 통째로 바꾼다(PC에서 받아 올 때). updatedAt은 보낸 쪽 시각을 그대로 쓴다. */
    replace(nextOverrides, { source = "pc", updatedAt = now(), version = BINDINGS_VERSION } = {}) {
      load();
      overrides = migrateOverrides(cleanOverrides(nextOverrides), Number(version) || 1);
      meta = { updatedAt: Number(updatedAt) || now(), source };
      changed();
    },
    conflicts() {
      return findConflicts(api.get());
    },
    /** @param {(map: Record<string, any>, meta: { updatedAt: number, source: string }) => void} fn */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  return api;
}

/** 앱 전체가 같이 쓰는 하나의 배정 저장소(localStorage). */
export const bindings = createBindingStore();

/** VR 공용 패널 제목 아래 한 줄 안내(배정이 바뀌면 같이 바뀐다). */
export function panelHint(map) {
  const d = (id) => describeAction(map, id);
  const parts = ["스틱: 목록 넘기기"];
  const prev = map["common.prev"];
  const next = map["common.next"];
  if (prev || next) parts.push(`${prev ? d("common.prev") : "-"}/${next ? d("common.next") : "-"}: 이전·다음`);
  if (map["common.openList"]) parts.push(`${d("common.openList")}: 파일 선택`);
  if (map["common.uiToggle"]) parts.push(`${d("common.uiToggle")}: UI 끄기`);
  if (map["common.uiMove"]) parts.push(`${d("common.uiMove")}: 옮기기`);
  return parts.join(" · ");
}
