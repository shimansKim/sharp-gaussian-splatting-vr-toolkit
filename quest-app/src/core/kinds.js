// 파일 종류 판별. 확장자·MIME 기준이며 소스 모듈들이 같이 쓴다.

/** @typedef {import('./types.js').ItemKind} ItemKind */

const SPLAT_EXT = new Set(["ply", "splat", "spz", "ksplat"]);
const VIDEO_EXT = new Set(["mp4", "m4v", "webm", "mov", "mkv", "ogv"]);
const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "webp", "avif", "bmp", "gif"]);

/** @param {string} name */
export function extensionOf(name) {
  const match = /\.([^.\/]+)$/.exec(name);
  return match ? match[1].toLowerCase() : "";
}

/**
 * @param {string} name
 * @param {string} [mime]
 * @returns {ItemKind | null}
 */
export function classifyFile(name, mime = "") {
  const ext = extensionOf(name);
  if (SPLAT_EXT.has(ext)) return "splat";
  if (mime.startsWith("video/") || VIDEO_EXT.has(ext)) return "video";
  if (mime.startsWith("image/") || IMAGE_EXT.has(ext)) return "image";
  return null;
}

/** Spark `SplatFileType` 문자열("ply" 등). 모르면 undefined. */
export function splatFileType(name) {
  const ext = extensionOf(name);
  return SPLAT_EXT.has(ext) ? ext : undefined;
}

/** @param {number} bytes */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}
