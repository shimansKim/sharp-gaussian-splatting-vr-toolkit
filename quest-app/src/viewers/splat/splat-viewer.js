// PLY(Gaussian splat) 뷰어. 기존 webxr-spark-demo의 Spark 사용법과 VR 컨트롤 매핑을 옮겼다.
// 왼쪽 스틱 이동, 오른쪽 스틱 회전, 그립 위·아래, 트리거 줌. (X/A 이전·다음, B/Y 패널은 공통 처리)

import * as THREE from "three";
import { splatFileType } from "../../core/kinds.js";

/** @typedef {import('../../core/types.js').Viewer} Viewer */

const MOVE_SPEED = 0.75;
const VERTICAL_SPEED = 0.55;
const TURN_SPEED = 1.35;
const ZOOM_SPEED = 1.6;

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
  const grid = new THREE.GridHelper(4, 16, 0x42606a, 0x26343a);
  grid.position.y = -1.25;
  grid.visible = false;

  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

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
    stage.content.remove(splat);
    splat.dispose?.();
    splat = null;
    numSplats = 0;
  }

  return {
    kinds: ["splat"],

    mount(nextStage) {
      stage = nextStage;
      stage.content.add(grid);
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
        options.stream = await file.stream();
        if (file.size) options.streamLength = file.size;
      } else {
        options.url = file.url;
      }

      const mesh = new SplatMesh(options);
      // SHARP 출력 배치: 상하 뒤집힘 보정, 정면 1.6m, 약간 아래.
      mesh.position.set(0, -0.2, -1.6);
      mesh.quaternion.set(1, 0, 0, 0);
      mesh.scale.setScalar(1);
      stage.content.add(mesh);
      splat = mesh;

      try {
        await mesh.initialized;
      } catch (error) {
        if (splat === mesh) disposeSplat();
        throw error;
      }
      if (token !== loadToken) return; // 로딩 중 다른 항목으로 바뀜: 정리는 새 load/unload가 한다.
      numSplats = mesh.packedSplats?.numSplats ?? mesh.numSplats ?? 0;
      grid.visible = true;
      stage.resetPlayer();
    },

    unload() {
      loadToken++;
      disposeSplat();
      grid.visible = false;
    },

    update(dt, input) {
      if (!stage || !input.presenting || !splat) return;
      const { camera, player } = stage;

      camera.getWorldDirection(forward);
      forward.y = 0;
      if (forward.lengthSq() < 0.001) forward.set(0, 0, -1);
      else forward.normalize();
      right.crossVectors(forward, up).normalize();

      player.position.addScaledVector(right, input.left.x * MOVE_SPEED * dt);
      player.position.addScaledVector(forward, -input.left.y * MOVE_SPEED * dt);
      player.position.y += (input.right.grip - input.left.grip) * VERTICAL_SPEED * dt;
      player.rotation.y -= input.right.x * TURN_SPEED * dt;
      player.position.addScaledVector(forward, (input.right.trigger - input.left.trigger) * ZOOM_SPEED * dt);
    },

    info() {
      return splat ? { numSplats } : null;
    },
  };
}
