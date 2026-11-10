// VR 안 패널: 캔버스 텍스처 평면 + 컨트롤러 레이 선택.
// B/Y로 열고 닫는다. 목록(현재 항목 주변), 이전/다음, 위치 초기화, VR 종료, 뷰어가 내놓는 panelActions 버튼을 보여 준다.
// 레이를 버튼에 맞추고 트리거를 누르면 선택된다. 패널이 열려 있는 동안 뷰어에는 입력이 전달되지 않는다.

import * as THREE from "three";
import { on } from "../core/events.js";

const W = 1024;
const H = 768;
const PLANE_W = 1.28;
const PLANE_H = PLANE_W * (H / W);
const DISTANCE = 1.25;
const LIST_ROWS = 5;

const COLORS = {
  bg: "rgba(17, 22, 26, 0.94)",
  line: "#2e3a42",
  text: "#e8eef2",
  muted: "#9aaab4",
  accent: "#4fb3ff",
  button: "#173245",
  hover: "#24648f",
  current: "#1f4f3a",
  disabled: "#2a3238",
};

/**
 * @param {{
 *   stage: ReturnType<typeof import('../core/xr-stage.js').createXrStage>,
 *   library: ReturnType<typeof import('../core/library.js').createLibrary>,
 *   getActions?: () => Array<{ id: string, label: string, run: () => void }>,
 * }} options
 */
