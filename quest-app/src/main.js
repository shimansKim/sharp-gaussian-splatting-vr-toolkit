// 앱 진입점: 무대·목록·소스·뷰어를 만들어 연결한다.
// 다른 모듈(media-dev의 미디어 뷰어, sync-dev의 PC·드라이브 소스)은 아래 "등록" 구역에 팩토리를 추가한다.
import "./ui/styles.css";
import { Raycaster, Vector2 } from "three";
import { BASE_URL, GDRIVE, STORE_BUILD } from "./config.js";
import { emit, on } from "./core/events.js";
import { keepBlocker } from "./core/keep-check.js";
import { formatBytes } from "./core/kinds.js";
import { createActionTracker, createFlick, mediaStickValues } from "./core/input-map.js";
import { createLibrary } from "./core/library.js";
import { createNavHistory } from "./core/nav-history.js";
import { installUpdateGuard } from "./core/update-guard.js";
import { createSourceMemory, isVrLaunch, startVrLaunch } from "./core/vr-launch.js";
import { getSource, registerSource, registerViewer, setPrefetchLimit } from "./core/registry.js";
import { createEndWatch, createSlideshow } from "./core/slideshow.js";
import { storageEstimate } from "./core/store.js";
import { createXrStage, emptyInput } from "./core/xr-stage.js";
import { createLibrarySource, createSessionSource, pickDeviceFiles } from "./sources/device-source.js";
import { createGdriveSource } from "./sources/gdrive-source.js";
import { createPcSource } from "./sources/pc-source.js";
import { createAppShell } from "./ui/app-shell.js";
import { createBindingsPanel } from "./ui/bindings-panel.js";
import { bindings } from "./core/bindings.js";
import { createBindingsSync } from "./core/bindings-sync.js";
import { createGdrivePanel } from "./ui/gdrive-panel.js";
import { createLicensesPanel } from "./ui/licenses-panel.js";
import { createNavBar } from "./ui/nav-bar.js";
import { createPcPanel } from "./ui/pc-panel.js";
import { createVrPanel } from "./ui/vr-panel.js";
import { createUiControls } from "./ui/ui-controls.js";
import { ui } from "./core/ui-state.js";
import { createMediaViewer } from "./viewers/media/media-viewer.js";
import { getSplatPreset, resolvePresetChoice } from "./viewers/splat/quest-presets.js";
import { createSplatViewer } from "./viewers/splat/splat-viewer.js";

const PRESET_KEY = "sharp-quest.preset";

function loadSavedPreset() {
  try {
    const [mode, level] = (localStorage.getItem(PRESET_KEY) ?? "").split(":");
    return mode ? { mode, level: Number(level) } : null;
  } catch {
    return null;
  }
}

const choice = resolvePresetChoice({ search: location.search, userAgent: navigator.userAgent, saved: loadSavedPreset() });
const preset = getSplatPreset(choice);
const presetValue = `${choice.mode}:${choice.level}`;

// ---- 소스·뷰어 ----
const session = createSessionSource();
const keptLibrary = createLibrarySource();
const library = createLibrary();
const slideshow = createSlideshow({ library });
const splatViewer = createSplatViewer({ preset, savePreset: (value) => savePreset(value) });
const mediaViewer = createMediaViewer();
// 스토어판은 터널 모드(https 터널 주소)를 뺀다: 같은 Wi-Fi의 PC만 찾는다.
const pcSource = createPcSource({ connectionOptions: { allowTunnel: !STORE_BUILD } });
const gdriveSource = createGdriveSource({ config: GDRIVE });

registerSource(session);
registerSource(keptLibrary);
registerSource(pcSource);
registerSource(gdriveSource);
registerViewer(splatViewer);
registerViewer(mediaViewer);
// 다음 파일 미리 받기 한도(원격 소스의 PLY·사진만, 한 번에 한 항목). 메모리가 모자라면 여기 값을 줄인다(0이면 끔).
setPrefetchLimit("splat", 120 * 1024 * 1024);
setPrefetchLimit("image", 48 * 1024 * 1024);
// 등록: sync-dev   → PC·드라이브 소스는 위에서 등록, 패널은 shell 생성 뒤에 붙인다

