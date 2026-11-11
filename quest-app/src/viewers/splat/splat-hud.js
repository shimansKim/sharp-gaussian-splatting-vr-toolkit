// PLY 조작 안내 카드. 처음 몇 초는 눈앞 아래쪽에 띄우고, 이후에는 왼손을 눈앞으로 들면 손 위에 나타난다.
// 카드는 장면(scene)에 직접 붙이고 매 프레임 위치만 계산한다(플레이어가 움직여도 따라간다).

import * as THREE from "three";

const W = 800;
const H = 360;
const CARD_W = 0.62;
const CARD_H = CARD_W * (H / W);
const FONT = "system-ui, 'Noto Sans KR', sans-serif";

export const HINT_LINES = [
  ["그립(옆 버튼)", "장면 잡고 이동·돌리기"],
  ["양손 그립", "벌리면 확대, 모으면 축소"],
  ["왼쪽 스틱", "이동"],
  ["오른쪽 스틱", "좌우 30° 돌리기 · 위아래 높이"],
  ["스틱 누르기", "크기·위치 맞춤 (한 번 더: 1:1 몰입)"],
  ["X/A · B/Y", "이전·다음 · 목록 열기"],
];

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
    const rowH = 46;
    HINT_LINES.forEach(([key, text], i) => {
      const y = 92 + i * rowH;
      ctx.font = `600 27px ${FONT}`;
      ctx.fillStyle = "#4fb3ff";
      ctx.fillText(key, 32, y);
      ctx.font = `26px ${FONT}`;
      ctx.fillStyle = "#e8eef2";
      ctx.fillText(text, 262, y);
    });
    texture.needsUpdate = true;
  }

  return {
    get visible() {
      return mesh.visible;
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
      if (!enabled) {
        mesh.visible = false;
        return;
      }
      camera.getWorldPosition(head);
      camera.getWorldDirection(forward);
      if (performance.now() < toastUntil) {
        // 정면에서 약간 아래, 시야 한가운데를 가리지 않는 자리
        const flat = forward.clone().setY(0);
        if (flat.lengthSq() < 1e-4) flat.set(0, 0, -1);
        flat.normalize();
        mesh.position.copy(head).addScaledVector(flat, 0.8);
        mesh.position.y = head.y - 0.36;
        mesh.scale.setScalar(1);
        mesh.lookAt(head);
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
      scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
      texture.dispose();
    },
  };
}
