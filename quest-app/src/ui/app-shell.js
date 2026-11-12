// 2D 화면: 왼쪽 띠(제목·VR 진입·파일 열기·설정·소스 탭·PC 연결 상태)와 그 옆 목록 칸(종류 필터·정렬·폴더 이동·파일 목록).
// 띠와 목록 칸을 나란히 둬서 1280×720에서도 목록이 화면 높이를 거의 다 쓴다(64px 행 8줄 이상).
// 큰 글자·큰 버튼 위주(Quest 브라우저에서 레이로 누르기 쉽게). 목록이 수백 개여도 목록 칸만 스크롤되고 필터 줄은 위에 고정된다.
// 상태 메시지는 무대 위쪽에 겹쳐 띄워, 목록 공간을 쓰지 않는다.

import { on } from "../core/events.js";
import { extensionOf, formatBytes } from "../core/kinds.js";
import { KIND_FILTERS, PAGE_SIZE, SORTS, describeFolder, formatDate, pageWindow } from "../core/list-view.js";
import { getSource, listSources } from "../core/registry.js";
import { createFolderTree } from "../core/folder-tree.js";
import { explainVrError } from "../core/vr-launch.js";
import { storageEstimate } from "../core/store.js";
import { PRESET_CHOICES } from "../viewers/splat/quest-presets.js";
import { setUiLayerPreferred, uiLayerPreferred } from "../core/quad-layer.js";
import { readAutoVr, shouldAutoEnterVr, shouldShowVrPrompt, writeAutoVr } from "./vr-entry.js";

const KIND_LABEL = { splat: "PLY", video: "영상", image: "사진" };
const fmt = (n) => Number(n).toLocaleString("ko-KR");
/** 행을 누르면 일어나는 일. 영상은 받지 않고 바로 재생(스트리밍)된다는 점이 보이게 한다. */
const GO_LABEL = { video: "▶ 재생", image: "열기", splat: "열기" };
/** 이 크기 이상의 영상은 기기에 저장 버튼을 숨긴다(앱 저장 공간에 넣을 일이 거의 없다). */
const HIDE_SAVE_BYTES = 2 * 1024 ** 3;