// ---- 동작 ----
const status = (text, kind = "") => emit("app:status", { text, kind });

async function addFiles(files) {
  const { added, skipped } = session.addFiles(files);
  if (skipped.length) status(`지원하지 않는 파일은 건너뛰었습니다: ${skipped.slice(0, 3).join(", ")}${skipped.length > 3 ? " 외" : ""}`, "warn");
  await library.refresh("session");
  const first = added.find((item) => library.canOpen(item));
  if (first) await library.open(first, { playlist: library.items });
  else if (added.length) status("열 수 있는 뷰어가 아직 없는 형식입니다.", "warn");
}

async function keepItem(item) {
  try {
    // 보관은 파일 전체를 앱 저장소로 복사한다. 영상·사진은 보관 없이 스트리밍으로 열리므로, 공간이 모자라면 시작 전에 알린다.
    const blocker = keepBlocker(item, await storageEstimate());
    if (blocker) {
      status(blocker, "warn");
      return;
    }
    const source = getSource(item.sourceId);
    const opened = await source.open(item);
    try {
      status(`보관 중… ${item.name}`);
      await keptLibrary.keep(item, opened, (written) => {
        status(`보관 중… ${item.name} (${formatBytes(written)}${item.size ? ` / ${formatBytes(item.size)}` : ""})`);
      });
    } finally {
      opened.release();
    }
    status(`보관했습니다: ${item.name}`, "ok");
    emit("library:stored");
    if (library.listSourceId === "library") await library.refresh();
  } catch (error) {
    console.error(error);
    status(`보관하지 못했습니다 (${item.name}): ${error?.message ?? error}`, "error");
  }
}

async function removeItem(item) {
  try {
    if (library.current?.id === item.id) library.close();
    await keptLibrary.remove(item);
    emit("library:stored");
    await library.refresh("library");
    status(`삭제했습니다: ${item.name}`);
  } catch (error) {
    console.error(error);
    status(`삭제하지 못했습니다: ${error?.message ?? error}`, "error");
  }
}

/** 화질 선택을 저장만 한다(다시 불러오지 않음). VR 패널에서 바꿀 때도 쓴다. */
function savePreset(value) {
  try {
    localStorage.setItem(PRESET_KEY, value);
  } catch {
    /* 저장이 막힌 환경이면 이번 실행에만 적용 */
  }
}

function setPreset(value) {
  savePreset(value);
  const url = new URL(location.href);
  for (const key of ["safe", "lite", "quest", "quality"]) url.searchParams.delete(key);
  location.replace(url);
}

const shell = createAppShell({
  root: document.querySelector("#app"),
  library,
  pickFiles: () => pickDeviceFiles(),
  addFiles,
  keepItem,
  removeItem,
  presetValue,
  presetLabel: preset.label,
  setPreset,
});

// [설정] > 컨트롤러 버튼 지정: 동작마다 버튼·스틱을 고르는 창(ui/bindings-panel.js). app-shell을 건드리지 않고 설정 칸 끝에 버튼만 붙인다.
// PC에 연결되면 PC 서버의 배정(/api/bindings)과 맞춘다: 나중에 바꾼 쪽이 이긴다(core/bindings-sync.js).
// 이 기기에서 바꾼 배정이 PC의 더 최근 배정에 밀려 버려지면(409) 상태줄만이 아니라 눈에 띄게 알린다:
// 2D 상태줄(경고)·VR 공용 패널 안내 줄·영상/사진 재생 컨트롤 안내(보이는 중이면). 설정창에도 경고 줄이 남는다.
const BINDINGS_DISCARDED_SHORT = "버튼 배정: PC에서 더 최근에 바꾼 배정으로 바뀌었습니다(이 기기 변경은 버림). 설정 > 컨트롤러 버튼 지정에서 확인하세요.";
const bindingsSync = createBindingsSync({
  store: bindings,
  connection: pcSource.connection,
  onDiscard: () => {
    status(BINDINGS_DISCARDED_SHORT, "warn");
    panel?.showMessage(BINDINGS_DISCARDED_SHORT);
    if (library.activeViewer === mediaViewer) mediaViewer.flashHint?.(BINDINGS_DISCARDED_SHORT, 8000);
  },
});
const bindingsPanel = createBindingsPanel({ sync: bindingsSync });
{
  const button = document.createElement("button");
  button.className = "btn";
  button.type = "button";
  button.id = "btn-bindings";
  button.textContent = "컨트롤러 버튼 지정";
  button.addEventListener("click", () => bindingsPanel.open());
  document.querySelector("#settings")?.append(button);
}

