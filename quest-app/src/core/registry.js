// 소스·뷰어 등록부. 각 모듈은 팩토리를 내보내고 main.js가 여기에 등록한다.
// (media-dev: viewers/media/media-viewer.js → createMediaViewer(),
//  sync-dev: sources/pc-source.js → createPcSource(), sources/gdrive-source.js → createGdriveSource())

/** @typedef {import('./types.js').Source} Source */
/** @typedef {import('./types.js').Viewer} Viewer */
/** @typedef {import('./types.js').ItemKind} ItemKind */

/** @type {Map<string, Source>} */
const sources = new Map();
/** @type {Viewer[]} */
const viewers = [];

/** @param {Source} source */
export function registerSource(source) {
  sources.set(source.id, source);
}

/** @param {string} id */
export function getSource(id) {
  return sources.get(id);
}

export function listSources() {
  return [...sources.values()];
}

/** @param {Viewer} viewer */
export function registerViewer(viewer) {
  viewers.push(viewer);
}

/** @param {ItemKind} kind */
export function viewerFor(kind) {
  return viewers.find((viewer) => viewer.kinds.includes(kind));
}

export function listViewers() {
  return [...viewers];
}

/** 테스트용: 등록된 뷰어를 모두 지운다. */
export function clearViewers() {
  viewers.length = 0;
}

/** 종류별 "다음 파일 미리 받기" 크기 한도(바이트). 0·없음이면 그 종류는 미리 받지 않는다. 메모리 보호용이다(core/prefetch.js). */
/** @type {Map<string, number>} */
const prefetchLimits = new Map();

/**
 * @param {ItemKind} kind
 * @param {number} maxBytes 이 크기를 넘는 파일은 미리 받지 않는다. 0이면 끈다.
 */
export function setPrefetchLimit(kind, maxBytes) {
  prefetchLimits.set(kind, maxBytes);
}

/** @param {string} kind */
export function prefetchLimitFor(kind) {
  return prefetchLimits.get(kind) ?? 0;
}
