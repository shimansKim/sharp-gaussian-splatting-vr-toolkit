// PLY(Gaussian splat) 뷰어.
// VR 조작(Quest 표준):
//   그립(옆 버튼)        장면을 잡고 끌어 이동, 손을 좌우로 돌리면 같이 회전
//   양손 그립            두 손을 벌리면 확대, 모으면 축소(두 손 사이 가운데 기준), 두 손을 잇는 선을 돌리면 회전
//   왼쪽 스틱            부드러운 이동(보는 방향 기준)
//   오른쪽 스틱          좌우 = 30° 스냅 회전(머리 위치 기준), 위아래 = 높이. 방향은 장면을 미는 쪽(splat-math의 STICK_INVERT)
//   오른쪽 스틱 누르기   크기·위치 맞춤(장면을 눈앞 적정 크기로). 맞춘 상태에서 한 번 더 = 1:1 몰입(원본 카메라 자리)
//   왼쪽 스틱 누르기     크기만 맞춤(위치·방향 유지)
//   X/A 이전·다음, B/Y 목록 패널(공통)
// 장면은 anchor 그룹 하나(위치·Y회전·균일 크기)로만 움직인다. VR에 들어가거나 PLY를 열면 자동으로 눈앞에 맞춘다.

import * as THREE from "three";
import { emit } from "../../core/events.js";
import { formatBytes, splatFileType } from "../../core/kinds.js";
import { createSplatHud } from "./splat-hud.js";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  STICK_INVERT,
  createGripState,
  createSnapTurn,
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
const UP = new THREE.Vector3(0, 1, 0);

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
 * @param {{ preset: ReturnType<typeof import('./quest-presets.js').getSplatPreset> }} options
 * @returns {Viewer & { info(): { numSplats: number } | null }}
 */
export function createSplatViewer({ preset }) {
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

  const grips = { left: createGripState(), right: createGripState() };
  const snap = createSnapTurn();
  const stickClick = { left: false, right: false };
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

  /** Spark는 크기가 커서 첫 PLY를 열 때 불러온다. */
  async function ensureSpark() {
    if (!sparkModule) sparkModule = await import("@sparkjsdev/spark");
    if (!spark) {
      spark = new sparkModule.SparkRenderer({ renderer: stage.renderer, ...preset.spark });
      stage.scene.add(spark);
    }
    return sparkModule;
  }

  function disposeSplat() {
    if (!splat) return;
    anchor.remove(splat);
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

    // 바닥 격자: 바닥 기준 공간이면 y=0, 아니면 눈높이 1.4m 아래
    grid.position.y = presenting ? (headPosition.y > 0.7 ? 0 : headPosition.y - 1.4) : -0.5;
    grid.position.x = headPosition.x;
    grid.position.z = headPosition.z - (presenting ? 0 : 1.25);
    grid.visible = true;

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
    camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 0.001) forward.set(0, 0, -1);
    else forward.normalize();
    right.crossVectors(forward, UP).normalize();

    let moved = false;
    if (input.left.x || input.left.y) {
      player.position.addScaledVector(right, input.left.x * speed * dt);
      player.position.addScaledVector(forward, -input.left.y * speed * dt);
      moved = true;
    }
    // 오른쪽 스틱: 좌우는 스냅 회전, 위아래는 높이(대각선으로 밀 때 좌우가 우선)
    const turn = snap.step(input.right.x);
    if (turn) {
      camera.getWorldPosition(tmpHead);
      const turned = turnAbout(player.position, player.rotation.y, tmpHead, turn);
      player.position.copy(turned.position);
      player.rotation.y = turned.yaw;
      moved = true;
    }
    if (input.right.y && Math.abs(input.right.x) < 0.6) {
      player.position.y += (STICK_INVERT.y ? 1 : -1) * input.right.y * VERTICAL_SPEED * dt;
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

      /** @type {Record<string, any>} */
      const options = { ...preset.mesh, fileName: file.name };
      const fileType = splatFileType(file.name);
      if (fileType) options.fileType = fileType;
      if (file.stream) {
        // 전체 ArrayBuffer를 한 번 더 만들지 않고 스트림으로 넘긴다(63MB급 SHARP PLY 대비).
        options.stream = withProgress(await file.stream(), file.size, file.name);
        if (file.size) options.streamLength = file.size;
      } else {
        options.url = file.url;
      }

      const mesh = new SplatMesh(options);
      // SHARP 출력은 상하·앞뒤가 뒤집혀 있어 X축 180° 보정(anchor 좌표에서 (x,-y,-z)).
      mesh.quaternion.set(1, 0, 0, 0);
      mesh.visible = false; // 위치를 맞추기 전에 엉뚱한 자리에서 번쩍이지 않게
      anchor.add(mesh);
      splat = mesh;

      try {
        await mesh.initialized;
      } catch (error) {
        if (splat === mesh) disposeSplat();
        throw error;
      }
      if (token !== loadToken) return; // 로딩 중 다른 항목으로 바뀜: 정리는 새 load/unload가 한다.
      numSplats = mesh.packedSplats?.numSplats ?? mesh.numSplats ?? 0;
      bounds = measure(mesh);
      if (!stage.isPresenting()) stage.resetPlayer();
      mesh.visible = true;
      // VR 안에서 열었다면 지금 머리 앞에, 2D면 궤도 카메라를 맞춘다.
      if (stage.isPresenting()) applyTransform({ position: new THREE.Vector3(0, -100, 0), yaw: 0, scale: 0.0001 }); // 맞춤 전 몇 프레임은 숨김
      scheduleFit("fit");
    },

    unload() {
      loadToken++;
      disposeSplat();
      grid.visible = false;
      hud?.update(false);
    },

    update(dt, input) {
      if (!stage) return;
      // VR 진입·종료 감지
      if (input.presenting && !wasPresenting) {
        introPending = true;
        grips.left.reset();
        grips.right.reset();
        snap.reset();
        grab = null;
        if (splat) scheduleFit("fit", { intro: true });
      } else if (!input.presenting && wasPresenting) {
        grab = null;
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
        return;
      }
      if (pendingFit) return; // 맞춤 직전에는 조작하지 않는다

      const grabbing = updateGrab(input);
      for (const side of /** @type {const} */ (["left", "right"])) {
        const pressed = input[side].stickPressed && !stickClick[side];
        stickClick[side] = !!input[side].stickPressed;
        if (!pressed) continue;
        if (side === "right") cycleView();
        else resetSize();
      }
      if (!grabbing) locomote(dt, input);
    },

    /** 공용 VR 패널 배치: 장면이 눈앞 가운데에 놓이므로 패널은 왼쪽 옆으로 비켜 열어 겹치지 않게 한다. */
    panelPlacement() {
      return { yawOffset: (52 * Math.PI) / 180, distance: 1.15 };
    },

    /** 크기·위치 맞춤(패널 "위치 초기화"가 부른다). */
    resetView,

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
      };
    },

    info() {
      return splat ? { numSplats } : null;
    },
  };
}