// [설정] > 오픈소스 라이선스: three.js·Spark 등 앱에 들어 있는 오픈소스의 라이선스 전문(ui/licenses-panel.js).
const licensesPanel = createLicensesPanel();
{
  const button = document.createElement("button");
  button.className = "btn";
  button.type = "button";
  button.id = "btn-licenses";
  button.textContent = "오픈소스 라이선스";
  button.addEventListener("click", () => licensesPanel.open());
  document.querySelector("#settings")?.append(button);
}

// [PC] 탭: 연결 상태·안내 패널. 탭을 누르면 목록 요청이 연결을 시도하고, 패널의 버튼으로도 다시 연결한다.
const pcPanel = createPcPanel({ source: pcSource, onConnected: () => library.refresh("pc") });
shell.setSourcePanel("pc", (container) => container.append(pcPanel.element));

// [드라이브] 탭: 설정이 비어 있으면 고장이 아니라 안내만 보여 준다(설정 안내: notes/quest-gdrive-setup-ko.md).
const GDRIVE_GUIDE_URL = "https://github.com/shimansKim/sharp-gaussian-splatting-vr-toolkit/blob/quest-app/notes/quest-gdrive-setup-ko.md";
const gdrivePanel = createGdrivePanel({ source: gdriveSource, setupGuideUrl: GDRIVE_GUIDE_URL, onChange: () => library.refresh("gdrive") });
shell.setSourcePanel("gdrive", (container) => container.append(gdrivePanel.element));

// 2D 이동 바(이전·다음·슬라이드쇼)는 무대 위에 겹쳐 둔다.
shell.stageEl.append(createNavBar({ library, slideshow }).element);

const stage = createXrStage({ container: shell.stageEl, pixelRatio: preset.pixelRatio, precision: preset.precision });
shell.bindStage(stage);
splatViewer.mount(stage);
mediaViewer.mount(stage);

// 사용자가 바꾼 영상·사진 형식은 보관함 항목에만 기억한다(다른 소스는 세션 동안만 유지).
mediaViewer.addEventListener("layoutchange", (event) => {
  const { itemId, layout, auto } = event.detail;
  if (auto) return; // 프레임 내용으로 고친 자동 판별은 기억하지 않는다(사람이 고른 것만 기억).
  if (typeof itemId === "string" && itemId.startsWith("library:")) keptLibrary.update(itemId, { layout }).catch((error) => console.error(error));
});
// 코덱·해상도 경고는 load() 안에서 나오는데, 곧이어 목록이 "열었습니다" 문구로 덮어쓴다. 열기가 끝난 뒤에 다시 보여 준다.
let pendingWarning = null;
mediaViewer.addEventListener("warning", (event) => {
  pendingWarning = { text: event.detail.text, kind: event.detail.level === "error" ? "error" : "warn" };
  status(pendingWarning.text, pendingWarning.kind);
});
on("item:opened", () => {
  if (!pendingWarning) return;
  status(pendingWarning.text, pendingWarning.kind);
  pendingWarning = null;
});
on("item:loading", () => {
  pendingWarning = null;
});
mediaViewer.addEventListener("error", (event) => status(event.detail.message, "error"));
// PC·드라이브 영상은 받아 두지 않고 바로 재생(스트리밍)하므로 네트워크가 느리면 잠시 멈춘다. 그때 알려 준다.
// 버퍼링이 끝나면 그 직전 문구(예: "2/5 이름", 코덱 경고)를 그대로 되돌린다.
let beforeBuffering = null;
mediaViewer.addEventListener("buffering", (event) => {
  const statusEl = document.querySelector("#status");
  if (event.detail.buffering) {
    beforeBuffering = { text: statusEl?.textContent ?? "", kind: statusEl?.dataset.kind ?? "" };
    status(`버퍼링 중… ${library.current?.name ?? ""}`);
  } else if (beforeBuffering) {
    status(beforeBuffering.text, beforeBuffering.kind);
    beforeBuffering = null;
  }
});

