// PLY(Gaussian splat) 뷰어.
// VR 조작(Quest 표준):
//   그립(옆 버튼)        장면을 잡고 끌어 이동, 손을 좌우로 돌리면 같이 회전
//   양손 그립            두 손을 벌리면 확대, 모으면 축소(두 손 사이 가운데 기준), 두 손을 잇는 선을 돌리면 회전
//   왼쪽 스틱            부드러운 이동(보는 방향 기준)
//   오른쪽 스틱          좌우 = 30° 스냅 회전(머리 위치 기준), 위아래 = 높이. 방향은 장면을 미는 쪽(splat-math의 STICK_INVERT)
//   오른쪽 스틱 누르기   크기·위치 맞춤(장면을 눈앞 적정 크기로). 맞춘 상태에서 한 번 더 = 1:1 몰입(원본 카메라 자리)
//   왼쪽 스틱 누르기     크기만 맞춤(위치·방향 유지)
//   X/A 이전·다음, B/Y 목록 패널(공통). 화질·전체 보기·점 크기·자세 유지·미리 받기는 패널 [PLY 옵션]
// 장면은 anchor 그룹 하나(위치·Y회전·균일 크기)로만 움직인다. VR에 들어가거나 PLY를 열면 자동으로 눈앞에 맞춘다.

import * as THREE from "three";
import { bindings } from "../../core/bindings.js";
import { emit } from "../../core/events.js";
import { axisRaw, createActionTracker, sameStick, stickRaw } from "../../core/input-map.js";
import { formatBytes, splatFileType } from "../../core/kinds.js";
import { angularHalf, yawOfDirection } from "../../core/panel-layout.js";
import { createSpikeFilter, frameBudgetMs, nextAdaptation } from "./adaptive-quality.js";
import { createFrameStats, diagnoseFrames, formatFrameStats, isHeadMoving } from "./frame-stats.js";
import { createSplatHud } from "./splat-hud.js";
import { createMotion, headingAxes } from "./splat-motion.js";
import {
  POINT_SIZES,
  QUALITY_LEVELS,
  SORT_CHOICES,
  VR_SORT_MS,
  cycle,
  formatPointSize,
  formatQualitySide,
  formatSortInterval,
  loadOptions,
  saveOptions,
  sparkForLevel,
  sparkSettings,
} from "./splat-options.js";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  STICK_INVERT,
  createGripState,
  createSnapTurn,
  fitScaleOf,
  fitTransform,
  headingOf,
  oneHandGrab,
  robustBounds,
  turnAbout,
  twoHandGrab,
  worldCenter,
} from "./splat-math.js";

/** @typedef {import('../../core/types.js').Viewer} Viewer */

const MOVE_SPEED = 0.75;
const VERTICAL_SPEED = 0.6;
/** 이동 속도에 곱하는 장면 크기 배율의 범위(작게 맞춘 장면에서는 천천히, 크게 키우면 빠르게). */
const SPEED_SCALE_RANGE = [0.3, 2];
/** VR 진입·새 PLY 직후, 카메라 자세가 장면에 반영될 때까지 기다리는 프레임 수. */
const SETTLE_FRAMES = 3;
const BOUNDS_SAMPLES = 150000;
/** VR 프레임 시간 측정 결과를 콘솔에 남기는 간격(ms). 원격 디버깅·logcat으로 실기기 값을 읽을 때 쓴다. */
const FRAME_LOG_MS = 10000;
/** 프레임 부족 자동 조절을 판단하는 간격(ms). */
const ADAPT_CHECK_MS = 1000;
const UP = new THREE.Vector3(0, 1, 0);
/** 다음 PLY 미리 받기는 이 크기까지만(메모리·GPU 한도: 미리 받은 한 장만 들고 있는다). */
export const PREFETCH_MAX_BYTES = 120 * 1024 * 1024;
const RENDER_KEYS = ["maxStdDev", "minPixelRadius", "maxPixelRadius", "minAlpha", "clipXY", "focalAdjustment", "minSortIntervalMs", "coneFoveate", "behindFoveate"];

/** PLY는 전체를 받아야 보이므로, 받는 동안 진행 상황을 상태 표시줄에 알린다. */
function withProgress(stream, size, name) {
  let received = 0;
  let lastShown = 0;
  return stream.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        received += chunk.byteLength;
        const now = performance.now();
        if (now - lastShown > 250) {
          lastShown = now;
          const total = size ? ` / ${formatBytes(size)}` : "";
          emit("app:status", { text: `PLY 받는 중… ${name} (${formatBytes(received)}${total})`, kind: "" });
        }
        controller.enqueue(chunk);
      },
    }),
  );
}