export function createVrPanel({ stage, library, getActions = () => [] }) {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(PLANE_W, PLANE_H),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, toneMapped: false }),
  );
  mesh.renderOrder = 999;
  mesh.visible = false;
  stage.scene.add(mesh);

  const rayLines = {
    left: createRayLine(),
    right: createRayLine(),
  };

  const raycaster = new THREE.Raycaster();
  const tempMatrix = new THREE.Matrix4();
  const tempVec = new THREE.Vector3();
  const tempDir = new THREE.Vector3();

  /** @type {Array<{ x: number, y: number, w: number, h: number, label: string, run: () => void, enabled: boolean, current?: boolean }>} */
  let buttons = [];
  /** @type {{ left: string | null, right: string | null }} */
  const hover = { left: null, right: null };
  let open = false;
  let message = "";
  let dirty = true;

  function createRayLine() {
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]),
      new THREE.LineBasicMaterial({ color: 0x4fb3ff }),
    );
    line.visible = false;
    line.scale.z = 2;
    return line;
  }

  function attachRays() {
    for (const side of /** @type {const} */ (["left", "right"])) {
      const controller = stage.controllers[side];
      const line = rayLines[side];
      if (controller && line.parent !== controller) controller.add(line);
    }
  }

  function setOpen(next) {
    open = next;
    mesh.visible = open;
    if (open) {
      placeInFront();
      dirty = true;
    }
    for (const line of Object.values(rayLines)) line.visible = open;
  }

  /** 시선 방향(수평)으로 DISTANCE만큼 앞, 눈높이에 둔다. */
  function placeInFront() {
    const camera = stage.camera;
    camera.getWorldPosition(tempVec);
    camera.getWorldDirection(tempDir);
    tempDir.y = 0;
    if (tempDir.lengthSq() < 0.001) tempDir.set(0, 0, -1);
    tempDir.normalize();
    mesh.position.copy(tempVec).addScaledVector(tempDir, DISTANCE);
    mesh.lookAt(tempVec.x, mesh.position.y, tempVec.z);
  }

  function layout() {
    const list = library.playlist;
    const current = library.current;
    const index = Math.max(0, list.findIndex((item) => current && item.id === current.id));
    const first = Math.max(0, Math.min(index - Math.floor(LIST_ROWS / 2), list.length - LIST_ROWS));
    buttons = [];

    list.slice(first, first + LIST_ROWS).forEach((item, row) => {
      const isCurrent = !!current && item.id === current.id;
      buttons.push({
        x: 40,
        y: 150 + row * 70,
        w: W - 80,
        h: 60,
        label: `${isCurrent ? "▶ " : ""}${item.name}`,
        run: () => library.open(item, { playlist: list }),
        enabled: library.canOpen(item),
        current: isCurrent,
      });
    });

    const actions = [
      { label: "이전", run: () => library.prev(), enabled: list.length > 1 },
      { label: "다음", run: () => library.next(), enabled: list.length > 1 },
      { label: "위치 초기화", run: () => stage.resetPlayer(), enabled: true },
      { label: "VR 종료", run: () => stage.exitVR(), enabled: true },
      ...getActions().map((action) => ({ label: action.label, run: action.run, enabled: true })),
    ];
    const perRow = 4;
    const gap = 16;
    const bw = (W - 80 - gap * (perRow - 1)) / perRow;
    actions.forEach((action, i) => {
      buttons.push({
        x: 40 + (i % perRow) * (bw + gap),
        y: 520 + Math.floor(i / perRow) * 84,
        w: bw,
        h: 72,
        ...action,
      });
    });
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  }

  function draw() {
    layout();
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = COLORS.bg;
    roundRect(0, 0, W, H, 36);
    ctx.fill();
    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = 3;
    ctx.stroke();

    const current = library.current;
    const list = library.playlist;
    const index = list.findIndex((item) => current && item.id === current.id);
    ctx.fillStyle = COLORS.text;
    ctx.font = "600 40px system-ui, 'Noto Sans KR', sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText(current ? "현재 파일" : "열린 파일 없음", 40, 60);
    ctx.font = "30px system-ui, 'Noto Sans KR', sans-serif";
    ctx.fillStyle = COLORS.muted;
    ctx.textAlign = "right";
    ctx.fillText(list.length ? `${index + 1} / ${list.length}` : "", W - 40, 60);
    ctx.textAlign = "left";
    ctx.fillStyle = COLORS.muted;
    ctx.font = "26px system-ui, 'Noto Sans KR', sans-serif";
    ctx.fillText(message || "X/A 이전·다음   B/Y 패널 닫기   트리거로 선택", 40, 108);

    for (const button of buttons) {
      const key = `${button.x},${button.y}`;
      const hovered = hover.left === key || hover.right === key;
      ctx.fillStyle = !button.enabled ? COLORS.disabled : hovered ? COLORS.hover : button.current ? COLORS.current : COLORS.button;
      roundRect(button.x, button.y, button.w, button.h, 14);
      ctx.fill();
      ctx.strokeStyle = hovered ? COLORS.accent : COLORS.line;
      ctx.lineWidth = hovered ? 4 : 2;
      ctx.stroke();
      ctx.fillStyle = button.enabled ? COLORS.text : COLORS.muted;
      ctx.font = "30px system-ui, 'Noto Sans KR', sans-serif";
      ctx.textAlign = button.y < 500 ? "left" : "center";
      const tx = button.y < 500 ? button.x + 20 : button.x + button.w / 2;
      ctx.fillText(fit(button.label, button.w - 40), tx, button.y + button.h / 2);
    }
    texture.needsUpdate = true;
    dirty = false;
  }

  function fit(text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let out = text;
    while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) out = out.slice(0, -1);
    return `${out}…`;
  }

  /** 컨트롤러 레이가 패널의 어느 버튼에 닿았는지. */
  function pick(side) {
    const controller = stage.controllers[side];
    if (!controller) return null;
    tempMatrix.identity().extractRotation(controller.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);
    const hit = raycaster.intersectObject(mesh, false)[0];
    if (!hit?.uv) return null;
    const px = hit.uv.x * W;
    const py = (1 - hit.uv.y) * H;
    return buttons.find((b) => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) ?? null;
  }

  // 목록·현재 항목이 바뀌면 다시 그린다.
  for (const name of ["library:changed", "item:opened", "item:loading", "item:error", "item:closed"]) {
    on(name, () => {
      dirty = true;
    });
  }

  return {
    get isOpen() {
      return open;
    },
    toggle: () => setOpen(!open),
    close: () => setOpen(false),
    showMessage(text) {
      message = text;
      dirty = true;
    },
    invalidate() {
      dirty = true;
    },

    /**
     * 매 프레임 호출. 패널이 열려 있으면 레이 선택을 처리하고 true를 돌려준다(뷰어 입력 차단용).
     * @param {import('../core/types.js').XrInput} input
     */
    update(input) {
      if (!input.presenting) {
        if (open) setOpen(false);
        return false;
      }
      attachRays();
      if (input.left.secondaryPressed || input.right.secondaryPressed) setOpen(!open);
      if (!open) return false;

      for (const side of /** @type {const} */ (["left", "right"])) {
        const button = pick(side);
        const key = button ? `${button.x},${button.y}` : null;
        if (hover[side] !== key) {
          hover[side] = key;
          dirty = true;
        }
        if (button && button.enabled && input[side].triggerPressed) {
          message = "";
          button.run();
          dirty = true;
        }
      }
      if (dirty) draw();
      return true;
    },
  };
}