// 데스크톱 확인용: 화면의 재생 패널을 마우스로 누르고, 스페이스·L·F로 재생·형식·정면 맞춤을 조작한다.
const mouseRay = new Raycaster();
const toNdc = (event) => {
  const rect = stage.renderer.domElement.getBoundingClientRect();
  return new Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -(((event.clientY - rect.top) / rect.height) * 2 - 1));
};
const canvasEl = stage.renderer.domElement;
canvasEl.addEventListener("pointermove", (event) => {
  if (stage.isPresenting() || !library.current) return;
  mouseRay.setFromCamera(toNdc(event), stage.camera);
  mediaViewer.setMousePointer(mouseRay, event.buttons === 1);
});
canvasEl.addEventListener("pointerdown", (event) => {
  if (stage.isPresenting() || !library.current || event.button !== 0) return;
  mouseRay.setFromCamera(toNdc(event), stage.camera);
  mediaViewer.setMousePointer(mouseRay, true);
});
canvasEl.addEventListener("pointerup", (event) => {
  if (stage.isPresenting() || !library.current) return;
  mouseRay.setFromCamera(toNdc(event), stage.camera);
  mediaViewer.setMousePointer(mouseRay, false);
});
canvasEl.addEventListener("pointerleave", () => mediaViewer.setMousePointer(null, false));

const panel = createVrPanel({ stage, library, slideshow, getActions: () => library.activeViewer?.panelActions?.() ?? [] });

// 목록에서 사람이 파일을 골랐을 때만(vr-panel의 "list:picked"): 영상·사진 화면을 지금 시선 정면에 놓는다(L3 위치 맞춤과 같은 recenter).
// A/X·스틱으로 넘길 때는 부르지 않아 화면 자리가 그대로다. PLY는 뷰어의 기존 맞춤 동작을 그대로 쓴다.
// 파일 선택창이 보이는 동안(VR 패널의 목록 화면)은 PLY·영상·사진 출력을 멈추고 숨긴다(사람 요청 2026-11-13: 선택창과 화면이 동시에 나오지 않게).
// 모든 뷰어에 알린다: 선택창에서 다른 종류의 파일을 고르면 열리는 뷰어도 선택창이 닫힐 때까지 숨긴 채로 준비한다.
let listSolo = false;
on("list:solo", ({ on: solo }) => {
  listSolo = !!solo;
  for (const viewer of [splatViewer, mediaViewer]) viewer.setSuspended?.(listSolo);
});
// VR을 나오면 2D 미리보기는 늘 보인다(2D는 목록과 미리보기가 나란히 있는 화면).
on("xr:sessionend", () => {
  if (!listSolo) return;
  listSolo = false;
  for (const viewer of [splatViewer, mediaViewer]) viewer.setSuspended?.(false);
});

on("list:picked", () => {
  if (library.activeViewer === mediaViewer) mediaViewer.recenter();
});

// B/Y: 짧게 = 모든 UI 켜기·끄기, 길게 = UI를 지금 보는 곳으로 옮기기(ui/ui-controls.js). UI 자리·켜짐 상태는 core/ui-state.js가 한 곳에서 가진다.
const uiControls = createUiControls({
  ui,
  camera: stage.camera,
  panel,
  viewerHasUi: () => {
    const viewer = library.activeViewer;
    if (!viewer) return false;
    if (viewer === mediaViewer) return !!mediaViewer.hud?.visible;
    return !!viewer.getState?.().helpVisible;
  },
});
// 세션이 시작·끝날 때마다 UI 자리를 비우고 켠 상태로 돌린다(자리는 헤드셋 자세가 들어온 뒤 다시 한 번 잡힌다).
for (const name of ["xr:sessionstart", "xr:sessionend"]) on(name, () => ui.resetForSession());

