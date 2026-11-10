// 2D 화면: 헤더(VR 진입), 소스 탭, 파일 목록, 보관·삭제, 설정(품질 프리셋·저장 용량).
// 큰 글자·큰 버튼 위주(Quest 브라우저에서 레이로 누르기 쉽게).

import { on } from "../core/events.js";
import { formatBytes } from "../core/kinds.js";
import { listSources } from "../core/registry.js";
import { storageEstimate } from "../core/store.js";
import { PRESET_CHOICES } from "../viewers/splat/quest-presets.js";

const KIND_LABEL = { splat: "PLY", video: "영상", image: "사진" };

/**
 * @param {{
 *   root: HTMLElement,
 *   library: ReturnType<typeof import('../core/library.js').createLibrary>,
 *   pickFiles: () => Promise<File[]>,
 *   addFiles: (files: File[]) => Promise<void>,
 *   keepItem: (item: import('../core/types.js').LibraryItem) => Promise<void>,
 *   removeItem: (item: import('../core/types.js').LibraryItem) => Promise<void>,
 *   presetValue: string,
 *   setPreset: (value: string) => void,
 *   presetLabel: string,
 * }} options
 */
export function createAppShell({ root, library, pickFiles, addFiles, keepItem, removeItem, presetValue, setPreset, presetLabel }) {
  root.innerHTML = `
    <div class="layout">
      <aside class="sidebar" id="sidebar">
        <header class="top">
          <h1>SHARP 뷰어</h1>
          <button class="btn primary" id="btn-vr" type="button" disabled>VR 보기</button>
        </header>
        <p class="status" id="status" role="status">PLY·영상·사진 파일을 열어 보세요.</p>
        <div class="actions">
          <button class="btn" id="btn-pick" type="button">기기에서 파일 열기</button>
        </div>
        <nav class="tabs" id="tabs" role="tablist"></nav>
        <div class="source-panel" id="source-panel"></div>
        <ul class="list" id="list"></ul>
        <details class="settings" id="settings">
          <summary>설정</summary>
          <label class="field">
            <span>그래픽 품질 (바꾸면 앱이 다시 시작됩니다)</span>
            <select id="preset"></select>
          </label>
          <p class="muted" id="storage"></p>
        </details>
      </aside>
      <main class="stage" id="stage">
        <button class="btn fold" id="btn-fold" type="button" aria-label="목록 접기/펼치기">☰</button>
        <div class="drop-hint" id="drop-hint">PLY·영상·사진 파일을 여기로 끌어다 놓아도 됩니다</div>
      </main>
    </div>
  `;

  const $ = (selector) => /** @type {HTMLElement} */ (root.querySelector(selector));
  const statusEl = $("#status");
  const listEl = $("#list");
  const tabsEl = $("#tabs");
  const panelEl = $("#source-panel");
  /** @type {Map<string, (container: HTMLElement) => void>} */
  const sourcePanels = new Map();
  const vrButton = /** @type {HTMLButtonElement} */ ($("#btn-vr"));
  const presetSelect = /** @type {HTMLSelectElement} */ ($("#preset"));
  const stageEl = $("#stage");
  const hintEl = $("#drop-hint");

  const setStatus = (text, kind = "") => {
    statusEl.textContent = text;
    statusEl.dataset.kind = kind;
  };

  // ---- VR 버튼 ---- (무대는 이 화면의 stageEl 안에 만들어지므로 bindStage로 나중에 연결한다)
  /** @param {ReturnType<typeof import('../core/xr-stage.js').createXrStage>} stage */
  function bindStage(stage) {
    stage.isVRSupported().then((supported) => {
      vrButton.disabled = !supported;
      if (!supported) vrButton.textContent = "VR 사용 불가";
    });
    vrButton.addEventListener("click", async () => {
      try {
        await stage.enterVR();
      } catch (error) {
        setStatus(`VR을 시작하지 못했습니다: ${error.message ?? error}`, "error");
      }
    });
  }
  on("xr:sessionstart", () => (vrButton.textContent = "VR 보는 중"));
  on("xr:sessionend", () => (vrButton.textContent = "VR 보기"));

  // ---- 파일 열기 ----
  $("#btn-pick").addEventListener("click", async () => {
    const files = await pickFiles();
    if (files.length) await addFiles(files);
  });

  for (const type of ["dragenter", "dragover"]) {
    stageEl.addEventListener(type, (event) => {
      event.preventDefault();
      hintEl.classList.add("active");
    });
  }
  for (const type of ["dragleave", "drop"]) {
    stageEl.addEventListener(type, () => hintEl.classList.remove("active"));
  }
  stageEl.addEventListener("drop", async (event) => {
    event.preventDefault();
    const files = [...(event.dataTransfer?.files ?? [])];
    if (files.length) await addFiles(files);
  });

  $("#btn-fold").addEventListener("click", () => root.querySelector(".layout").classList.toggle("folded"));

  // ---- 소스 탭 ----
  function renderTabs() {
    tabsEl.innerHTML = "";
    for (const source of listSources()) {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.role = "tab";
      tab.className = "tab";
      tab.textContent = source.label;
      tab.setAttribute("aria-selected", String(source.id === library.listSourceId));
      tab.addEventListener("click", () => library.setListSource(source.id));
      tabsEl.appendChild(tab);
    }
  }

  // ---- 목록 ----
  function renderList() {
    renderTabs();
    // 소스별 전용 패널(예: PC 연결 상태). 이 탭이 선택됐을 때만 보인다.
    panelEl.innerHTML = "";
    const renderPanel = sourcePanels.get(library.listSourceId);
    panelEl.hidden = !renderPanel;
    renderPanel?.(panelEl);
    listEl.innerHTML = "";
    const items = library.items;
    const sourceId = library.listSourceId;
    if (!items.length) {
      const empty = document.createElement("li");
      empty.className = "empty";
      empty.textContent =
        sourceId === "session"
          ? "아직 연 파일이 없습니다. [기기에서 파일 열기]를 눌러 Quest 저장소의 .ply를 고르세요."
          : sourceId === "library"
            ? "보관함이 비어 있습니다. 파일을 연 뒤 [보관]을 누르면 앱에 저장됩니다."
            : "표시할 파일이 없습니다.";
      listEl.appendChild(empty);
      return;
    }

    for (const item of items) {
      const li = document.createElement("li");
      const isCurrent = library.current?.id === item.id;
      li.className = `row${isCurrent ? " current" : ""}`;

      const open = document.createElement("button");
      open.type = "button";
      open.className = "open";
      open.disabled = !library.canOpen(item);
      open.innerHTML = `<span class="kind k-${item.kind}"></span><span class="name"></span><span class="meta"></span>`;
      open.querySelector(".kind").textContent = KIND_LABEL[item.kind] ?? item.kind;
      open.querySelector(".name").textContent = item.name;
      open.querySelector(".meta").textContent = library.canOpen(item)
        ? formatBytes(item.size ?? NaN)
        : `${formatBytes(item.size ?? NaN)} · 뷰어 준비 중`;
      open.addEventListener("click", () => library.open(item));
      li.appendChild(open);

      const side = document.createElement("div");
      side.className = "row-actions";
      if (sourceId === "library") {
        side.appendChild(smallButton("삭제", () => removeItem(item)));
      } else {
        side.appendChild(smallButton("보관", () => keepItem(item)));
      }
      li.appendChild(side);
      listEl.appendChild(li);
    }
  }

  function smallButton(label, run) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn small";
    button.textContent = label;
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await run();
      } finally {
        button.disabled = false;
      }
    });
    return button;
  }

  on("library:changed", renderList);
  on("item:loading", ({ item }) => {
    setStatus(`불러오는 중… ${item.name}`);
    renderList();
  });
  on("item:opened", ({ item }) => {
    const index = library.playlist.findIndex((entry) => entry.id === item.id);
    const position = library.playlist.length > 1 ? `${index + 1}/${library.playlist.length} ` : "";
    setStatus(`${position}${item.name}`);
    hintEl.classList.add("hidden");
    renderList();
  });
  on("item:error", ({ item, error }) => {
    setStatus(`열지 못했습니다 (${item.name}): ${error?.message ?? error}`, "error");
    renderList();
  });
  on("item:closed", () => {
    setStatus("PLY·영상·사진 파일을 열어 보세요.");
    hintEl.classList.remove("hidden");
    renderList();
  });
  on("app:status", ({ text, kind }) => setStatus(text, kind));

  // ---- 설정 ----
  for (const choice of PRESET_CHOICES) {
    const option = document.createElement("option");
    option.value = choice.value;
    option.textContent = choice.label;
    presetSelect.appendChild(option);
  }
  if (![...presetSelect.options].some((option) => option.value === presetValue)) {
    const option = document.createElement("option");
    option.value = presetValue;
    option.textContent = presetLabel;
    presetSelect.appendChild(option);
  }
  presetSelect.value = presetValue;
  presetSelect.addEventListener("change", () => setPreset(presetSelect.value));

  async function refreshStorage() {
    const estimate = await storageEstimate();
    $("#storage").textContent = estimate
      ? `앱 저장 공간: ${formatBytes(estimate.usage)} 사용 / ${formatBytes(estimate.quota)} 가능${estimate.persisted ? " (자동 삭제 방지됨)" : ""}`
      : "";
  }
  $("#settings").addEventListener("toggle", refreshStorage);
  on("library:stored", refreshStorage);

  renderList();
  return {
    stageEl,
    bindStage,
    setStatus,
    renderList,
    /** 소스 탭에 전용 패널을 붙인다. 탭이 선택될 때마다 render(container)가 불린다. (sync-dev: createPcPanel) */
    setSourcePanel(sourceId, render) {
      sourcePanels.set(sourceId, render);
      renderList();
    },
  };
}
