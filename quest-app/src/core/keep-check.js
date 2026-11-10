// 보관(앱 저장소로 통째 복사) 전에 공간을 확인한다.
// PC·드라이브의 영상·사진은 보관하지 않아도 스트리밍으로 바로 열린다. 보관은 오프라인용 복사본이다.

import { formatBytes } from "./kinds.js";

const MARGIN = 0.9; // 남은 공간의 90%까지만 쓴다(다른 앱 데이터·메타데이터 여유)

/**
 * 보관할 수 없는 이유를 한국어로 돌려준다. 가능하면 null.
 * @param {{ size?: number, kind?: string, sourceId?: string }} item
 * @param {{ usage: number, quota: number } | null} estimate
 * @returns {string | null}
 */
export function keepBlocker(item, estimate) {
  const size = item.size;
  if (!estimate || !Number.isFinite(size) || !size || !(estimate.quota > 0)) return null;
  const free = Math.max(0, estimate.quota - estimate.usage);
  if (size <= free * MARGIN) return null;
  const need = `보관하려면 ${formatBytes(size)}가 필요한데 앱 저장 공간은 ${formatBytes(free)}만 남았습니다.`;
  const streams = item.kind !== "splat" && item.sourceId !== "session";
  return streams ? `${need} 영상·사진은 보관하지 않아도 목록에서 눌러 바로 재생(스트리밍)할 수 있습니다.` : `${need} 보관함에서 다른 파일을 지운 뒤 다시 시도하세요.`;
}
