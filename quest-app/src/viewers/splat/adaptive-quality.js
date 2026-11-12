// VR 프레임 시간이 예산을 넘으면 화질 손실이 작은 순서로 한 단계씩 낮추는 판단(순수 함수).
// 프레임이 모자라면 컴포지터가 재투영·프레임 보간으로 채워서 장면 전체가 흔들려 보인다. 그래서 72Hz를 못 지키는 세션에서만 개입한다.
// 순서: 정렬 갱신을 늦춘다(화질 손실 거의 없음) → 그래도 모자라면 화질 단계를 한 칸씩 낮춘다(안전 프리셋일 때만, 바닥 있음).
// 올리는 방향은 자동으로 하지 않는다(진동 방지). VR 세션이 새로 시작되면 처음 값으로 돌아간다.

export const ADAPT = {
  /** 이만큼 프레임이 모이기 전에는 판단하지 않는다(72Hz에서 약 2.5초). */
  minFrames: 180,
  /** 한 번 조정한 뒤 다음 조정까지 최소 간격(ms). */
  cooldownMs: 6000,
  /** 평균 프레임 시간이 예산의 이 배수를 넘으면 모자란 것으로 본다. */
  avgOver: 1.15,
  /** 머리를 움직일 때 p95가 예산의 이 배수를 넘으면 모자란 것으로 본다(움직일 때만 느려지는 경우). */
  movingP95Over: 1.6,
  movingMinFrames: 90,
  /** 정렬 갱신 단계(ms). 현재 값보다 큰 다음 값으로 올린다. */
  sortSteps: [50, 120],
  /** 화질 단계 바닥(safe 1~10). 이 아래로는 자동으로 내리지 않는다. */
  floorLevel: 3,
};

/** 세션 프레임 속도(Hz)에서 프레임 예산(ms). 모르면 72Hz. */
export function frameBudgetMs(frameRate) {
  return 1000 / (Number.isFinite(frameRate) && frameRate >= 30 ? frameRate : 72);
}

/** 프레임이 예산을 못 지키는지. */
export function isOverBudget(summary, budgetMs, cfg = ADAPT) {
  if (summary.frames < cfg.minFrames) return false;
  if (summary.avgMs > budgetMs * cfg.avgOver) return true;
  return summary.moving.frames >= cfg.movingMinFrames && summary.moving.p95Ms > budgetMs * cfg.movingP95Over;
}

/**
 * 다음에 할 조정. 없으면 null.
 * @param {ReturnType<ReturnType<typeof import('./frame-stats.js').createFrameStats>['summary']>} summary 마지막 조정 이후 모은 프레임
 * @param {{ budgetMs: number, sortMs: number, level: number | null, sinceChangeMs: number }} state
 *   sortMs: 지금 적용 중인 정렬 갱신(ms), level: 지금 화질 단계(안전 프리셋이 아니면 null)
 * @returns {{ sortMs: number } | { level: number } | null}
 */
export function nextAdaptation(summary, { budgetMs, sortMs, level, sinceChangeMs }, cfg = ADAPT) {
  if (sinceChangeMs < cfg.cooldownMs) return null;
  if (!isOverBudget(summary, budgetMs, cfg)) return null;
  const nextSort = cfg.sortSteps.find((ms) => ms > sortMs);
  if (nextSort !== undefined) return { sortMs: nextSort };
  if (level !== null && level > cfg.floorLevel) return { level: level - 1 };
  return null;
}
