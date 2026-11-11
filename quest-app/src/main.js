// 앱 진입점: 무대·목록·소스·뷰어를 만들어 연결한다.
// 다른 모듈(media-dev의 미디어 뷰어, sync-dev의 PC·드라이브 소스)은 아래 "등록" 구역에 팩토리를 추가한다.
import "./ui/styles.css";
import { Raycaster, Vector2 } from "three";
import { BASE_URL, GDRIVE } from "./config.js";
import { emit, on } from "./core/events.js";
import { keepBlocker } from "./core/keep-check.js";
import { formatBytes } from "./core/kinds.js";
import { commonActions } from "./core/input-map.js";
import { createLibrary } from "./core/library.js";
import { createNavHistory } from "./core/nav-history.js";
import { getSource, registerSource, registerViewer } from "./core/registry.js";
import { storageEstimate } from "./core/store.js";
import { createXrStage, emptyInput } from "./core/xr-stage.js";
import { createLibrarySource, createSessionSource, pickDeviceFiles } from "./sources/device-source.js";
import { createGdriveSource } from "./sources/gdrive-source.js";
import { createPcSource } from "./sources/pc-source.js";
import { createAppShell } from "./ui/app-shell.js";
import { createGdrivePanel } from "./ui/gdrive-panel.js";
import { createPcPanel } from "./ui/pc-panel.js";
import { createVrPanel } from "./ui/vr-panel.js";
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
const splatViewer = createSplatViewer({ preset });
const mediaViewer = createMediaViewer();
const pcSource = createPcSource();
const gdriveSource = createGdriveSource({ config: GDRIVE });

registerSource(session);
registerSource(keptLibrary);
registerSource(pcSource);
registerSource(gdriveSource);
registerViewer(splatViewer);
registerViewer(mediaViewer);
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

function setPreset(value) {
  try {
    localStorage.setItem(PRESET_KEY, value);
  } catch {
    /* 저장이 막힌 환경이면 이번 실행에만 적용 */
  }
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

// [PC] 탭: 연결 상태·안내 패널. 탭을 누르면 목록 요청이 연결을 시도하고, 패널의 버튼으로도 다시 연결한다.
const pcPanel = createPcPanel({ source: pcSource, onConnected: () => library.refresh("pc") });
shell.setSourcePanel("pc", (container) => container.append(pcPanel.element));

// [드라이브] 탭: 설정이 비어 있으면 고장이 아니라 안내만 보여 준다(설정 안내: notes/quest-gdrive-setup-ko.md).
const GDRIVE_GUIDE_URL = "https://github.com/shimansKim/sharp-gaussian-splatting-vr-toolkit/blob/quest-app/notes/quest-gdrive-setup-ko.md";
const gdrivePanel = createGdrivePanel({ source: gdriveSource, setupGuideUrl: GDRIVE_GUIDE_URL, onChange: () => library.refresh("gdrive") });
shell.setSourcePanel("gdrive", (container) => container.append(gdrivePanel.element));

const stage = createXrStage({ container: shell.stageEl, pixelRatio: preset.pixelRatio, precision: preset.precision });
shell.bindStage(stage);
splatViewer.mount(stage);
mediaViewer.mount(stage);

// 사용자가 바꾼 영상·사진 형식은 보관함 항목에만 기억한다(다른 소스는 세션 동안만 유지).
mediaViewer.addEventListener("layoutchange", (event) => {
  const { itemId, layout } = event.detail;
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

const panel = createVrPanel({ stage, library, getActions: () => library.activeViewer?.panelActions?.() ?? [] });

// 매 프레임: 패널이 열려 있으면 뷰어 입력을 막고, 공통 버튼(X/A 이전·다음)을 처리한다.
const neutralInput = emptyInput();
stage.setFrameHandler((dt, input) => {
  const panelOpen = panel.update(input);
  // 공통 버튼(core/input-map.js): X 이전, A 다음. B/Y 패널은 vr-panel이 처리한다.
  for (const action of commonActions(input)) {
    if (action === "prev") library.prev();
    else if (action === "next") library.next();
  }
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

// 서비스 워커: 앱 셸 오프라인 캐시(public/sw.js). dev 서버에서는 등록하지 않는다.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${BASE_URL}sw.js`, { scope: BASE_URL }).catch((error) => {
      console.warn("[sw] 등록 실패(오프라인 캐시 없이 동작)", error);
    });
  });
}

// 개발·검증용 훅(화면에는 보이지 않는다)
window.__sharpQuest = { stage, library, session, keptLibrary, panel, preset, addFiles, mediaViewer, navHistory };
