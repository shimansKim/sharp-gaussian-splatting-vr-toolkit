// 목록 보기 규칙: 종류 필터, 정렬, 폴더 경로 계산. DOM·네트워크를 쓰지 않는 순수 함수라 테스트하기 쉽다.
// 소유: app-dev. library(상태)와 2D 목록·VR 패널(표시)이 같이 쓴다.

import { extensionOf } from "./kinds.js";

/** @typedef {import('./types.js').LibraryItem} LibraryItem */

export const KIND_FILTERS = [
  { value: "all", label: "전체" },
  { value: "splat", label: "PLY" },
  { value: "video", label: "영상" },
  { value: "image", label: "사진" },
];

export const SORTS = [
  { value: "recent", label: "최신순" },
  { value: "name", label: "이름순" },
  { value: "size", label: "크기순" },
  { value: "ext", label: "확장자순" },
];

/** 2D 목록이 한 번에 그리는 행 수(나머지는 [더 보기]). 목록이 2만 개여도 DOM에는 수백 개만 둔다. */
export const PAGE_SIZE = 200;
/** VR 패널의 쪽 단위 점프 줄 수 */
export const JUMP_ROWS = 100;

export const DEFAULT_VIEW = Object.freeze({ kind: "all", sort: "recent" });
const STORAGE_KEY = "sharp.listView";

const collator = new Intl.Collator("ko", { numeric: true, sensitivity: "base" });
const byName = (a, b) => collator.compare(a.name, b.name);

/** 알 수 없는 값은 기본값으로 되돌린다. */
export function normalizeView(view) {
  const kind = KIND_FILTERS.some((f) => f.value === view?.kind) ? view.kind : DEFAULT_VIEW.kind;
  const sort = SORTS.some((s) => s.value === view?.sort) ? view.sort : DEFAULT_VIEW.sort;
  return { kind, sort };
}

/**
 * 종류로 거르고 정렬한 새 배열. 원본은 바꾸지 않는다.
 * 같은 값끼리는 이름순으로 정해 두어 순서가 흔들리지 않는다.
 * @param {LibraryItem[]} items
 * @param {{ kind?: string, sort?: string }} view
 */
export function applyView(items, view) {
  const { kind, sort } = normalizeView(view);
  const picked = kind === "all" ? items.slice() : items.filter((item) => item.kind === kind);
  const compare = {
    recent: (a, b) => (b.mtime ?? 0) - (a.mtime ?? 0) || byName(a, b),
    name: byName,
    size: (a, b) => (b.size ?? 0) - (a.size ?? 0) || byName(a, b),
    ext: (a, b) => collator.compare(extensionOf(a.name), extensionOf(b.name)) || byName(a, b),
  }[sort];
  return picked.sort(compare);
}

/**
 * 2D 목록이 그릴 행 범위 [start, end)를 정한다. 항상 PAGE_SIZE개 안팎이고, 열려 있는 항목(mustShowIndex)이
 * 범위 밖이면 그 항목 주변으로 옮긴다. 6000번째 항목이 열려도 6000행이 아니라 200행만 그린다.
 * @param {{ start: number, end: number }} win 지금 범위
 * @param {number} total 전체 행 수
 * @param {number} [mustShowIndex] 반드시 보여야 하는 행 번호(없으면 -1)
 */
export function pageWindow(win, total, mustShowIndex = -1) {
  let start = Math.max(0, Math.min(win.start, Math.max(0, total - 1)));
  let end = Math.min(total, Math.max(win.end, start + PAGE_SIZE));
  if (mustShowIndex >= 0 && (mustShowIndex < start || mustShowIndex >= end)) {
    start = Math.max(0, Math.min(mustShowIndex - PAGE_SIZE / 2, total - PAGE_SIZE));
    end = Math.min(total, start + PAGE_SIZE);
  }
  return { start, end };
}

/** 다음 값(필터·정렬 버튼을 누를 때마다 돌아가며 바뀐다). */
export function nextValue(choices, value) {
  const index = choices.findIndex((choice) => choice.value === value);
  return choices[(index + 1) % choices.length].value;
}

export const labelOf = (choices, value) => choices.find((choice) => choice.value === value)?.label ?? "";

/** 서버가 준 폴더 경로 목록 → 표시용 항목. 이름순. */
export function folderEntries(dirs = []) {
  return dirs
    .map((path) => ({ path, name: path.split("/").filter(Boolean).pop() ?? path }))
    .sort(byName);
}

/** "outputs/VR/clip" → "outputs/VR", "outputs" → "" (최상위). */
export function parentPath(path) {
  return String(path ?? "").split("/").filter(Boolean).slice(0, -1).join("/");
}

/** 경로 표시용 조각. 최상위는 빈 배열. */
export function pathSegments(path) {
  const parts = String(path ?? "").split("/").filter(Boolean);
  return parts.map((name, i) => ({ name, path: parts.slice(0, i + 1).join("/") }));
}

/** 사람이 읽는 경로. 최상위는 "최근 파일". */
export function describeFolder(path) {
  const parts = pathSegments(path);
  return parts.length ? parts.map((p) => p.name).join(" / ") : "최근 파일";
}

export function loadView(storage = globalThis.localStorage) {
  try {
    return normalizeView(JSON.parse(storage.getItem(STORAGE_KEY) ?? "null"));
  } catch {
    return { ...DEFAULT_VIEW };
  }
}

export function saveView(view, storage = globalThis.localStorage) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(normalizeView(view)));
  } catch {
    /* 저장이 막힌 환경이면 이번 실행에만 적용 */
  }
}

/** 파일 날짜 표시(없으면 빈 문자열). */
export function formatDate(mtime) {
  if (!Number.isFinite(mtime)) return "";
  const d = new Date(mtime);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
