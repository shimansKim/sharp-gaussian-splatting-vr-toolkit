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

/** 한 번 튀는 큰 끊김(파일 로딩, 헤드셋을 벗었다 씀 등)으로 화질이 내려가지 않게 자동 조절 표본에서 빼는 기준: 예산의 이 배수. */
export const SPIKE_FACTOR = 4;
/** 앱의 프레임 시간(dt)은 50ms에서 잘린다(core/xr-stage.js). 그보다 긴 끊김은 이 값으로 보이므로 49ms 넘는 프레임도 끊김으로 본다. */
export const DT_CAP_MS = 49;

/** 이보다 긴 프레임은 한도 초과 프레임이다(고립되면 큰 끊김, 연달아 나오면 지속적인 느림). */
export const spikeLimitMs = (budgetMs) => Math.min(budgetMs * SPIKE_FACTOR, DT_CAP_MS);
export const isSpike = (ms, budgetMs) => ms > spikeLimitMs(budgetMs);

/** 최근 이 프레임 수 중 한도 초과가 절반 이상이면 지속적인 느림으로 본다(최소 SUSTAINED_MIN_FRAMES개가 모였을 때). */
export const SPIKE_WINDOW = 30;
export const SUSTAINED_FRACTION = 0.5;
export const SUSTAINED_MIN_FRAMES = 8;

/**
 * 자동 조절 표본에서 고립된 큰 끊김만 거르는 필터. 한도 초과 프레임이
 *  - 앞뒤가 정상이고 혼자면 → 뺀다(파일 로딩, 헤드셋을 벗었다 씀 등).
 *  - 연달아 나오면(2프레임 이상) → 지속적인 느림이라 넣는다. 앱 dt가 50ms에서 잘리므로 20fps 이하 세션은 모든 프레임이 한도를 넘는다.
 *  - 최근 윈도우에서 절반 이상이면 → 지속적인 느림이라 넣는다(느렸다 괜찮았다 하는 경우).
 * 고립 여부는 다음 프레임을 봐야 알 수 있어, 첫 한도 초과 프레임은 한 프레임 보류했다가 결정한다.
 */
export function createSpikeFilter({ window = SPIKE_WINDOW, fraction = SUSTAINED_FRACTION, minFrames = SUSTAINED_MIN_FRAMES } = {}) {
  /** @type {boolean[]} */
  let recent = [];
  let prevOver = false;
  /** @type {{ ms: number, moving: boolean } | null} */
  let pending = null;
  return {
    /**
     * @param {number} ms 이번 프레임 시간
     * @param {boolean} moving 머리 움직임 여부
     * @param {number} budgetMs 프레임 예산
     * @returns {{ ms: number, moving: boolean }[]} 이번에 표본에 넣을 프레임들(보류했던 프레임 포함, 비어 있을 수 있음)
     */
    push(ms, moving, budgetMs) {
      const over = isSpike(ms, budgetMs);
      recent.push(over);
      if (recent.length > window) recent.shift();
      const frame = { ms, moving };
      if (!over) {
        pending = null; // 앞뒤가 정상인 고립된 끊김 → 버린다
        prevOver = false;
        return [frame];
      }
      const sustained = recent.length >= minFrames && recent.filter(Boolean).length / recent.length >= fraction;
      const out = [];
      if (pending) out.push(pending); // 연달아 나옴 → 보류했던 프레임도 포함
      pending = null;
      if (prevOver || sustained) out.push(frame);
      else pending = frame; // 아직 고립인지 모른다: 다음 프레임을 본다
      prevOver = true;
      return out;
    },
    reset() {
      recent = [];
      prevOver = false;
      pending = null;
    },
  };
}

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
