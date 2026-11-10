// 무대: renderer, scene, camera, player 그룹, XR 세션, 컨트롤러 입력.
// 뷰어는 content 그룹 아래에만 객체를 붙인다(계약: types.js의 XrStage).
// 계약 외 추가 멤버(앱 내부용): controls(2D OrbitControls), controllers(레이용), input, setFrameHandler.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { emit } from "./events.js";

/** @typedef {import('./types.js').XrInput} XrInput */
/** @typedef {import('./types.js').XrHandInput} XrHandInput */

const DEADZONE = 0.16;
const PRESS_THRESHOLD = 0.6;
const BACKGROUND = 0x11161a;

/** @returns {XrHandInput} */
function emptyHand() {
  return {
    connected: false,
    x: 0,
    y: 0,
    trigger: 0,
    grip: 0,
    primary: false,
    secondary: false,
    primaryPressed: false,
    secondaryPressed: false,
    triggerPressed: false,
    gripPressed: false,
  };
}

/** @returns {XrInput} */
export function emptyInput() {
  return { presenting: false, left: emptyHand(), right: emptyHand() };
}

const axis = (value) => (Math.abs(value) > DEADZONE ? value : 0);

/**
 * @param {{
 *   container: HTMLElement,
 *   pixelRatio?: (devicePixelRatio: number) => number,
 *   precision?: 'highp' | 'mediump',
 * }} options
 */
export function createXrStage({ container, pixelRatio = (dpr) => Math.min(dpr, 1.5), precision = "highp" }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND);

  const camera = new THREE.PerspectiveCamera(65, 1, 0.001, 1000);
  camera.position.set(0, 0, 2.2);

  const renderer = new THREE.WebGLRenderer({
    antialias: false,
    alpha: false,
    powerPreference: "high-performance",
    precision,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(BACKGROUND, 1);
  renderer.setPixelRatio(pixelRatio(window.devicePixelRatio));
  renderer.xr.enabled = true;
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.minDistance = 0.2;
  controls.maxDistance = 8;

  const player = new THREE.Group();
  player.add(camera);
  scene.add(player);

  const content = new THREE.Group();
  scene.add(content);

  /** 컨트롤러 타깃 레이 공간. 핸디드니스는 connected 이벤트에서 알게 된다. */
  const controllers = { left: /** @type {THREE.Group | null} */ (null), right: /** @type {THREE.Group | null} */ (null) };
  for (let index = 0; index < 2; index++) {
    const controller = renderer.xr.getController(index);
    controller.addEventListener("connected", (event) => {
      const hand = event.data?.handedness;
      if (hand === "left" || hand === "right") controllers[hand] = controller;
    });
    controller.addEventListener("disconnected", () => {
      if (controllers.left === controller) controllers.left = null;
      if (controllers.right === controller) controllers.right = null;
    });
    player.add(controller);
  }

  /** @type {XrInput} */
  const input = emptyInput();
  const previous = { left: emptyHand(), right: emptyHand() };
  /** @type {((dt: number, input: XrInput) => void) | null} */
  let frameHandler = null;
  let previousTime = performance.now();

  function resize() {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    if (renderer.xr.isPresenting) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
  }
  new ResizeObserver(resize).observe(container);
  resize();

  function pollInput() {
    const session = renderer.xr.getSession();
    input.presenting = !!session && renderer.xr.isPresenting;
    for (const side of /** @type {const} */ (["left", "right"])) {
      const state = input[side];
      const last = previous[side];
      last.primary = state.primary;
      last.secondary = state.secondary;
      last.trigger = state.trigger;
      last.grip = state.grip;
      state.connected = false;
      state.x = state.y = state.trigger = state.grip = 0;
      state.primary = state.secondary = false;
    }
    if (session) {
      for (const source of session.inputSources) {
        const gamepad = source.gamepad;
        if (!gamepad || (source.handedness !== "left" && source.handedness !== "right")) continue;
        const state = input[source.handedness];
        state.connected = true;
        // xr-standard 매핑: axes[2], axes[3]이 스틱, buttons[0] 트리거, [1] 그립, [4] A/X, [5] B/Y
        if (gamepad.axes.length >= 4) {
          state.x = axis(gamepad.axes[2]);
          state.y = axis(gamepad.axes[3]);
        }
        state.trigger = gamepad.buttons[0]?.value ?? 0;
        state.grip = gamepad.buttons[1]?.value ?? 0;
        state.primary = gamepad.buttons[4]?.pressed ?? false;
        state.secondary = gamepad.buttons[5]?.pressed ?? false;
      }
    }
    for (const side of /** @type {const} */ (["left", "right"])) {
      const state = input[side];
      const last = previous[side];
      state.primaryPressed = state.primary && !last.primary;
      state.secondaryPressed = state.secondary && !last.secondary;
      state.triggerPressed = state.trigger > PRESS_THRESHOLD && last.trigger <= PRESS_THRESHOLD;
      state.gripPressed = state.grip > PRESS_THRESHOLD && last.grip <= PRESS_THRESHOLD;
    }
  }

  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min((now - previousTime) / 1000, 0.05);
    previousTime = now;
    pollInput();
    if (!input.presenting) controls.update();
    frameHandler?.(dt, input);
    renderer.render(scene, camera);
  });

  renderer.xr.addEventListener("sessionstart", () => {
    controls.enabled = false;
    resetPlayer();
    emit("xr:sessionstart");
  });
  renderer.xr.addEventListener("sessionend", () => {
    controls.enabled = true;
    resetPlayer();
    resize();
    emit("xr:sessionend");
  });

  function resetPlayer() {
    player.position.set(0, 0, 0);
    player.rotation.set(0, 0, 0);
  }

  async function isVRSupported() {
    try {
      return !!navigator.xr && (await navigator.xr.isSessionSupported("immersive-vr"));
    } catch {
      return false;
    }
  }

  return {
    renderer,
    scene,
    camera,
    player,
    content,
    controls,
    controllers,
    input,
    isVRSupported,
    isPresenting: () => renderer.xr.isPresenting,

    /** 사용자 제스처(클릭) 안에서 호출한다. */
    async enterVR() {
      if (renderer.xr.isPresenting) return;
      if (!navigator.xr) throw new Error("이 브라우저는 WebXR을 지원하지 않습니다.");
      const session = await navigator.xr.requestSession("immersive-vr", {
        optionalFeatures: ["local-floor", "bounded-floor", "hand-tracking", "layers"],
      });
      await renderer.xr.setSession(session);
    },

    async exitVR() {
      const session = renderer.xr.getSession();
      if (session) await session.end();
    },

    resetPlayer,

    /** 매 프레임 호출될 함수(앱이 하나만 등록한다). */
    setFrameHandler(fn) {
      frameHandler = fn;
    },
  };
}