/** 기기에 복사해 두는 보조 버튼의 글자. 저장 크기를 같이 보여 준다. 숨겨야 하면 null. */
function saveLabel(item, sourceId) {
  if (sourceId === "session") return { text: "보관", title: "앱에 복사해 두면 앱을 껐다 켜도 남습니다" };
  if (item.kind === "video" && (item.size ?? 0) >= HIDE_SAVE_BYTES) return null;
  const size = Number.isFinite(item.size) ? formatBytes(item.size) : "";
  const what = item.kind === "video" ? "기기에 저장" : "보관";
  return {
    text: size ? `${what}\n${size}` : what,
    title:
      item.kind === "video" || item.kind === "image"
        ? "저장하지 않아도 행을 누르면 바로 열립니다. 이 버튼은 오프라인용으로 기기에 복사해 둡니다."
        : "앱에 복사해 두면 PC가 꺼져 있어도 열 수 있습니다",
  };
}

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
        <div class="rail" id="rail">
          <h1>SHARP 뷰어</h1>
          <button class="btn primary" id="btn-vr" type="button" disabled>VR 보기</button>
          <div class="actions">
            <button class="btn" id="btn-pick" type="button">기기에서 파일 열기</button>
            <button class="btn" id="btn-settings" type="button" aria-expanded="false" aria-controls="settings">설정</button>
          </div>
          <div class="settings" id="settings" hidden>
            <label class="field">
              <span>그래픽 품질 (바꾸면 앱이 다시 시작됩니다)</span>
              <select id="preset"></select>
            </label>
            <label class="autovr" id="ui-layer-field">
              <input type="checkbox" id="ui-layer">
              <span>VR 패널·재생 컨트롤을 레이어로 그리기</span>
            </label>
            <p class="muted" id="ui-layer-hint">VR에서 패널이 뒤집혀 보이거나 안 보이면 끄세요. VR에 다시 들어가면 적용됩니다.</p>
            <p class="muted" id="storage"></p>
          </div>
          <nav class="tabs" id="tabs" role="tablist"></nav>
          <div class="source-panel" id="source-panel"></div>
        </div>
        <section class="listcol" id="listcol">
          <div class="listhead" id="listhead">
            <div class="toolbar">
              <div class="chips" id="chips" role="group" aria-label="종류"></div>
              <label class="sort"><span class="sr-only">정렬</span><select id="sort" aria-label="정렬"></select></label>
            </div>
            <div class="folderbar" id="folderbar" hidden>
              <button class="btn small" id="btn-up" type="button">⬆ 상위</button>
              <button class="btn small" id="btn-recent" type="button">최근</button>
              <span class="crumbs" id="crumbs"></span>
            </div>
            <p class="count" id="count" aria-live="polite"></p>
          </div>
          <div class="listbody">
            <nav class="foldertree" id="foldertree" aria-label="폴더" hidden></nav>
            <ul class="list" id="list"></ul>
          </div>
        </section>
      </aside>
      <main class="stage" id="stage">
        <button class="btn fold" id="btn-fold" type="button" aria-label="목록 접기/펼치기">☰</button>
        <p class="status" id="status" role="status"></p>
        <div class="drop-hint" id="drop-hint">PLY·영상·사진 파일을 여기로 끌어다 놓아도 됩니다</div>
      </main>
    </div>
  `;

  const $ = (selector) => /** @type {HTMLElement} */ (root.querySelector(selector));
  const statusEl = $("#status");
  const listEl = $("#list");
  const treeEl = $("#foldertree");
  const listcolEl = $("#listcol");
  const tabsEl = $("#tabs");
  const panelEl = $("#source-panel");
  /** @type {Map<string, (container: HTMLElement) => void>} */
  const sourcePanels = new Map();
  const vrButton = /** @type {HTMLButtonElement} */ ($("#btn-vr"));
  const presetSelect = /** @type {HTMLSelectElement} */ ($("#preset"));
  const chipsEl = $("#chips");
  const sortSelect = /** @type {HTMLSelectElement} */ ($("#sort"));
  const folderbarEl = $("#folderbar");
  const upButton = /** @type {HTMLButtonElement} */ ($("#btn-up"));
  const recentButton = /** @type {HTMLButtonElement} */ ($("#btn-recent"));
  const crumbsEl = $("#crumbs");
  const countEl = $("#count");
  const listheadEl = $("#listhead");
  const stageEl = $("#stage");
  const hintEl = $("#drop-hint");

  /** 마지막 오류 문구가 목록·열기 실패에서 온 것인지(다시 불러오기에 성공하면 지운다) */
  let staleError = false;
  const setStatus = (text, kind = "") => {
    statusEl.textContent = text;
    statusEl.dataset.kind = kind;
    staleError = false;
  };
  const setStaleError = (text) => {
    setStatus(text, "error");
    staleError = true;
  };

  // ---- VR 버튼 ---- (무대는 이 화면의 stageEl 안에 만들어지므로 bindStage로 나중에 연결한다)
  /** @type {ReturnType<typeof import('../core/xr-stage.js').createXrStage> | null} */
  let boundStage = null;
  let vrSupported = false;
  /** 지금 열려 있는 항목의 종류(영상·사진이면 2D 화면에 'VR로 보기' 안내를 크게 띄운다) */
  let openKind = null;
  let promptDismissed = false;

  // 영상·사진은 2D 미리보기에서 왼쪽 눈 그림만 보여 주므로 입체가 아니다 → VR로 들어가라고 크게 알린다.
  const vrPromptEl = document.createElement("div");
  vrPromptEl.className = "vr-prompt hidden";
  vrPromptEl.innerHTML = `<button type="button" class="vr-prompt-go">🥽 VR로 보기 (입체)</button><p>지금은 2D 미리보기라 입체가 아니고 3D 영상·사진은 왼쪽 눈 그림만 보입니다.</p><button type="button" class="vr-prompt-close" aria-label="안내 닫기">닫기</button>`;
  stageEl.appendChild(vrPromptEl);
  const refreshVrPrompt = () => vrPromptEl.classList.toggle("hidden", !shouldShowVrPrompt({ kind: openKind, hasXr: !!navigator.xr, presenting, dismissed: promptDismissed }));

  /** 사용자 동작(클릭) 안에서 부른다. 실패하면 이유를 알리고 큰 버튼은 그대로 둔다. */
  async function startVr() {
    if (!boundStage) return;
    try {
      await boundStage.enterVR();
    } catch (error) {
      setStatus(`VR을 시작하지 못했습니다: ${explainVrError(error)}`, "error");
      promptDismissed = false;
      refreshVrPrompt();
    }
  }
  vrPromptEl.querySelector(".vr-prompt-go").addEventListener("click", () => startVr());
  vrPromptEl.querySelector(".vr-prompt-close").addEventListener("click", () => {
    promptDismissed = true;
    refreshVrPrompt();
  });

  // 설정: 영상·사진은 열면 바로 VR로(기본 켬)
  let autoVr = readAutoVr();
  const autoVrLabel = document.createElement("label");
  autoVrLabel.className = "autovr";
  autoVrLabel.innerHTML = `<input type="checkbox" id="auto-vr"> 영상·사진은 열면 바로 VR로`;
  const autoVrBox = /** @type {HTMLInputElement} */ (autoVrLabel.querySelector("input"));
  autoVrBox.checked = autoVr;
  autoVrBox.addEventListener("change", () => {
    autoVr = autoVrBox.checked;
    writeAutoVr(autoVr);
  });
  vrButton.insertAdjacentElement("afterend", autoVrLabel);

  /** @param {ReturnType<typeof import('../core/xr-stage.js').createXrStage>} stage */
  function bindStage(stage) {
    boundStage = stage;
    // 판정이 false여도 버튼은 막지 않는다: 눌러서 실제로 시도하고, 실패하면 이유를 보여 준다(판정이 틀렸거나 늦었을 수 있다).
    const applySupport = (supported) => {
      vrSupported = supported;
      vrButton.disabled = !navigator.xr;
      if (!presenting) vrButton.textContent = !navigator.xr ? "VR 사용 불가" : supported ? "VR 보기" : "VR 시도(지원 확인 안 됨)";
      vrButton.title = supported || !navigator.xr ? "" : "이 화면에서는 VR 지원이 확인되지 않았습니다. 눌러서 시도할 수 있습니다.";
      refreshVrPrompt();
    };
    stage.isVRSupported().then(applySupport);
    // 헤드셋·런타임이 나중에 준비되면 다시 판정한다.
    navigator.xr?.addEventListener?.("devicechange", () => stage.isVRSupported().then(applySupport));
    vrButton.addEventListener("click", () => startVr());
  }
  on("xr:sessionstart", () => {
    presenting = true;
    vrButton.textContent = "VR 보는 중";
    refreshVrPrompt();
  });
  on("xr:sessionend", () => {
    presenting = false;
    vrButton.textContent = vrSupported ? "VR 보기" : "VR 시도(지원 확인 안 됨)";
    promptDismissed = false;
    refreshVrPrompt();
    // VR 안에서 미뤄 둔 목록 그리기를 한 번만 하고, 지금 열린 항목이 보이게 한다.
    if (renderPending) {
      renderList();
      listEl.querySelector(".row.current")?.scrollIntoView({ block: "center" });
    }
  });

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

  // ---- 종류 필터·정렬·폴더 ----
  for (const filter of KIND_FILTERS) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.dataset.value = filter.value;
    chip.textContent = filter.label;
    chip.addEventListener("click", () => library.setView({ kind: filter.value }));
    chipsEl.appendChild(chip);
  }
  for (const sort of SORTS) {
    const option = document.createElement("option");
    option.value = sort.value;
    option.textContent = sort.label;
    sortSelect.appendChild(option);
  }
  sortSelect.addEventListener("change", () => library.setView({ sort: sortSelect.value }));
  upButton.addEventListener("click", () => library.upFolder());
  recentButton.addEventListener("click", () => library.openFolder(""));

  // 폴더 트리(VR 파일 선택창과 같은 core/folder-tree.js): 폴더가 있는 출처에서만 목록 왼쪽에 보인다. 하위 폴더는 필요할 때만 불러온다.
  const tree = createFolderTree({ listSources, getSource, onChange: () => renderTree() });
  let lastRevealKey = "";
  /** 새 목록을 기다리는 중(library:changed loading). 연결 전 PC면 "PC 찾는 중" 안내를 보인다. */
  let listLoading = false;
  function renderTree() {
    const browse = library.canBrowse;
    treeEl.hidden = !browse;
    // 트리가 있으면 목록 칸을 넓히고 이름을 한 줄로 줄여, 1280×720 창에서도 파일이 8줄 이상 보이게 한다(styles.css .layout.has-tree).
    root.querySelector(".layout")?.classList.toggle("has-tree", browse);
    treeEl.innerHTML = "";
    if (!browse) return;
    const current = { sourceId: library.listSourceId, path: library.folder };
    for (const row of tree.rows(current)) {
      if (row.sourceId !== current.sourceId) continue;
      const line = document.createElement("div");
      line.className = "tree-row" + (row.current ? " current" : "");
      line.style.paddingLeft = `${Math.min(row.depth, 5) * 12}px`;
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "tree-toggle";
      toggle.textContent = row.expandable ? (row.loading ? "…" : row.error ? "!" : row.expanded ? "▾" : "▸") : "";
      toggle.disabled = !row.expandable;
      toggle.setAttribute("aria-label", row.expanded ? "접기" : "펼치기");
      toggle.addEventListener("click", () => tree.toggle(row.sourceId, row.path));
      const label = document.createElement("button");
      label.type = "button";
      label.className = "tree-label";
      label.textContent = row.kind === "source" ? (row.loading && getSource(row.sourceId)?.searchHint?.()) || "최근 파일" : row.name;
      label.title = row.path || row.name;
      label.addEventListener("click", () => (row.kind === "source" ? library.openFolder("", row.sourceId) : library.openFolder(row.path, row.sourceId)));
      line.append(toggle, label);
      treeEl.appendChild(line);
    }
  }
  on("library:changed", (detail = {}) => {
    listLoading = !!detail.loading;
    if (detail.loading) return;
    if (detail.dirs && !detail.failed) tree.prime(detail.sourceId, detail.folder ?? "", detail.dirs);
    const key = `${detail.sourceId}|${detail.folder ?? ""}`;
    if (key !== lastRevealKey) {
      lastRevealKey = key;
      if (getSource(detail.sourceId)?.browsable) tree.reveal(detail.sourceId, detail.folder ?? "");
    }
  });

  function renderToolbar() {
    for (const chip of chipsEl.children) chip.setAttribute("aria-pressed", String(chip.dataset.value === library.view.kind));
    sortSelect.value = library.view.sort;
    const browse = library.canBrowse;
    folderbarEl.hidden = !browse;
    // 폴더 이동은 왼쪽 트리가 맡는다(⬆ 상위·최근 버튼은 숨김).
    upButton.hidden = true;
    recentButton.hidden = true;
    // 폴더 줄이 있으면 개수는 그 줄 끝에, 없으면 필터 줄 아래에 둔다(세로 공간 절약).
    (browse ? folderbarEl : listheadEl).append(countEl);
    if (browse) {
      crumbsEl.textContent = describeFolder(library.folder);
      crumbsEl.title = library.folder;
      upButton.disabled = !library.folder;
      recentButton.disabled = !library.folder;
    }
    const shown = library.items.length;
    const total = library.allItems.length;
    const folders = library.folders.length + library.sequences.length;
    const parts = [];
    if (folders) parts.push(`폴더 ${fmt(folders)}개`);
    parts.push(shown === total ? `파일 ${fmt(total)}개` : `파일 ${fmt(total)}개 중 ${fmt(shown)}개`);
    if (library.hiddenCount) parts.push(`외 ${fmt(library.hiddenCount)}개`);
    if (library.truncated) parts.push("일부만 표시");
    countEl.textContent = parts.join(" · ");
    countEl.title = library.hiddenCount ? "최근 파일 목록에 다 담지 못한 파일이 있습니다. 폴더로 들어가면 모두 보입니다." : "";
  }

  // ---- 목록 ----
  // 목록이 수천~수만 개여도 DOM에는 한 번에 PAGE_SIZE개 안팎만 둔다. [더 보기]/[이전 보기]로 한 쪽씩 늘린다.
  // 열려 있는 항목이 범위 밖이면 그 항목 주변 200행으로 범위를 옮긴다(6000번째가 열려도 6000행을 그리지 않는다).
  let win = { start: 0, end: PAGE_SIZE };
  let limitKey = "";
  // VR 안에서는 2D 목록이 보이지 않으므로 다시 그리지 않고 미뤘다가, VR을 나온 뒤 한 번만 그린다.
  let presenting = false;
  let renderPending = false;

  function updateRenderWindow() {
    const view = library.view;
    const key = `${library.listSourceId}|${library.folder}|${view.kind}|${view.sort}`;
    if (key !== limitKey) {
      limitKey = key;
      win = { start: 0, end: PAGE_SIZE };
    }
    const index = library.current ? library.items.findIndex((entry) => entry.id === library.current.id) : -1;
    win = pageWindow(win, library.items.length, index);
  }

  function renderList() {
    if (presenting) {
      renderPending = true;
      return;
    }
    renderPending = false;
    updateRenderWindow();
    renderTabs();
    // 소스별 전용 패널(예: PC 연결 상태). 이 탭이 선택됐을 때만 보인다.
    panelEl.innerHTML = "";
    const renderPanel = sourcePanels.get(library.listSourceId);
    panelEl.hidden = !renderPanel;
    renderPanel?.(panelEl);
    renderToolbar();
    renderTree();
    listEl.innerHTML = "";
    const items = library.items;
    const folders = library.folders;
    const sourceId = library.listSourceId;
    const sequences = library.sequences;
    if (!items.length && !folders.length && !sequences.length) {
      const empty = document.createElement("li");
      empty.className = "empty";
      const filtered = library.allItems.length > 0;
      const searching = listLoading ? (getSource(sourceId)?.searchHint?.() ?? "") : "";
      empty.textContent = listLoading
        ? searching || "불러오는 중…"
        : filtered
        ? "이 종류의 파일이 없습니다. 위에서 「전체」를 눌러 보세요."
        : sourceId === "session"
          ? "아직 연 파일이 없습니다. [기기에서 파일 열기]를 눌러 Quest 저장소의 .ply를 고르세요."
          : sourceId === "library"
            ? "보관함이 비어 있습니다. 파일을 연 뒤 [보관]을 누르면 앱에 저장됩니다."
            : library.folder
              ? "이 폴더에는 열 수 있는 파일이 없습니다."
              : "표시할 파일이 없습니다.";
      listEl.appendChild(empty);
      return;
    }

    // 하위 폴더는 왼쪽 트리(renderTree)에 있으므로 목록에는 넣지 않는다.

    // 프레임 시퀀스 폴더 바로가기. 같은 이름이 여럿일 수 있어 경로(path)를 함께 보여 준다.
    // 영상·PLY 필터가 켜져 있으면(프레임은 사진 묶음이므로) 숨긴다. 둘 이상이면 「프레임 시퀀스 N곳」 한 줄로 접는다.
    const showSequences = library.view.kind === "video" || library.view.kind === "splat" ? [] : sequences;
    const folded = showSequences.length >= 2 && !library.sequencesExpanded;
    if (showSequences.length >= 2) {
      const li = document.createElement("li");
      li.className = "row folder sequence group";
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "open";
      toggle.setAttribute("aria-expanded", String(!folded));
      toggle.innerHTML = `<span class="kind k-seq">프레임</span><span class="name"></span><span class="meta"></span><span class="go"></span>`;
      toggle.querySelector(".name").textContent = `프레임 시퀀스 ${showSequences.length}곳`;
      toggle.querySelector(".meta").textContent = folded ? "눌러서 펼치기" : "눌러서 접기";
      toggle.querySelector(".go").textContent = folded ? "▸" : "▾";
      toggle.addEventListener("click", () => library.toggleSequences());
      li.appendChild(toggle);
      listEl.appendChild(li);
    }
    for (const sequence of folded ? [] : showSequences) {
      const li = document.createElement("li");
      li.className = "row folder sequence";
      const open = document.createElement("button");
      open.type = "button";
      open.className = "open";
      open.innerHTML = `<span class="kind k-seq">프레임</span><span class="name"></span><span class="meta"></span><span class="go">›</span>`;
      open.querySelector(".name").textContent = sequence.name;
      open.querySelector(".name").title = sequence.path;
      const parent = sequence.path.split("/").slice(0, -1).join("/");
      open.querySelector(".meta").textContent = [`${fmt(sequence.count)}장`, parent, formatDate(sequence.mtime)].filter(Boolean).join(" · ");
      open.addEventListener("click", () => library.openFolder(sequence.path));
      li.appendChild(open);
      listEl.appendChild(li);
    }

    if (win.start > 0) {
      const li = document.createElement("li");
      li.className = "more";
      const less = document.createElement("button");
      less.type = "button";
      less.className = "btn more-btn";
      less.textContent = `이전 보기 (위에 ${fmt(win.start)}개 더 있음)`;
      less.addEventListener("click", () => {
        win = { start: Math.max(0, win.start - PAGE_SIZE), end: win.end };
        renderList();
      });
      li.appendChild(less);
      listEl.appendChild(li);
    }

    for (const item of items.slice(win.start, win.end)) {
      const li = document.createElement("li");
      const isCurrent = library.current?.id === item.id;
      li.className = `row${isCurrent ? " current" : ""}`;

      const open = document.createElement("button");
      open.type = "button";
      open.className = "open";
      open.disabled = !library.canOpen(item);
      open.innerHTML = `<span class="kind k-${item.kind}"></span><span class="name"></span><span class="meta"></span><span class="go"></span>`;
      open.querySelector(".kind").textContent = KIND_LABEL[item.kind] ?? item.kind;
      open.querySelector(".go").textContent = library.canOpen(item) ? (GO_LABEL[item.kind] ?? "열기") : "";
      open.querySelector(".name").textContent = item.name;
      open.querySelector(".name").title = item.name;
      const meta = [extensionOf(item.name).toUpperCase(), formatBytes(item.size ?? NaN), formatDate(item.mtime)].filter(Boolean);
      if (!library.canOpen(item)) meta.push("뷰어 준비 중");
      open.querySelector(".meta").textContent = meta.join(" · ");
      open.addEventListener("click", () => {
        // 영상·사진은 누른 그 자리(사용자 동작)에서 바로 VR 세션을 요청한다. 열기가 끝나길 기다리면 동작 허용 시간이 지날 수 있다.
        if (shouldAutoEnterVr({ kind: item.kind, enabled: autoVr, supported: vrSupported, presenting })) startVr();
        library.open(item, { playlist: library.items });
      });
      li.appendChild(open);

      const side = document.createElement("div");
      side.className = "row-actions";
      if (sourceId === "library") {
        side.appendChild(smallButton("삭제", () => removeItem(item)));
      } else {
        const save = saveLabel(item, sourceId);
        if (save) {
          const button = smallButton(save.text, () => keepItem(item));
          button.classList.add("ghost");
          button.title = save.title;
          side.appendChild(button);
        }
      }
      if (side.childElementCount) li.appendChild(side);
      listEl.appendChild(li);
    }

    if (items.length > win.end) {
      const li = document.createElement("li");
      li.className = "more";
      const more = document.createElement("button");
      more.type = "button";
      more.className = "btn more-btn";
      const left = items.length - win.end;
      more.textContent = `더 보기 (${fmt(Math.min(PAGE_SIZE, left))}개 · 남은 ${fmt(left)}개)`;
      more.addEventListener("click", () => {
        win = { start: win.start, end: win.end + PAGE_SIZE };
        renderList();
      });
      li.appendChild(more);
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

  on("library:changed", ({ failed } = {}) => {
    // 실패한 뒤 다시 연결·불러오기에 성공하면 빨간 오류 문구를 지운다.
    if (!failed && staleError) setStatus("");
    renderList();
  });
  on("item:loading", ({ item }) => {
    setStatus(`불러오는 중… ${item.name}`);
    renderList();
  });
  on("item:opened", ({ item }) => {
    openKind = item.kind;
    promptDismissed = false;
    refreshVrPrompt();
    const index = library.playlist.findIndex((entry) => entry.id === item.id);
    const position = library.playlist.length > 1 ? `${index + 1}/${library.playlist.length} ` : "";
    setStatus(`${position}${item.name}`);
    hintEl.classList.add("hidden");
    renderList();
  });
  on("item:error", ({ item, error }) => {
    setStaleError(`열지 못했습니다 (${item.name}): ${error?.message ?? error}`);
    renderList();
  });
  on("item:closed", () => {
    openKind = null;
    refreshVrPrompt();
    setStatus("");
    hintEl.classList.remove("hidden");
    renderList();
  });
  on("app:status", ({ text, kind }) => setStatus(text, kind));
  on("library:error", ({ error }) => setStaleError(`목록을 불러오지 못했습니다: ${error?.message ?? error}`));

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
  // VR 패널·재생 컨트롤을 컴포지터 레이어로 그릴지(core/quad-layer.js). 실기기에서 문제가 있으면 여기서 끈다.
  const uiLayerBox = /** @type {HTMLInputElement} */ ($("#ui-layer"));
  uiLayerBox.checked = uiLayerPreferred();
  uiLayerBox.addEventListener("change", () => setUiLayerPreferred(uiLayerBox.checked));

  async function refreshStorage() {
    const estimate = await storageEstimate();
    $("#storage").textContent = estimate
      ? `앱 저장 공간: ${formatBytes(estimate.usage)} 사용 / ${formatBytes(estimate.quota)} 가능${estimate.persisted ? " (자동 삭제 방지됨)" : ""}`
      : "";
  }
  $("#btn-settings").addEventListener("click", () => {
    const settings = $("#settings");
    settings.hidden = !settings.hidden;
    $("#btn-settings").setAttribute("aria-expanded", String(!settings.hidden));
    if (!settings.hidden) refreshStorage();
  });
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
