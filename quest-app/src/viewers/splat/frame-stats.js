// VR 프레임 시간 측정(순수 함수). "머리를 움직일 때 장면이 떨린다"가 카드가 아니라 장면의 프레임 시간 문제인지 가려내는 데 쓴다.
// Spark는 시점이 1mm·2.5° 이상 바뀌면 그 프레임에 splat 전체를 다시 계산하고(generate), 정렬(GPU 읽기+정렬)은 minSortIntervalMs 간격으로 돈다.
// 그래서 머리를 움직이는 동안만 프레임 시간이 늘면 장면 쪽 원인이다. 그래서 움직임 여부별로 나누어 잰다.

/** 머리가 "움직이는 중"으로 보는 기준: 이동 속도(m/s) 또는 회전 속도(rad/s). */
export const MOVING_SPEED = 0.05;
export const MOVING_TURN = 0.15;

export const isHeadMoving = (speed, turnSpeed) => speed > MOVING_SPEED || turnSpeed > MOVING_TURN;

function percentile(sorted, q) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

/**
 * 최근 maxFrames개 프레임 시간(ms)을 움직임 여부와 함께 모은다.
 * @param {number} [maxFrames]
 */
export function createFrameStats(maxFrames = 720) {
  /** @type {{ ms: number, moving: boolean }[]} */
  let frames = [];
  return {
    add(ms, moving) {
      if (!(ms > 0) || !Number.isFinite(ms)) return;
      frames.push({ ms, moving: !!moving });
      if (frames.length > maxFrames) frames.shift();
    },
    reset() {
      frames = [];
    },
    /**
     * @returns {{ frames: number, fps: number, avgMs: number, p95Ms: number, worstMs: number, dropRate: number,
     *   moving: { frames: number, p95Ms: number }, still: { frames: number, p95Ms: number } }}
     *   dropRate: 중앙값의 1.5배를 넘긴 프레임 비율(재투영·끊김으로 보이는 프레임)
     */
    summary() {
      const all = frames.map((f) => f.ms).sort((a, b) => a - b);
      const part = (moving) => {
        const list = frames.filter((f) => f.moving === moving).map((f) => f.ms).sort((a, b) => a - b);
        return { frames: list.length, p95Ms: percentile(list, 0.95) };
      };
      const total = all.reduce((sum, ms) => sum + ms, 0);
      const avgMs = all.length ? total / all.length : 0;
      const median = percentile(all, 0.5);
      return {
        frames: all.length,
        fps: avgMs ? 1000 / avgMs : 0,
        avgMs,
        p95Ms: percentile(all, 0.95),
        worstMs: all.length ? all[all.length - 1] : 0,
        dropRate: all.length ? all.filter((ms) => ms > median * 1.5).length / all.length : 0,
        moving: part(true),
        still: part(false),
      };
    },
  };
}

/**
 * 판정: 움직일 때와 가만히 있을 때의 p95를 비교한다. 표본이 모자라면 null.
 * - "motion": 움직일 때만 느려짐(장면 다시 계산·정렬 비용) → 정렬 갱신 늦춤·화질 낮춤이 효과
 * - "slow": 가만히 있어도 느림(기본 부하가 큼) → 화질·전체 보기를 낮춤
 * - "ok": 프레임이 고름 → 떨림은 프레임 시간이 아니라 카드 추종 등 다른 원인
 * @param {ReturnType<ReturnType<typeof createFrameStats>['summary']>} s
 * @param {number} [targetMs] 목표 프레임 시간(72Hz = 13.9ms)
 */
export function diagnoseFrames(s, targetMs = 1000 / 72) {
  if (s.moving.frames < 30 || s.still.frames < 30) return null;
  const limit = targetMs * 1.3;
  if (s.moving.p95Ms > limit && s.moving.p95Ms > s.still.p95Ms * 1.25) return "motion";
  if (s.still.p95Ms > limit) return "slow";
  return "ok";
}

const ms1 = (value) => value.toFixed(1);

/** 패널 한 줄 표시: "72fps · 움직일 때 p95 12.1ms · 가만히 11.9ms". 표본이 없으면 안내. */
export function formatFrameStats(s) {
  if (!s.frames) return "측정 중…";
  const parts = [`${Math.round(s.fps)}fps`];
  if (s.moving.frames >= 30) parts.push(`움직일 때 ${ms1(s.moving.p95Ms)}ms`);
  if (s.still.frames >= 30) parts.push(`가만히 ${ms1(s.still.p95Ms)}ms`);
  if (parts.length === 1) parts.push(`p95 ${ms1(s.p95Ms)}ms`);
  return parts.join(" · ");
}