// 영상·사진 재생 컨트롤의 이동 줄(이전·다음·슬라이드쇼·간격·목록)은 공용 패널과 같은 동작을 쓴다.
function syncMediaNav() {
  const current = library.current;
  const list = library.playlist;
  const index = current ? list.findIndex((entry) => entry.id === current.id) : -1;
  mediaViewer.setNavState({
    navPos: index >= 0 && list.length > 1 ? `${index + 1} / ${list.length}` : "",
    navCanStep: list.length > 1,
    navShow: slideshow.running,
    navInterval: slideshow.interval,
  });
}
for (const name of ["library:changed", "item:opened", "item:loading", "item:error", "item:closed", "slideshow:changed"]) on(name, syncMediaNav);
syncMediaNav();
mediaViewer.addEventListener("nav", (event) => {
  switch (event.detail.id) {
    case "navPrev":
      library.prev();
      break;
    case "navNext":
      library.next();
      break;
    case "navShow":
      slideshow.toggle();
      break;
    case "navInterval":
      slideshow.cycleInterval();
      break;
    case "navList":
      panel.toggle();
      break;
    default:
      break;
  }
});

// 매 프레임: 패널이 열려 있으면 뷰어 입력을 막고, 공통 버튼(기본 X 짧게·길게 = 이전·다음, A = 파일 선택 화면)을 처리한다. 버튼은 배정 표(core/bindings.js)대로 읽는다.
const neutralInput = emptyInput();
/** 공통 버튼 판정을 쉬게 할 때 넘기는 입력(VR 밖처럼 보여 판정기가 눌림 상태를 비운다). */
const blockedInput = emptyInput();
const photoFlick = createFlick();
const commonTracker = createActionTracker(["common.prev", "common.next", "common.openList"]);
const watchVideoEnd = createEndWatch({ isRunning: () => slideshow.running, notify: (id) => slideshow.notifyEnded(id) });
stage.setFrameHandler((dt, input) => {
  ui.tick(stage.camera, input.presenting);
  // VR 패널에서 버튼을 지정하는 중(과 확인 대기·손을 떼기 전)에는 누른 입력이 UI 켜기·끄기나 이전·다음을 실행하지 않게 막는다(ui/vr-bindings-page.js).
  const commonInput = panel.inputBlocked ? blockedInput : input;
  uiControls.update(commonInput);
  const panelOpen = panel.update(input);
  // 공통 버튼: 이전·다음(기본 X 짧게·길게)·파일 선택 화면(기본 A). UI 켜기·끄기·옮기기(기본 B/Y)는 위의 uiControls가 처리한다.
  const common = commonTracker.update(panel.inputBlocked ? blockedInput : commonInput);
  if (common.has("common.prev")) library.prev();
  if (common.has("common.next")) library.next();
  // 파일 선택 화면(기본 A): 목록이 보이는 중이면 닫고, 아니면 연다(UI를 꺼 두었으면 켠다). #59 흐름대로 목록이 보이는 동안 PLY·영상·사진 출력은 멈춘다.
  if (common.has("common.openList")) {
    if (panel.isOpen && panel.page === "list") panel.close();
    else {
      if (!ui.visible) ui.setVisible(true);
      panel.open();
    }
  }
  // 사진: media.scrub 축(기본 오른쪽 스틱 좌우)을 한 번 튕기면 이전·다음(영상은 같은 축이 ±10초라 뷰어가 처리한다).
  if (input.presenting && !panelOpen && library.current?.kind === "image") {
    // 줌과 같은 스틱이면 대각선은 더 크게 민 축 하나만 쓴다(core/input-map.js mediaStickValues).
    const step = photoFlick.update(mediaStickValues(input).scrub);
    if (step > 0) library.next();
    else if (step < 0) library.prev();
  } else {
    photoFlick.reset();
  }
  // 영상이 끝나면 슬라이드쇼가 다음으로 넘긴다(media-viewer를 건드리지 않고 video 요소를 본다).
  watchVideoEnd(library.current, !!mediaViewer.video?.ended);
  const viewer = library.activeViewer;
  if (viewer) viewer.update(dt, panelOpen ? { ...neutralInput, presenting: true } : input);
});

