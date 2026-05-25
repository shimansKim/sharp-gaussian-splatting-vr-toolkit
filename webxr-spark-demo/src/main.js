import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { VRButton } from "three/examples/jsm/webxr/VRButton.js";
import "./styles.css";

const statusEl = document.querySelector("#status");
const selectEl = document.querySelector("#splatSelect");
const prevButton = document.querySelector("#prevSplat");
const nextButton = document.querySelector("#nextSplat");
const params = new URLSearchParams(window.location.search);
const pathModes = new Set(window.location.pathname.toLowerCase().split("/").filter(Boolean));
const isQuestBrowser = /Quest|OculusBrowser|Meta Quest/i.test(navigator.userAgent);
const qualityMode = params.has("quality") || pathModes.has("quality");
const questMode = params.has("quest") || pathModes.has("quest");
const safeMode =
  params.has("safe") ||
  pathModes.has("safe") ||
  (isQuestBrowser && !qualityMode && !questMode && !params.has("lite") && !pathModes.has("lite"));
const liteMode = params.has("lite") || pathModes.has("lite") || questMode;
const noSplatMode = params.has("nosplat") || pathModes.has("nosplat");
const basicMode = params.has("basic") || pathModes.has("basic");
const useSpark = !noSplatMode && !basicMode;
let SparkRenderer = null;
let SplatMesh = null;

if (useSpark) {
  ({ SparkRenderer, SplatMesh } = await import("@sparkjsdev/spark"));
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x11161a);

const camera = new THREE.PerspectiveCamera(
  65,
  window.innerWidth / window.innerHeight,
  0.001,
  1000,
);
camera.position.set(0, 0, 2.2);

const renderer = new THREE.WebGLRenderer({
  antialias: false,
  alpha: false,
  powerPreference: "high-performance",
  precision: questMode ? "mediump" : "highp",
});
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x11161a, 1);
renderer.setPixelRatio(questMode ? 0.85 : liteMode ? 1 : safeMode ? 1.1 : Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.minDistance = 0.2;
controls.maxDistance = 8;

const player = new THREE.Group();
player.add(camera);
scene.add(player);

const xrInputState = {
  left: { x: 0, y: 0, trigger: 0, grip: 0, primary: false, secondary: false },
  right: { x: 0, y: 0, trigger: 0, grip: 0, primary: false, secondary: false },
};
const previousButtons = {
  leftPrimary: false,
  rightPrimary: false,
};

const initialPlayerPosition = new THREE.Vector3(0, 0, 0);
const moveSpeed = 0.75;
const verticalSpeed = 0.55;
const turnSpeed = 1.35;
const zoomSpeed = 1.6;
const deadzone = 0.16;
let previousTime = performance.now();
let splats = [{ name: "sharp-output", url: "/splats/sharp-output.ply" }];
let activeIndex = 0;

const spark = useSpark
  ? new SparkRenderer({
      renderer,
      focalAdjustment: questMode ? 1.0 : liteMode ? 1.15 : safeMode ? 2.0 : 2.0,
      maxStdDev: questMode ? Math.sqrt(2.2) : liteMode ? Math.sqrt(3) : safeMode ? Math.sqrt(5.5) : Math.sqrt(6),
      minAlpha: questMode ? 8 / 255 : liteMode ? 4 / 255 : safeMode ? 2 / 255 : 1 / 255,
      maxPixelRadius: questMode ? 28 : liteMode ? 56 : safeMode ? 160 : 256,
      minPixelRadius: questMode ? 1 : liteMode ? 0.5 : safeMode ? 0.05 : 0,
      sortRadial: true,
      minSortIntervalMs: questMode ? 180 : liteMode ? 120 : 0,
      enableLod: questMode || liteMode,
      lodSplatScale: questMode ? 0.45 : liteMode ? 0.8 : 1,
      lodRenderScale: questMode ? 3.0 : liteMode ? 2.4 : 1,
      lodInflate: false,
      coneFov0: questMode ? 8 : safeMode ? 18 : 90,
      coneFov: questMode ? 46 : safeMode ? 72 : 120,
      coneFoveate: questMode ? 0.92 : safeMode ? 0.82 : 0.4,
      behindFoveate: questMode ? 0.02 : safeMode ? 0.08 : 0.2,
    })
  : null;
if (spark) {
  scene.add(spark);
}

const grid = new THREE.GridHelper(4, 16, 0x42606a, 0x26343a);
grid.position.y = -1.25;
scene.add(grid);

const diagnosticGroup = new THREE.Group();
diagnosticGroup.visible = noSplatMode || basicMode || params.has("diag");
const diagnosticCube = new THREE.Mesh(
  new THREE.BoxGeometry(0.28, 0.28, 0.28),
  new THREE.MeshBasicMaterial({ color: 0x24ff7a }),
);
diagnosticCube.position.set(0, 0, -1.4);
diagnosticGroup.add(diagnosticCube);
const diagnosticLeft = new THREE.Mesh(
  new THREE.BoxGeometry(0.16, 0.16, 0.16),
  new THREE.MeshBasicMaterial({ color: 0xff405c }),
);
diagnosticLeft.position.set(-0.55, 0, -1.45);
diagnosticGroup.add(diagnosticLeft);
const diagnosticRight = new THREE.Mesh(
  new THREE.BoxGeometry(0.16, 0.16, 0.16),
  new THREE.MeshBasicMaterial({ color: 0x3a8cff }),
);
diagnosticRight.position.set(0.55, 0, -1.45);
diagnosticGroup.add(diagnosticRight);
const diagnosticLine = new THREE.Line(
  new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-0.8, -0.35, -1.5),
    new THREE.Vector3(0.8, -0.35, -1.5),
  ]),
  new THREE.LineBasicMaterial({ color: 0xffffff }),
);
diagnosticGroup.add(diagnosticLine);
player.add(diagnosticGroup);

