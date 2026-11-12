// PLY 조작 안내 카드. 처음 몇 초는 공용 UI 자리(정면 아래쪽, 기울임 — 공용 패널과 같은 자리)에 띄우고, 이후에는 왼손을 눈앞으로 들면 손 위에 나타난다.
// 안내 카드는 머리를 따라다니지 않는다: UI 앵커(core/ui-state.js)에 고정되고, 사람이 UI를 옮길 때만 같이 옮겨진다.
// B/Y로 UI를 끄면(ui.visible=false) 손 위 카드까지 모두 숨긴다.

import * as THREE from "three";
import { bindings, describeAction } from "../../core/bindings.js";
import { DOCK_TILT, dockCenter, dockRotation, dockTop } from "../../core/panel-layout.js";
import { ui } from "../../core/ui-state.js";

const W = 800;
const H = 400;
const CARD_W = 0.62;
const CARD_H = CARD_W * (H / W);
const FONT = "system-ui, 'Noto Sans KR', sans-serif";

/**
 * 안내 카드 줄: 배정 표(core/bindings.js)에서 만든다. 사람이 버튼을 바꾸면 카드도 바뀐다.
 * @param {Record<string, any>} map
 * @returns {Array<[string, string]>}
 */
export function hintLines(map = bindings.get()) {
  const d = (id) => describeAction(map, id);
  const lines = [
    ["그립(옆 버튼)", "장면 잡고 이동·돌리기"],
    ["양손 그립", "벌리면 확대, 모으면 축소"],
    [d("splat.move"), "이동"],
    [d("splat.turn"), "30° 돌리기"],
    [d("splat.height"), "높이"],
    [d("splat.fit"), "크기·위치 맞춤 (한 번 더: 1:1 몰입)"],
    [d("splat.resetSize"), "크기만 되돌리기"],
    [`${d("common.prev")} / ${d("common.next")}`, "이전 · 다음 파일"],
    [d("common.uiToggle"), "UI 켜기·끄기"],
    [d("common.uiMove"), "UI를 여기로 옮기기"],
  ];
  return lines.filter(([key]) => !key.includes("지정 안 함") || key.includes("/"));
}

/** 기본 배정의 안내 줄(예전 이름 호환) */
export const HINT_LINES = hintLines();

/** 카드를 손 위로 보여 줄지: 손이 가깝고 시야 안쪽에 있을 때. */
export function isRaised(headPosition, headForward, handPosition) {
  const toHand = handPosition.clone().sub(headPosition);
  const distance = toHand.length();
  if (distance < 0.12 || distance > 0.8) return false;
  return toHand.normalize().dot(headForward) > Math.cos((38 * Math.PI) / 180);
}

/**
 * @param {{ scene: THREE.Scene, camera: THREE.Camera, getHand: () => THREE.Object3D | null }} options
 */
export function createSplatHud({ scene, camera, getHand }) {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(CARD_W, CARD_H),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, toneMapped: false }),
  );
  mesh.renderOrder = 998;
  mesh.visible = false;
  scene.add(mesh);

  drawCard();
  // 배정이 바뀌면 카드를 다시 그린다.
  const offBindings = bindings.subscribe(() => drawCard());

  const head = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const hand = new THREE.Vector3();
  let toastUntil = 0;

  function drawCard() {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "rgba(17, 22, 26, 0.92)";
    ctx.beginPath();
    ctx.roundRect(0, 0, W, H, 28);
    ctx.fill();
    ctx.strokeStyle = "#4fb3ff";
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.textBaseline = "middle";
    ctx.font = `600 34px ${FONT}`;
    ctx.fillStyle = "#e8eef2";
    ctx.textAlign = "left";
    ctx.fillText("PLY 조작", 32, 38);
    const lines = hintLines();
    const rowH = Math.min(44, (H - 92) / lines.length);
    const size = Math.round(Math.min(26, rowH * 0.62));
    // 글이 칸보다 길면 글자를 줄여 맞춘다(사람이 바꾼 배정 이름은 길이가 제각각이다).
    const fit = (text, weight, max) => {
      let px = size;
      ctx.font = `${weight} ${px}px ${FONT}`;
      while (px > 14 && ctx.measureText(text).width > max) {
        px -= 1;
        ctx.font = `${weight} ${px}px ${FONT}`;
      }
    };
    lines.forEach(([key, text], i) => {
      const y = 82 + rowH / 2 + i * rowH;
      fit(key, 600, 300);
      ctx.fillStyle = "#4fb3ff";
      ctx.fillText(key, 32, y);
      fit(text, 400, W - 350 - 24);
      ctx.fillStyle = "#e8eef2";
      ctx.fillText(text, 350, y);
    });
    texture.needsUpdate = true;
  }

  return {
    /** 안내가 보이는 중이거나(켜져 있고 띄우는 시간이 안 지남) 곧 보일 상태. B/Y가 켜 둘지 끌지 판단하는 데 쓴다. */
    get visible() {
      return ui.visible && (mesh.visible || performance.now() < toastUntil);
    },
    /** 눈앞에 seconds초 동안 띄운다. */
    showToast(seconds = 9) {
      toastUntil = performance.now() + seconds * 1000;
    },
    hideToast() {
      toastUntil = 0;
    },
    get toastActive() {
      return performance.now() < toastUntil;
    },
    /** @param {boolean} enabled 패널이 열려 있거나 VR 밖이면 false */
    update(enabled) {
      if (!enabled || !ui.visible) {
        mesh.visible = false;
        return;
      }
      camera.getWorldPosition(head);
      camera.getWorldDirection(forward);
      if (performance.now() < toastUntil) {
        // 공용 UI 자리(정면 아래쪽): 시야 한가운데를 가리지 않고, 머리를 돌려도 따라오지 않는다.
        const ref = ui.reference(camera);
        mesh.scale.setScalar(1);
        mesh.rotation.copy(dockRotation(ref.yaw, DOCK_TILT));
        mesh.position.copy(dockCenter(dockTop(ref.head, ref.yaw), ref.yaw, DOCK_TILT, CARD_H));
        mesh.visible = true;
        return;
      }
      const controller = getHand();
      if (controller) {
        controller.getWorldPosition(hand);
        if (isRaised(head, forward, hand)) {
          mesh.position.copy(hand).add(new THREE.Vector3(0, 0.12, 0));
          mesh.scale.setScalar(0.55); // 손 앞은 가까워서 작게
          mesh.lookAt(head);
          mesh.visible = true;
          return;
        }
      }
      mesh.visible = false;
    },
    dispose() {
      offBindings();
      scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
      texture.dispose();
    },
  };
}