// 뒤로 가기: TWA·브라우저 뒤로 가기가 앱을 끄지 않게 한다. VR 중이면 VR 종료 → 항목을 보는 중이면 목록으로 → 폴더 안이면 상위 폴더 → 목록 최상위에서만 종료.
const navHistory = createNavHistory({
  layers: () => [stage.isPresenting() && "vr", (library.current || library.loading) && "viewer", library.folder && "folder"].filter(Boolean),
  pop: {
    vr: () => stage.exitVR(),
    viewer: () => library.close(),
    folder: () => library.upFolder(),
  },
});
for (const name of ["xr:sessionstart", "xr:sessionend", "item:loading", "item:opened", "item:error", "item:closed", "library:changed"]) on(name, () => navHistory.sync());

// 키보드(PC 확인용): ←/→ 이전·다음
window.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName)) return;
  if (event.key === "ArrowLeft" || event.key === "[") library.prev();
  if (event.key === "ArrowRight" || event.key === "]") library.next();
  if (library.activeViewer === mediaViewer) {
    if (event.key === " ") {
      event.preventDefault();
      if (mediaViewer.item?.kind === "video") mediaViewer.togglePlay();
      else mediaViewer.toggleHud();
    }
    if (event.key === "l" || event.key === "L") mediaViewer.cycleLayout(1);
    if (event.key === "f" || event.key === "F") mediaViewer.recenter();
  }
});

library.refresh("session");

// 새 배포 뒤 옛 화면이 청크를 못 받아 PLY가 안 열리는 문제(failed to fetch dynamically imported module) 방지(core/update-guard.js).
const updateGuard = installUpdateGuard({
  notify: (text) => status(text),
  canReloadNow: () => !stage.isPresenting() && !library.current && !library.loading,
});
for (const name of ["item:closed", "xr:sessionend"]) on(name, () => updateGuard.flush());
if (updateGuard.wasReloaded()) status("새 버전으로 다시 시작했습니다. 파일을 다시 눌러 열어 주세요.", "ok");

// 마지막으로 본 소스 탭을 기억한다(VR 앱이 같은 목록으로 열리도록). 주소가 ?vr=1이면(SHARP VR 앱) 2D 화면 없이 바로 VR로 들어간다(core/vr-launch.js).
const sourceMemory = createSourceMemory();
// "이번에 연 파일"(session)은 VR에서 못 쓰고 앱 시작 때마다 기본으로 켜지므로 기억하지 않는다.
on("library:changed", ({ sourceId }) => sourceId !== "session" && sourceMemory.save(sourceId));
if (isVrLaunch(location.search)) {
  // PC에 한 번도 연결한 적이 없으면 PC 탐색 대신 보관함으로 시작한다(PC 없이도 첫 화면이 바로 쓸 수 있게).
  startVrLaunch({ stage, library, panel, status, memory: sourceMemory, on, fallbackSource: pcSource.connection.hasLastBase() ? "pc" : "library" });
}

// 서비스 워커: 앱 셸 오프라인 캐시(public/sw.js). dev 서버에서는 등록하지 않는다.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    // updateViaCache:"none": sw.js·precache-manifest.js를 HTTP 캐시(Pages max-age=600) 없이 매번 확인해 새 배포를 바로 알아본다.
    navigator.serviceWorker.register(`${BASE_URL}sw.js`, { scope: BASE_URL, updateViaCache: "none" }).catch((error) => {
      console.warn("[sw] 등록 실패(오프라인 캐시 없이 동작)", error);
    });
  });
}

// 개발·검증용 훅(화면에는 보이지 않는다)
window.__sharpQuest = { bindings, stage, library, session, keptLibrary, panel, preset, addFiles, mediaViewer, navHistory, slideshow, ui };