let splat = null;

statusEl.textContent = noSplatMode
  ? "Diagnostic mode: splat disabled."
  : basicMode
  ? "Basic mode: Spark disabled."
  : questMode
  ? "Quest mode: ultra-low pressure splat rendering."
  : liteMode
    ? "Lite mode: lowest pressure Quest rendering."
    : safeMode
    ? "Safe quality mode: quality rendering with light Quest caps."
    : "Splat requested. Add ?safe if Quest shows artifacts.";

initializeSplatList();

renderer.setAnimationLoop(() => {
  const now = performance.now();
  const deltaSeconds = Math.min((now - previousTime) / 1000, 0.05);
  previousTime = now;

  controls.update();
  updateVrControls(deltaSeconds);
  renderer.render(scene, camera);
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

window.addEventListener("keydown", (event) => {
  if (event.key === "r") {
    splat?.rotation && (splat.rotation.y += Math.PI / 8);
  }
  if (event.key === "ArrowLeft" || event.key === "[") {
    showPreviousSplat();
  }
  if (event.key === "ArrowRight" || event.key === "]") {
    showNextSplat();
  }
  if (event.key === "=" || event.key === "+") {
    splat?.scale.multiplyScalar(1.1);
  }
  if (event.key === "-") {
    splat?.scale.multiplyScalar(0.9);
  }
});

function axisWithDeadzone(value) {
  return Math.abs(value) > deadzone ? value : 0;
}

function updateControllerState() {
  xrInputState.left.x = 0;
  xrInputState.left.y = 0;
  xrInputState.left.trigger = 0;
  xrInputState.left.grip = 0;
  xrInputState.left.primary = false;
  xrInputState.left.secondary = false;
  xrInputState.right.x = 0;
  xrInputState.right.y = 0;
  xrInputState.right.trigger = 0;
  xrInputState.right.grip = 0;
  xrInputState.right.primary = false;
  xrInputState.right.secondary = false;

  const session = renderer.xr.getSession();
  if (!session) {
    return;
  }

  for (const source of session.inputSources) {
    if (!source.gamepad || source.handedness === "none") {
      continue;
    }

    const state = source.handedness === "left" ? xrInputState.left : xrInputState.right;
    const axes = source.gamepad.axes;
    if (axes.length >= 4) {
      state.x = axisWithDeadzone(axes[2]);
      state.y = axisWithDeadzone(axes[3]);
    }
    state.trigger = source.gamepad.buttons[0]?.value ?? 0;
    state.grip = source.gamepad.buttons[1]?.value ?? 0;
    state.primary = source.gamepad.buttons[4]?.pressed ?? false;
    state.secondary = source.gamepad.buttons[5]?.pressed ?? false;
  }
}

function updateVrControls(deltaSeconds) {
  if (!renderer.xr.isPresenting) {
    return;
  }

  updateControllerState();

  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0;
  if (forward.lengthSq() < 0.001) {
    forward.set(0, 0, -1);
  } else {
    forward.normalize();
  }
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

  player.position.addScaledVector(right, xrInputState.left.x * moveSpeed * deltaSeconds);
  player.position.addScaledVector(forward, -xrInputState.left.y * moveSpeed * deltaSeconds);

  const verticalInput = xrInputState.right.grip - xrInputState.left.grip;
  player.position.y += verticalInput * verticalSpeed * deltaSeconds;

  player.rotation.y -= xrInputState.right.x * turnSpeed * deltaSeconds;

  const zoomInput = xrInputState.right.trigger - xrInputState.left.trigger;
  player.position.addScaledVector(forward, zoomInput * zoomSpeed * deltaSeconds);

  if (xrInputState.left.primary && !previousButtons.leftPrimary) {
    showPreviousSplat();
  }
  if (xrInputState.right.primary && !previousButtons.rightPrimary) {
    showNextSplat();
  }
  previousButtons.leftPrimary = xrInputState.left.primary;
  previousButtons.rightPrimary = xrInputState.right.primary;
}

renderer.xr.addEventListener("sessionstart", () => {
  controls.enabled = false;
  player.position.copy(initialPlayerPosition);
  player.rotation.set(0, 0, 0);
});

renderer.xr.addEventListener("sessionend", () => {
  controls.enabled = true;
});

async function initializeSplatList() {
  if (!useSpark) {
    selectEl.disabled = true;
    prevButton.disabled = true;
    nextButton.disabled = true;
    return;
  }

  try {
    const response = await fetch("/splats/manifest.json", { cache: "no-store" });
    if (response.ok) {
      const manifest = await response.json();
      if (Array.isArray(manifest) && manifest.length > 0) {
        splats = manifest;
      }
    }
  } catch (error) {
    console.warn("Could not load splat manifest. Falling back to sharp-output.ply.", error);
  }

  const requested = params.get("splat");
  activeIndex = Math.max(0, splats.findIndex((item) => item.name === requested || item.url === requested));
  if (activeIndex < 0) {
    activeIndex = 0;
  }

  selectEl.innerHTML = "";
  splats.forEach((item, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = `${index + 1}. ${item.name}`;
    selectEl.appendChild(option);
  });

  selectEl.addEventListener("change", () => loadSplat(Number(selectEl.value)));
  prevButton.addEventListener("click", showPreviousSplat);
  nextButton.addEventListener("click", showNextSplat);

  loadSplat(activeIndex);
}

function showPreviousSplat() {
  if (splats.length <= 1) return;
  loadSplat((activeIndex - 1 + splats.length) % splats.length);
}

function showNextSplat() {
  if (splats.length <= 1) return;
  loadSplat((activeIndex + 1) % splats.length);
}

function loadSplat(index) {
  if (!useSpark || !Number.isFinite(index)) {
    return;
  }

  activeIndex = Math.max(0, Math.min(splats.length - 1, index));

  if (splat) {
    scene.remove(splat);
    splat.dispose?.();
  }

  const item = splats[activeIndex];
  splat = new SplatMesh({
    url: item.url,
    enableLod: questMode || liteMode,
    lod: questMode || liteMode ? "quality" : false,
    lodScale: questMode ? 0.3 : liteMode ? 0.55 : 1,
    coneFov0: questMode ? 8 : safeMode ? 18 : 90,
    coneFov: questMode ? 46 : safeMode ? 72 : 120,
    coneFoveate: questMode ? 0.92 : safeMode ? 0.82 : 0.4,
    behindFoveate: questMode ? 0.02 : safeMode ? 0.08 : 0.2,
    onLoad: () => {
      statusEl.textContent = `${activeIndex + 1}/${splats.length} ${item.name}`;
    },
  });
  splat.position.set(0, -0.2, -1.6);
  splat.quaternion.set(1, 0, 0, 0);
  splat.scale.setScalar(1);
  scene.add(splat);
  selectEl.value = String(activeIndex);
  statusEl.textContent = `Loading ${activeIndex + 1}/${splats.length} ${item.name}...`;
}
