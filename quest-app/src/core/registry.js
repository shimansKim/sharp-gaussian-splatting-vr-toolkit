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