/**
 * @param {{
 *   preset: ReturnType<typeof import('./quest-presets.js').getSplatPreset>,
 *   savePreset?: (value: string) => void,  VR 패널에서 화질을 바꿀 때 저장("safe:5" 형식)
 * }} options
 * @returns {Viewer & { info(): { numSplats: number } | null }}
 */
export function createSplatViewer({ preset, savePreset = () => {} }) {
  /** @type {import('../../core/types.js').XrStage | null} */
  let stage = null;
  let spark = null;
  let sparkModule = null;
  let splat = null;
  let loadToken = 0;
  let numSplats = 0;

  // anchor: 장면 전체를 움직이는 그룹. mesh는 상하 뒤집힘 보정(SHARP 출력)만 가진다.
  const anchor = new THREE.Group();
  const grid = new THREE.GridHelper(4, 16, 0x42606a, 0x26343a);
  grid.visible = false;

  // 옵션(VR 패널 [PLY 옵션]). 화질 단계는 safe 1~10, 처음엔 시작 프리셋을 따른다.
  let options = loadOptions();
  let baseSpark = preset.spark;
  let qualityLabel = preset.label;
  let qualityLevel = preset.mode === "safe" ? preset.level : null;
  /** VR에서 프레임이 모자라 자동으로 바꾼 값(없으면 null). VR 세션이 새로 시작·종료되면 지운다. */
  const adapt = { sortMs: /** @type {number | null} */ (null), level: /** @type {number | null} */ (null), at: 0, checkedAt: 0 };
  /** 미리 받아 둔 다음 PLY: { itemId, mesh }. 한 장만. */
  let prefetched = null;
  /** 지금 VR/2D 상태에서 이미 맞춘 자세가 있는지(PLY 전환 시 자세 유지에 쓴다). */
  let poseValid = false;

  /** anchor 좌표 기준 맞춤 범위(중심·반지름). 아직 모르면 null. */
  let bounds = null;
  /** 맞춤 크기(확대·축소 한계와 크기 초기화 기준). */
  let baseScale = 1;
  /** 마지막 맞춤 방식과, 그 뒤 사용자가 장면·시점을 움직였는지. */
  let lastMode = "fit";
  let movedSinceFit = true;
  /** @type {{ mode: 'fit' | 'immersive', frames: number, intro: boolean } | null} */
  let pendingFit = null;
  let wasPresenting = false;
  let introPending = false;

  const frameStats = createFrameStats();
  /** 자동 조절 판단용 표본: 큰 끊김(예산의 4배 초과)은 뺀다. 패널의 '프레임 측정'은 끊김도 포함한 frameStats를 그대로 보여 준다. */
  const adaptStats = createFrameStats();
  const spikeFilter = createSpikeFilter();
  const lastHead = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), valid: false };
  let frameLogAt = 0;

  function resetAdapt() {
    adapt.sortMs = null;
    adapt.level = null;
    adapt.at = performance.now();
    adapt.checkedAt = adapt.at;
  }

  /** 프레임이 예산을 못 지키면 정렬 갱신을 늦추고, 그래도 모자라면 화질을 한 칸 낮춘다("자동"일 때만). */
  function adaptQuality(summary, now) {
    if (options.sortMs !== "auto") return;
    const session = stage.renderer.xr.getSession?.();
    const step = nextAdaptation(summary, {
      budgetMs: frameBudgetMs(session?.frameRate),
      sortMs: adapt.sortMs ?? VR_SORT_MS,
      level: adapt.level ?? qualityLevel,
      sinceChangeMs: now - adapt.at,
    });
    if (!step) return;
    if (step.sortMs !== undefined) adapt.sortMs = step.sortMs;
    if (step.level !== undefined) adapt.level = step.level;
    adapt.at = now;
    adaptStats.reset(); // 바뀐 뒤 프레임으로 다시 판단한다
    spikeFilter.reset();
    applyRenderOptions();
    console.info(`[splat] 프레임 부족 → 자동 조절: ${step.sortMs !== undefined ? `정렬 갱신 ${step.sortMs}ms` : `화질 ${step.level}/10`}`);
  }

  /** VR에서 장면을 보는 동안의 프레임 시간을 머리 움직임 여부와 함께 잰다(떨림 원인이 장면 쪽인지 가리는 용도). */
  function sampleFrame(dt) {
    stage.camera.getWorldPosition(tmpHead);
    stage.camera.getWorldQuaternion(tmpQuat);
    if (lastHead.valid && dt > 0) {
      const moving = isHeadMoving(tmpHead.distanceTo(lastHead.position) / dt, tmpQuat.angleTo(lastHead.quaternion) / dt);
      frameStats.add(dt * 1000, moving);
      // 고립된 큰 끊김만 거르고, 연달아 나오거나 절반 이상이면(계속 느린 세션) 표본에 넣는다.
      for (const sample of spikeFilter.push(dt * 1000, moving, frameBudgetMs(stage.renderer.xr.getSession?.()?.frameRate))) adaptStats.add(sample.ms, sample.moving);
    }
    lastHead.position.copy(tmpHead);
    lastHead.quaternion.copy(tmpQuat);
    lastHead.valid = true;
    const now = performance.now();
    if (now - adapt.checkedAt > ADAPT_CHECK_MS) {
      adapt.checkedAt = now;
      adaptQuality(adaptStats.summary(), now);
    }
    if (now - frameLogAt > FRAME_LOG_MS) {
      frameLogAt = now;
      const summary = frameStats.summary();
      if (summary.frames >= 60) console.info(`[splat] VR 프레임 ${formatFrameStats(summary)} · 끊김 ${(summary.dropRate * 100).toFixed(1)}% · 판정 ${diagnoseFrames(summary) ?? "표본 부족"}`);
    }
  }

  const grips = { left: createGripState(), right: createGripState() };
  const snap = createSnapTurn();
  /** 스틱 이동 가감속·이동 방향 스무딩(splat-motion.js). */
  const motion = createMotion();
  // 맞춤·크기 되돌리기 버튼(기본 R3·L3)은 배정 표(core/bindings.js)대로 판정한다.
  const actions = createActionTracker(["splat.fit", "splat.resetSize"]);
  /** @type {{ key: string, start: any } | null} */
  let grab = null;

  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const tmpHead = new THREE.Vector3();
  const tmpQuat = new THREE.Quaternion();
  const tmpScale = new THREE.Vector3();
  const pose = { left: { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() }, right: { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() } };
  /** @type {ReturnType<typeof createSplatHud> | null} */
  let hud = null;
  /** 파일 선택창이 보이는 동안 PLY 렌더링 자체를 멈춘 상태(setSuspended) */
  let suspended = false;
  /**
   * 멈춤: PLY 메시와 SparkRenderer를 장면에서 뺀다. Spark는 장면 안에 있을 때만 onBeforeRender에서 매 프레임 갱신·정렬 워커 요청을 하므로,
   * 빼 두면 정렬·갱신·그리기가 모두 일어나지 않는다. update()도 바로 돌아가 입력 처리·프레임 측정·자동 화질 조절이 멈춘다.
   * 메시는 해제하지 않고 들고 있다가(GPU 메모리 유지) 고르지 않고 닫으면 그대로 다시 붙인다. 다른 파일을 고르면 library가 unload()로 해제한다.
   */
  function applySuspended() {
    if (suspended) {
      if (splat?.parent) anchor.remove(splat);
      if (spark?.parent) stage.scene.remove(spark);
      grid.visible = false;
      hud?.update(false);
      return;
    }
    if (splat && !splat.parent) anchor.add(splat);
    if (spark && !spark.parent) stage.scene.add(spark);
    if (splat) grid.visible = true;
    // 멈춰 있던 동안의 긴 간격을 프레임 측정에 넣지 않는다.
    lastHead.valid = false;
    spikeFilter.reset();
  }

  /** Spark는 크기가 커서 첫 PLY를 열 때 불러온다. */
  async function ensureSpark() {
    if (!sparkModule) sparkModule = await import("@sparkjsdev/spark");
    if (!spark) {
      spark = new sparkModule.SparkRenderer({ renderer: stage.renderer, ...preset.spark });
      if (!suspended) stage.scene.add(spark);
      applyRenderOptions();
    }
    return sparkModule;
  }

  /** 전체 보기·점 크기·화질 단계를 SparkRenderer(와 불러온 PLY)에 바로 적용한다. 값은 다음 프레임부터 쓰인다. */
  function applyRenderOptions() {
    // Quest 고정 중심와 렌더링(three 기본 1)은 화면 가장자리 해상도를 낮춘다. 전체 보기에서는 끈다.
    stage?.renderer.xr.setFoveation?.(options.fullView ? 0 : 1);
    if (!spark) return;
    const base = adapt.level !== null ? sparkForLevel(adapt.level) : baseSpark;
    const settings = sparkSettings(base, options, { vr: !!stage?.isPresenting(), autoSortMs: adapt.sortMs ?? VR_SORT_MS });
    for (const key of RENDER_KEYS) if (settings[key] !== undefined) spark[key] = settings[key];
    for (const mesh of [splat, prefetched?.mesh]) {
      if (!mesh) continue;
      mesh.coneFoveate = options.fullView ? settings.coneFoveate : preset.mesh.coneFoveate;
      mesh.behindFoveate = options.fullView ? settings.behindFoveate : preset.mesh.behindFoveate;
    }
  }

  function setOptions(patch) {
    options = { ...options, ...patch };
    saveOptions(options);
    applyRenderOptions();
    if (!options.prefetch) discardPrefetch();
  }

  function setQuality(level) {
    qualityLevel = level;
    qualityLabel = `안전 ${level}/10`;
    baseSpark = sparkForLevel(level);
    adapt.level = null; // 사람이 고른 화질이 우선
    savePreset(`safe:${level}`);
    applyRenderOptions();
  }

  function discardPrefetch() {
    if (!prefetched) return;
    prefetched.mesh.dispose?.();
    prefetched = null;
  }

  /** 파일을 SplatMesh로 만든다(load·prefetch 공용). */
  async function createMesh(SplatMesh, file) {
    /** @type {Record<string, any>} */
    const meshOptions = { ...preset.mesh, fileName: file.name };
    const fileType = splatFileType(file.name);
    if (fileType) meshOptions.fileType = fileType;
    if (file.stream) {
      // 전체 ArrayBuffer를 한 번 더 만들지 않고 스트림으로 넘긴다(63MB급 SHARP PLY 대비).
      meshOptions.stream = withProgress(await file.stream(), file.size, file.name);
      if (file.size) meshOptions.streamLength = file.size;
    } else {
      meshOptions.url = file.url;
    }
    const mesh = new SplatMesh(meshOptions);
    // SHARP 출력은 상하·앞뒤가 뒤집혀 있어 X축 180° 보정(anchor 좌표에서 (x,-y,-z)).
    mesh.quaternion.set(1, 0, 0, 0);
    return mesh;
  }

  function disposeSplat() {
    if (!splat) return;
    if (splat.parent) anchor.remove(splat);
    splat.dispose?.();
    splat = null;
    numSplats = 0;
    bounds = null;
    pendingFit = null;
    grab = null;
  }

  /** 샘플을 뽑아 anchor 좌표(상하 뒤집힘 적용) 범위를 구한다. */
  function measure(mesh) {
    const total = mesh.packedSplats?.numSplats ?? mesh.numSplats ?? 0;
    const stride = Math.max(1, Math.ceil(total / BOUNDS_SAMPLES));
    const points = new Float32Array(Math.ceil(total / stride) * 3);
    let n = 0;
    try {
      mesh.forEachSplat((index, center, _scales, _quaternion, opacity) => {
        if (index % stride !== 0 || opacity < 0.05) return;
        points[n++] = center.x;
        points[n++] = -center.y;
        points[n++] = -center.z;
      });
    } catch (error) {
      console.warn("[splat] 범위 계산 실패(기본 배치 사용)", error);
    }
    return robustBounds(points.subarray(0, n));
  }

  function applyTransform(transform) {
    anchor.position.copy(transform.position);
    anchor.rotation.set(0, transform.yaw, 0);
    anchor.scale.setScalar(transform.scale);
    anchor.updateMatrixWorld(true);
  }

  const currentTransform = () => ({ position: anchor.position.clone(), yaw: anchor.rotation.y, scale: anchor.scale.x });

  const scaleLimits = () => ({
    min: Math.min(baseScale, 1) * MIN_ZOOM,
    max: Math.max(baseScale, 1) * MAX_ZOOM,
  });

  /** 장면을 눈앞에 맞춘다. VR 안이면 지금 머리 위치·방향 기준, 2D면 궤도 카메라를 맞춘다. */
  function doFit(mode, intro) {
    if (!stage || !splat) return;
    const presenting = stage.isPresenting();
    let headPosition = new THREE.Vector3(0, 0, 0);
    let heading = 0;
    if (presenting) {
      stage.camera.getWorldPosition(headPosition);
      stage.camera.getWorldQuaternion(tmpQuat);
      heading = headingOf(tmpQuat);
    }
    const fit = fitTransform(bounds, { headPosition, heading, mode: "fit" });
    baseScale = fit.scale;
    const effective = presenting ? mode : "fit"; // 2D에는 1:1 몰입이 없다
    const transform = effective === "fit" ? fit : fitTransform(bounds, { headPosition, heading, mode: effective });
    applyTransform(transform);
    lastMode = effective;
    movedSinceFit = false;
    poseValid = true;

    // 바닥 격자: 바닥 기준 공간이면 y=0, 아니면 눈높이 1.4m 아래
    grid.position.y = presenting ? (headPosition.y > 0.7 ? 0 : headPosition.y - 1.4) : -0.5;
    grid.position.x = headPosition.x;
    grid.position.z = headPosition.z - (presenting ? 0 : 1.25);
    grid.visible = !suspended;

    if (!presenting) {
      const target = worldCenter(transform, bounds?.center ?? new THREE.Vector3());
      stage.controls.target.copy(target);
      stage.camera.position.copy(target).add(new THREE.Vector3(0, 0.15, 1.9));
      stage.controls.update();
    } else if (intro) {
      hud?.showToast(9);
    }
  }

  function scheduleFit(mode, { intro = false } = {}) {
    if (!splat) return;
    if (stage.isPresenting()) {
      pendingFit = { mode, frames: SETTLE_FRAMES, intro };
    } else {
      pendingFit = null;
      doFit(mode, intro);
    }
  }

  /** 크기만 맞춤 기준으로 되돌린다(장면 중심의 위치·방향은 그대로). */
  function resetSize() {
    if (!splat) return;
    const transform = currentTransform();
    const center = bounds?.center ?? new THREE.Vector3();
    const keep = worldCenter(transform, center);
    transform.scale = baseScale;
    transform.position.copy(keep).sub(center.clone().multiplyScalar(baseScale).applyAxisAngle(UP, transform.yaw));
    applyTransform(transform);
    movedSinceFit = true;
    emit("app:status", { text: "크기를 맞췄습니다", kind: "" });
  }

  function resetView(mode = "fit") {
    if (!splat) return;
    if (stage.isPresenting()) stage.resetPlayer();
    scheduleFit(mode);
  }

  /** 오른쪽 스틱 누르기: 흐트러졌거나 몰입 상태면 맞춤, 이미 맞춘 상태면 1:1 몰입. */
  function cycleView() {
    resetView(lastMode === "fit" && !movedSinceFit ? "immersive" : "fit");
  }

  /** 컨트롤러 월드 자세. 한 프레임 늦지 않도록 행렬을 갱신해서 읽는다. */
  function readPose(side) {
    const controller = stage.controllers[side];
    if (!controller) return null;
    controller.updateWorldMatrix(true, false);
    controller.matrixWorld.decompose(pose[side].position, pose[side].quaternion, tmpScale);
    return pose[side];
  }

  function updateGrab(input) {
    const held = {
      left: grips.left.update(input.left.grip) && !!stage.controllers.left,
      right: grips.right.update(input.right.grip) && !!stage.controllers.right,
    };
    const key = `${held.left ? "L" : ""}${held.right ? "R" : ""}`;
    if (!key) {
      grab = null;
      return false;
    }
    const left = held.left ? readPose("left") : null;
    const rightPose = held.right ? readPose("right") : null;
    hud?.hideToast();
    if (!grab || grab.key !== key) {
      // 잡는 손이 바뀌면(한 손↔양손) 지금 상태를 기준으로 다시 시작한다.
      grab = {
        key,
        transform: currentTransform(),
        left: left && { position: left.position.clone(), quaternion: left.quaternion.clone() },
        right: rightPose && { position: rightPose.position.clone(), quaternion: rightPose.quaternion.clone() },
      };
      return true;
    }
    let next;
    if (key === "LR") {
      next = twoHandGrab(
        { left: grab.left.position, right: grab.right.position, transform: grab.transform },
        { left: left.position, right: rightPose.position },
        scaleLimits(),
      );
    } else {
      const hand = key === "L" ? "left" : "right";
      const start = grab[hand];
      const now = hand === "left" ? left : rightPose;
      next = oneHandGrab(
        { handPosition: start.position, handQuaternion: start.quaternion, transform: grab.transform },
        { handPosition: now.position, handQuaternion: now.quaternion },
      );
    }
    applyTransform(next);
    movedSinceFit = true;
    return true;
  }

  function locomote(dt, input) {
    const { camera, player } = stage;
    const speed = MOVE_SPEED * Math.min(SPEED_SCALE_RANGE[1], Math.max(SPEED_SCALE_RANGE[0], anchor.scale.x));
    // 머리 수평 방향(위·아래를 똑바로 보면 모르므로 null → 이전 방향 유지)
    camera.getWorldDirection(forward);
    forward.y = 0;
    const headingTarget = forward.lengthSq() < 0.001 ? null : Math.atan2(-forward.x, -forward.z);

    let moved = false;
    // 이동(기본 왼쪽 스틱)·높이(기본 오른쪽 스틱 상하): 목표 속도로 부드럽게 가감속하고, 방향 기준(머리 방향)도 스무딩한다.
    // 높이와 스냅 회전이 같은 스틱이면 대각선은 회전이 우선(회전 축을 0.6 넘게 밀면 높이는 쉰다).
    const map = bindings.get();
    const moveStick = stickRaw(input, map["splat.move"]);
    const heightB = map["splat.height"];
    const turnB = map["splat.turn"];
    const heightRaw = heightB ? (heightB.axis === "y" ? axisRaw(input, heightB) : -axisRaw(input, heightB)) : 0;
    const heightBlocked = sameStick(heightB, turnB) && Math.abs(axisRaw(input, turnB)) >= 0.6;
    const verticalIntent = heightRaw && !heightBlocked ? (STICK_INVERT.y ? 1 : -1) * heightRaw : 0;
    const glide = motion.step({ right: moveStick.x, forward: -moveStick.y, up: verticalIntent }, headingTarget, dt);
    if (glide.moving) {
      const axes = headingAxes(glide.heading);
      player.position.x += (axes.right.x * glide.right + axes.forward.x * glide.forward) * speed * dt;
      player.position.z += (axes.right.z * glide.right + axes.forward.z * glide.forward) * speed * dt;
      player.position.y += glide.up * VERTICAL_SPEED * dt;
      moved = true;
    }
    // 스냅 회전(기본 오른쪽 스틱 좌우). 상하 축에 지정하면 위가 오른쪽 회전이다.
    const turn = snap.step(turnB ? (turnB.axis === "x" ? axisRaw(input, turnB) : -axisRaw(input, turnB)) : 0);
    if (turn) {
      camera.getWorldPosition(tmpHead);
      const turned = turnAbout(player.position, player.rotation.y, tmpHead, turn);
      player.position.copy(turned.position);
      player.rotation.y = turned.yaw;
      moved = true;
    }
    if (moved) movedSinceFit = true;
  }

  return {
    kinds: ["splat"],

    mount(nextStage) {
      stage = nextStage;
      stage.content.add(anchor);
      stage.content.add(grid);
      hud = createSplatHud({ scene: stage.scene, camera: stage.camera, getHand: () => stage.controllers.left });
    },

    async load(item, file) {
      const token = ++loadToken;
      const { SplatMesh } = await ensureSpark();
      if (token !== loadToken) return;
      disposeSplat();

      let mesh;
      if (prefetched && prefetched.itemId === item.id) {
        // 미리 받아 둔 PLY를 그대로 쓴다.
        mesh = prefetched.mesh;
        prefetched = null;
      } else {
        discardPrefetch();
        mesh = await createMesh(SplatMesh, file);
      }
      mesh.visible = false; // 위치를 맞추기 전에 엉뚱한 자리에서 번쩍이지 않게
      if (!suspended) anchor.add(mesh); // 파일 선택창이 떠 있으면 닫힐 때 붙인다(applySuspended)
      splat = mesh;
      applyRenderOptions();

      try {
        await mesh.initialized;
      } catch (error) {
        if (splat === mesh) disposeSplat();
        throw error;
      }
      if (token !== loadToken) return; // 로딩 중 다른 항목으로 바뀜: 정리는 새 load/unload가 한다.
      numSplats = mesh.packedSplats?.numSplats ?? mesh.numSplats ?? 0;
      bounds = measure(mesh);
      baseScale = fitScaleOf(bounds);
      mesh.visible = true;
      if (options.keepPose && poseValid) {
        // 카메라(시점)와 장면 자세를 그대로 둔 채 다음 PLY만 바꾼다. 같은 영상에서 뽑은 PLY는 좌표가 같아서 이어 보기에 좋다.
        movedSinceFit = true;
        return;
      }
      if (!stage.isPresenting()) stage.resetPlayer();
      // VR 안에서 열었다면 지금 머리 앞에, 2D면 궤도 카메라를 맞춘다.
      if (stage.isPresenting()) applyTransform({ position: new THREE.Vector3(0, -100, 0), yaw: 0, scale: 0.0001 }); // 맞춤 전 몇 프레임은 숨김
      scheduleFit("fit");
    },

    /**
     * 다음에 열 PLY를 미리 받아 두는 틀(공용 prefetch가 부른다). 한 장만 들고 있고, 크기 한도를 넘으면 건너뛴다.
     * @param {import('../../core/types.js').LibraryItem} item
     * @param {import('../../core/types.js').OpenedFile} file
     * @returns {Promise<boolean>} 미리 받기를 시작했는지
     */
    async prefetch(item, file) {
      if (!stage || !options.prefetch) return false;
      if ((file.size ?? 0) > PREFETCH_MAX_BYTES) return false;
      if (prefetched?.itemId === item.id) return true;
      const { SplatMesh } = await ensureSpark();
      discardPrefetch();
      const mesh = await createMesh(SplatMesh, file);
      prefetched = { itemId: item.id, mesh };
      applyRenderOptions();
      mesh.initialized.catch(() => {
        if (prefetched?.mesh === mesh) discardPrefetch();
      });
      return true;
    },

    discardPrefetch,

    get prefetchedItemId() {
      return prefetched?.itemId ?? null;
    },

    unload() {
      loadToken++;
      disposeSplat();
      grid.visible = false;
      hud?.update(false);
    },

    /**
     * 파일 선택창이 보이는 동안 장면·바닥 격자·안내를 숨기고 Spark 정렬·렌더를 멈춘다. 풀면 같은 자리·크기로 다시 보인다.
     * @param {boolean} on
     */
    setSuspended(on) {
      if (suspended === !!on) return;
      suspended = !!on;
      applySuspended();
    },
    get suspended() {
      return suspended;
    },

    update(dt, input) {
      if (!stage) return;
      if (suspended) {
        hud?.update(false);
        wasPresenting = input.presenting;
        return;
      }
      // VR 진입·종료 감지
      if (input.presenting && !wasPresenting) {
        introPending = true;
        poseValid = false;
        resetAdapt();
        applyRenderOptions(); // 세션이 새로 열리면 레이어에 중심와 설정을 다시 건다(VR 전용 정렬 갱신도 여기서 걸린다)
        frameStats.reset();
        adaptStats.reset();
        spikeFilter.reset();
        motion.reset();
        grips.left.reset();
        grips.right.reset();
        snap.reset();
        grab = null;
        if (splat) scheduleFit("fit", { intro: true });
      } else if (!input.presenting && wasPresenting) {
        resetAdapt(); // 자동으로 낮춘 화질·정렬 갱신도 원래대로
        applyRenderOptions(); // VR을 나오면 정렬 갱신을 프리셋 값으로 되돌린다
        motion.reset();
        grab = null;
        poseValid = false;
        if (splat) scheduleFit("fit");
      }
      wasPresenting = input.presenting;
      if (!splat) {
        hud?.update(false);
        return;
      }

      if (pendingFit && input.presenting) {
        if (--pendingFit.frames <= 0) {
          const { mode, intro } = pendingFit;
          pendingFit = null;
          doFit(mode, intro || introPending);
          introPending = false;
        }
      }
      if (!input.presenting) {
        hud?.update(false);
        return;
      }
      // 패널이 열려 있으면 main이 빈 입력(연결 안 됨 상태 포함)을 준다 → 조작 없음, 안내 카드도 숨김
      const active = input.left.connected || input.right.connected;
      hud?.update(active);
      if (!active) {
        grab = null;
        lastHead.valid = false;
        motion.reset();
        return;
      }
      if (pendingFit) {
        lastHead.valid = false;
        motion.reset();
        return; // 맞춤 직전에는 조작하지 않는다
      }
      sampleFrame(dt);

      const grabbing = updateGrab(input);
      const fired = actions.update(input);
      if (fired.has("splat.fit")) cycleView();
      if (fired.has("splat.resetSize")) resetSize();
      if (grabbing) motion.reset();
      else locomote(dt, input);
    },

    /**
     * 공용 VR 패널 배치: 장면이 있는 방향(시선 기준 각도)과 그 반폭을 알려 주면, 패널이 장면 바깥 쪽 가장자리에 열린다.
     * 시선이 장면에서 벗어난 채 열어도 겹치지 않는다. 장면이 사방을 둘러싸면(1:1 몰입 등) 정면에 연다.
     */
    panelPlacement() {
      const distance = 1.15;
      if (!stage || !splat || !bounds) return { distance };
      const head = stage.camera.getWorldPosition(tmpHead);
      const center = worldCenter(currentTransform(), bounds.center);
      const gaze = stage.camera.getWorldDirection(forward);
      const toScene = center.sub(head);
      toScene.y = 0;
      const sceneDistance = toScene.length();
      if (sceneDistance < 1e-3) return { distance };
      const radius = 0.5 * Math.hypot(bounds.size.x, bounds.size.z) * anchor.scale.x;
      return {
        distance,
        avoidYaw: yawOfDirection(toScene.x, toScene.z) - yawOfDirection(gaze.x, gaze.z),
        avoidHalf: angularHalf(radius, sceneDistance),
      };
    },

    /** 크기·위치 맞춤(패널 "위치 초기화"가 부른다). */
    resetView,

    /** VR 패널 [PLY 옵션] 줄. 값은 side에 보인다. */
    panelOptions() {
      return [
        {
          id: "quality",
          label: "화질",
          side: formatQualitySide(qualityLevel ? `안전 ${qualityLevel}/10` : qualityLabel, adapt.level),
          run: () => setQuality(cycle(QUALITY_LEVELS, qualityLevel ?? 5)),
        },
        {
          id: "full-view",
          label: options.fullView ? "전체 보기 (가장자리 살림, 느려질 수 있음)" : "전체 보기 (가장자리 안 사라지게)",
          side: options.fullView ? "켬" : "끔",
          run: () => setOptions({ fullView: !options.fullView }),
        },
        { id: "point-size", label: "점 크기", side: formatPointSize(options.pointSize), run: () => setOptions({ pointSize: cycle(POINT_SIZES, options.pointSize) }) },
        { id: "keep-pose", label: "다음·이전 PLY로 갈 때 자세 유지", side: options.keepPose ? "켬" : "끔", run: () => setOptions({ keepPose: !options.keepPose }) },
        { id: "prefetch", label: "다음 PLY 미리 받기", side: options.prefetch ? "켬" : "끔", run: () => setOptions({ prefetch: !options.prefetch }) },
        {
          id: "sort-interval",
          label: "정렬 갱신·자동 조절 (프레임 부족 시)",
          side: formatSortInterval(options.sortMs, adapt),
          run: () => setOptions({ sortMs: SORT_CHOICES[(SORT_CHOICES.indexOf(options.sortMs) + 1) % SORT_CHOICES.length] }),
        },
        { id: "frame-stats", label: "프레임 측정 (누르면 다시 측정)", side: formatFrameStats(frameStats.summary()), run: () => frameStats.reset() },
      ];
    },

    panelActions() {
      return [
        { id: "splat-size", label: "크기 초기화", run: () => resetSize() },
        { id: "splat-immersive", label: "1:1 몰입", run: () => resetView("immersive") },
        { id: "splat-help", label: "조작 안내", run: () => hud?.showToast(12) },
      ];
    },

    /** 검증용: 지금 장면 변환·맞춤 정보. */
    getState() {
      return {
        position: anchor.position.toArray(),
        yaw: anchor.rotation.y,
        scale: anchor.scale.x,
        baseScale,
        lastMode,
        movedSinceFit,
        grabbing: !!grab,
        bounds: bounds && { center: bounds.center.toArray(), radius: bounds.radius, size: bounds.size.toArray() },
        helpVisible: !!hud?.visible,
        frame: { ...frameStats.summary(), diagnosis: diagnoseFrames(frameStats.summary()) },
        sortMs: options.sortMs,
        adapt: { sortMs: adapt.sortMs, level: adapt.level },
      };
    },

    info() {
      return splat ? { numSplats } : null;
    },
  };
}
