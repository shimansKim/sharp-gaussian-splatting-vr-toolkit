// VR 안 패널: 캔버스 텍스처 평면 + 컨트롤러 레이 선택.
// 자리: 폴더·파일을 고르는 이 목록 창은 **눈높이 정면**에 연다(사람이 열 때의 시선 기준, 열린 동안은 고정). 재생 컨트롤·PLY 안내는 정면 아래쪽 도크(공용 UI 앵커)에 따로 있다.
// 목록에서 파일을 고르면(item:opened) 이 창은 자동으로 닫히고, UI 앵커를 지금 시선으로 옮겨 재생 컨트롤이 고른 화면 아래에 나오게 한다("list:picked" 이벤트로 미디어 화면도 정면에 맞춘다). A/X·스틱으로 넘길 때는 위치를 안 바꾼다.
// B/Y 짧게는 모든 UI(이 패널·미디어 재생 컨트롤·PLY 안내) 켜기·끄기(ui/ui-controls.js)이고, 패널은 꺼졌다 켜져도 같은 자리·같은 상태로 돌아온다.
// 기본 화면에는 자주 쓰는 것만 둔다: 종류 필터·정렬, (PC) 폴더 이동, 스크롤되는 파일 목록, [이전][다음][슬라이드쇼][더 보기], 오른쪽 위 [✕].
// 나머지(슬라이드쇼 간격·여기로 옮기기·위치 초기화·VR 종료·뷰어가 내놓는 panelActions·PLY 옵션)는 [더 보기] 화면에 모았다.
// 화면은 목록 / 더 보기 / PLY 옵션 중 하나만 보이고, 서로 겹치지 않는다. 버튼 글씨는 core/label-fit.js로 크기·줄 수를 맞춰 잘리지 않게 한다.
// 레이를 버튼에 맞추고 트리거를 누르면 선택된다. 스틱을 위·아래로 밀거나 ▲▼ 버튼으로 목록을 넘긴다.
// 목록이 수천 개여도 보이는 줄만 그리므로(가상 스크롤) 비용이 일정하다. 처음·끝·±100줄 점프 버튼과, 오래 밀수록 빨라지는 스틱 스크롤로 먼 곳까지 간다.
// 패널이 열려 있는 동안 뷰어에는 입력이 전달되지 않는다.
// 영역이 겹치지 않도록 위에서부터 쌓는다: 제목 → 필터·정렬·스크롤 → 폴더 줄 → 목록 → 동작 버튼(아래에 붙음).

import * as THREE from "three";
import { emit, on } from "../core/events.js";
import { extensionOf, formatBytes } from "../core/kinds.js";
import { getSource, listSources } from "../core/registry.js";
import { createFolderTree } from "../core/folder-tree.js";
import { ui } from "../core/ui-state.js";
import { QuadLayerSurface } from "../core/quad-layer.js";
import { drawFitLabel } from "../core/label-fit.js";
import { JUMP_ROWS, KIND_FILTERS, SORTS, describeFolder, labelOf, nextValue } from "../core/list-view.js";

const W = 1024;
const H = 960;
const PLANE_W = 1.2;
const PLANE_H = PLANE_W * (H / W);
/** 목록 창을 눈 앞 이 거리(m)에 연다. */
const FRONT_DISTANCE = 1.25;

const MARGIN = 40;
const ROW_H = 64; // 레이로 고르기 쉬운 크기(실제 약 7.5cm)
const ROW_STEP = 72;
const ACTION_H = 72;
const ACTION_STEP = 84;
const PER_ACTION_ROW = 4;
const MORE_COLUMNS = 2;
const MORE_STEP = 84;
const CLOSE_W = 64;
// 목록 화면: 왼쪽 폴더 트리 / 오른쪽 파일 목록(캔버스 안의 배치만. 패널 world 크기는 PLANE_W·PLANE_H)
const TREE_W = 316;
const COLUMN_GAP = 16;
const HEAD_H = 56;
const HEAD_STEP = 64;
const TREE_ROW_H = 56;
const TREE_STEP = 62;
const TREE_INDENT = 20;
const EXPAND_W = 52;
const FILE_ROW_H = 70;
const FILE_STEP = 78;
const SCROLL_REPEAT_MS = 140;
const SCROLL_STICK = 0.6;
/** 스틱을 밀고 있는 시간(ms)에 따라 한 번에 넘기는 줄 수가 늘어난다. */
const SCROLL_ACCEL = [
  [2500, 20],
  [1200, 5],
  [0, 1],
];
const FONT = "system-ui, 'Noto Sans KR', sans-serif";

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
  folder: "#1b3b4d",
  sequence: "#2f2338",
};

const TAGS = {
  dir: { label: "폴더", bg: "#234154", fg: "#9fd4ff" },
  seq: { label: "프레임", bg: "#43304a", fg: "#f0b4e8" },
  splat: { label: "PLY", bg: "#3a3157", fg: "#cbb8ff" },
  video: { label: "영상", bg: "#2d4a3d", fg: "#9fe3bd" },
  image: { label: "사진", bg: "#4a3f2a", fg: "#f0d28a" },
};

/**
 * @param {{
 *   stage: ReturnType<typeof import('../core/xr-stage.js').createXrStage>,
 *   library: ReturnType<typeof import('../core/library.js').createLibrary>,
 *   getActions?: () => Array<{ id: string, label: string, run: () => void }>,
 *   slideshow?: ReturnType<typeof import('../core/slideshow.js').createSlideshow> | null,
 * }} options
 */
export function createVrPanel({ stage, library, getActions = () => [], slideshow = null }) {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // 메시 폴백 경로: 기울어진 패널을 줄여 그릴 때 글씨가 반짝이지 않게 밉맵 + 이방성 필터.
  texture.anisotropy = Math.min(8, stage.renderer.capabilities?.getMaxAnisotropy?.() ?? 1);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(PLANE_W, PLANE_H),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, toneMapped: false }),
  );
  mesh.renderOrder = 999;
  mesh.visible = false;
  stage.scene.add(mesh);
  // 기본 출력은 컴포지터 레이어(앱 프레임이 늦어도 흔들리지 않음). 이 메시는 레이 히트 테스트용으로 항상 두고, 레이어로 그릴 때는 보이지 않게만 끈다.
  // 레이어를 못 쓰면(미지원·실패) 메시가 그대로 보인다.
  const surface = new QuadLayerSurface({ stage, canvas, mesh, widthM: PLANE_W, heightM: PLANE_H, name: "panel" });

  const rayLines = {
    left: createRayLine(),
    right: createRayLine(),
  };

  const raycaster = new THREE.Raycaster();
  const tempMatrix = new THREE.Matrix4();
  const tempVec = new THREE.Vector3();
  const tempDir = new THREE.Vector3();

  /** @type {Array<{ x: number, y: number, w: number, h: number, label: string, run: () => void, enabled: boolean, current?: boolean, tag?: string, side?: string, folder?: boolean, align?: string }>} */
  let buttons = [];
  /** @type {{ left: string | null, right: string | null }} */
  const hover = { left: null, right: null };
  /** 사람이 패널을 연 상태(의도). 실제로 보이는 것은 open && ui.visible. */
  let open = false;
  /** openAfterPose 호출 뒤 남은 프레임 수(0이면 대기 없음) */
  let pendingOpenFrames = 0;
  const OPEN_AFTER_FRAMES = 4;
  /** 보이는 화면: "list"(파일 목록) | "more"(더 보기) | "options"(뷰어가 panelOptions()를 내놓을 때 PLY 옵션 줄). */
  let page = "list";
  let message = "";
  let dirty = true;

  // 목록 스크롤: 맨 위에 보이는 항목 번호
  let scroll = 0;
  let followCurrent = true;
  let rowsVisible = 5;
  let totalEntries = 0;
  let lastFolder = "";
  let lastScrollAt = 0;
  let stickSince = 0;

  // 폴더 트리: 보이는 줄만 그린다(큰 트리여도 비용이 일정). 하위 폴더는 펼칠 때·폴더를 열 때만 불러온다(core/folder-tree.js).
  const tree = createFolderTree({ listSources, getSource, onChange: () => (dirty = true) });
  let treeScroll = 0;
  let treeRowsVisible = 8;
  let treeTotal = 0;
  let lastTreeKey = "";
  let lastListSource = "";
  /** 마지막으로 계산한 목록 화면의 칸 좌표(그리기에 쓴다). */
  let layoutGeometry = { TREE_X: MARGIN, LIST_X: MARGIN + TREE_W + COLUMN_GAP, LIST_W: 600, bodyTop: 188, bodyBottom: 850 };
  /** 각 컨트롤러 레이가 마지막으로 닿은 캔버스 x(스틱이 어느 칸을 넘길지 정한다). */
  const hitX = { left: null, right: null };
  let lastRevealKey = "";
  /** 새 목록을 기다리는 중(library:changed loading) */
  let listLoading = false;

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

  const shown = () => open && ui.visible;

  /** 실제로 보이는지(패널을 열었고 UI가 켜져 있음)에 맞춰 메시·레이를 맞춘다. */
  function applyShown() {
    const visible = shown();
    mesh.visible = visible;
    for (const line of Object.values(rayLines)) line.visible = visible;
    if (visible) {
      hover.left = null;
      hover.right = null;
      dirty = true;
    }
  }

  function setOpen(next) {
    const changed = open !== next;
    open = next;
    ui.setPanelOpen(open);
    if (open) {
      place(ui.gaze(stage.camera)); // 사람이 열 때의 시선 정면(눈높이)
      page = "list";
      followCurrent = true;
      dirty = true;
    }
    applyShown();
    if (changed) library.activeViewer?.onPanelToggle?.(open);
  }

  /**
   * 목록 창을 { head, yaw } 기준 눈높이 정면(FRONT_DISTANCE m 앞)에 세운다.
   * 사람이 열 때와 UI를 옮길 때(ui:anchor)만 호출하며, 그 밖의 조작(레이·스틱·트리거·머리 돌리기)으로는 움직이지 않는다.
   */
  function place({ head, yaw }) {
    mesh.scale.setScalar(1);
    mesh.rotation.set(0, yaw, 0);
    mesh.position.set(head.x - Math.sin(yaw) * FRONT_DISTANCE, head.y, head.z - Math.cos(yaw) * FRONT_DISTANCE);
  }

  /** 목록에서 사람이 방금 고른 파일의 id(열기가 끝나면 목록을 숨긴다). */
  let pickedId = null;

  /** 고른 파일이 열렸다: 목록을 숨기고, UI(재생 컨트롤·PLY 안내)를 지금 시선 아래쪽으로 옮기고, 미디어 화면을 정면에 맞추게 알린다. */
  function finishPick(item) {
    if (!shown()) {
      // 고르는 동안 사람이 UI를 껐다면 아무것도 옮기지 않고 목록만 닫는다.
      if (open) setOpen(false);
      return;
    }
    setOpen(false); // 같은 자리를 쓰던 재생 컨트롤이 돌아온다(onPanelToggle)
    ui.relocate(stage.camera); // 사람이 고른 순간의 정면 아래로: 재생 컨트롤이 고른 화면 아래에 나온다(ui:anchor)
    emit("list:picked", { item });
  }

  /** 오른쪽 목록에 보이는 줄: 프레임 시퀀스 폴더, 그다음 파일(하위 폴더는 왼쪽 트리에 있다). */
  function entries() {
    const kind = library.view.kind;
    const sequences = kind === "video" || kind === "splat" ? [] : library.sequences;
    // 시퀀스 폴더가 둘 이상이면 「프레임 시퀀스 N곳」 한 줄로 접고, 누르면 펼친다(2D 목록과 같은 상태).
    const group = sequences.length >= 2 ? [{ type: "seqgroup", count: sequences.length }] : [];
    const shownSequences = sequences.length >= 2 && !library.sequencesExpanded ? [] : sequences;
    return [
      ...group,
      ...shownSequences.map((sequence) => ({ type: "seq", sequence })),
      ...library.items.map((item) => ({ type: "item", item })),
    ];
  }

  const maxScroll = () => Math.max(0, totalEntries - rowsVisible);
  const clampScroll = () => {
    scroll = Math.max(0, Math.min(scroll, maxScroll()));
  };

  function scrollBy(rows) {
    const before = scroll;
    scroll += rows;
    clampScroll();
    if (scroll !== before) dirty = true;
  }

  const maxTreeScroll = () => Math.max(0, treeTotal - treeRowsVisible);
  const clampTreeScroll = () => {
    treeScroll = Math.max(0, Math.min(treeScroll, maxTreeScroll()));
  };
  function treeScrollBy(rows) {
    const before = treeScroll;
    treeScroll += rows;
    clampTreeScroll();
    if (treeScroll !== before) dirty = true;
  }

  /** 트리의 출처·폴더를 눌렀다: 그 목록을 연다(폴더면 그 출처의 그 폴더로). 열린 폴더는 펼쳐지고 하위 폴더가 보인다. */
  function selectTreeRow(row) {
    if (row.kind === "source") return library.setListSource(row.sourceId);
    return library.openFolder(row.path, row.sourceId);
  }

  function scrollTo(row) {
    const before = scroll;
    scroll = row;
    clampScroll();
    if (scroll !== before) dirty = true;
  }

  function layout() {
    const list = entries();
    totalEntries = list.length;
    const current = library.current;
    const view = library.view;
    buttons = [];

    // 아래 한 줄: 자주 쓰는 동작만. 나머지는 [더 보기] 화면으로 접는다(버튼이 많으면 어느 것이 무엇인지 알기 어렵다).
    const optionRows = library.activeViewer?.panelOptions?.() ?? [];
    if (!optionRows.length && page === "options") page = "list";
    const gap = 16;
    const actionsTop = H - 24 - ACTION_H;
    const perRowWidth = (W - MARGIN * 2 - gap * (PER_ACTION_ROW - 1)) / PER_ACTION_ROW;
    const multi = library.playlist.length > 1;
    const basic = [
      { label: "◀ 이전", run: () => library.prev(), enabled: multi },
      { label: "다음 ▶", run: () => library.next(), enabled: multi },
      ...(slideshow
        ? [{ label: slideshow.running ? "슬라이드쇼 ■" : "슬라이드쇼 ▶", run: () => slideshow.toggle(), enabled: multi || slideshow.running, on: slideshow.running }]
        : []),
      page === "list" ? { label: "더 보기 ▸", run: () => (page = "more"), enabled: true } : { label: "◂ 목록", run: () => (page = "list"), enabled: true },
    ];

    function placeActions() {
      basic.forEach((action, i) => {
        buttons.push({ x: MARGIN + i * (perRowWidth + gap), y: actionsTop, w: perRowWidth, h: ACTION_H, align: "center", ...action });
      });
      // 오른쪽 위 닫기(패널만 닫는다: 재생 컨트롤이 있으면 그 자리에 돌아온다)
      buttons.push({ x: W - MARGIN - CLOSE_W, y: 18, w: CLOSE_W, h: 56, label: "✕", run: () => "close", enabled: true, align: "center", close: true });
    }

    if (page === "more") {
      // 더 보기 화면: 2열 큰 버튼. 목록 위에 겹치지 않고 목록 대신 보인다.
      const columnW = (W - MARGIN * 2 - gap * (MORE_COLUMNS - 1)) / MORE_COLUMNS;
      const items = [
        ...(slideshow ? [{ label: `슬라이드쇼 간격: ${slideshow.interval}초`, run: () => slideshow.cycleInterval(), enabled: true }] : []),
        { label: "UI를 여기로 옮기기", run: () => relocateHere(), enabled: true },
        { label: "위치 초기화", run: () => (library.activeViewer?.resetView ? library.activeViewer.resetView() : stage.resetPlayer()), enabled: true },
        ...getActions().map((action) => ({ label: action.label, run: action.run, enabled: true })),
        ...(optionRows.length ? [{ label: "PLY 옵션 ▸", run: () => (page = "options"), enabled: true }] : []),
        { label: "VR 종료", run: () => stage.exitVR(), enabled: true },
      ];
      items.forEach((item, i) => {
        buttons.push({
          x: MARGIN + (i % MORE_COLUMNS) * (columnW + gap),
          y: 124 + Math.floor(i / MORE_COLUMNS) * MORE_STEP,
          w: columnW,
          h: ACTION_H,
          align: "center",
          ...item,
        });
      });
      totalEntries = 0;
      placeActions();
      return { listTop: 124, actionsTop };
    }
    if (page === "options") {
      // 옵션 화면: 큰 줄 하나씩. 눌러서 값을 바꾼다(값은 오른쪽에 보인다).
      const step = ROW_STEP + 8;
      optionRows.forEach((row, i) => {
        buttons.push({ x: MARGIN, y: 124 + i * step, w: W - MARGIN * 2, h: ROW_H + 8, label: row.label, side: row.side, run: row.run, enabled: true });
      });
      totalEntries = 0;
      placeActions();
      return { listTop: 124, actionsTop };
    }

    // ── 목록 화면: 왼쪽 폴더 트리(출처 → 폴더, 펼치기·접기), 오른쪽 선택한 폴더의 파일 목록 ──
    const TREE_X = MARGIN;
    const LIST_X = TREE_X + TREE_W + COLUMN_GAP;
    const LIST_W = W - MARGIN - LIST_X;
    const headY = 124;
    const bodyTop = headY + HEAD_STEP; // 트리 줄·목록 넘기기 줄이 시작하는 높이
    const bodyBottom = actionsTop - 12;
    layoutGeometry = { TREE_X, LIST_X, LIST_W, bodyTop, bodyBottom };

    // 왼쪽: 트리 머리([▲][▼]로 트리를 넘긴다)와 트리 줄
    const treeRows = tree.rows({ sourceId: library.listSourceId, path: library.folder });
    treeTotal = treeRows.length;
    treeRowsVisible = Math.max(1, Math.floor((bodyBottom - bodyTop) / TREE_STEP));
    const currentTreeKey = treeRows.find((r) => r.current)?.key ?? "";
    if (currentTreeKey !== lastTreeKey) {
      // 현재 폴더가 바뀌면 트리에서 보이는 곳으로 넘긴다
      lastTreeKey = currentTreeKey;
      const index = treeRows.findIndex((r) => r.current);
      if (index >= 0 && (index < treeScroll || index >= treeScroll + treeRowsVisible)) treeScroll = index - Math.floor(treeRowsVisible / 3);
    }
    clampTreeScroll();
    const treeHalf = (TREE_W - 8) / 2;
    [
      { label: "▲ 폴더", run: () => treeScrollBy(-(treeRowsVisible - 1)), enabled: treeScroll > 0 },
      { label: "▼ 폴더", run: () => treeScrollBy(treeRowsVisible - 1), enabled: treeScroll < maxTreeScroll() },
    ].forEach((control, i) => {
      buttons.push({ x: TREE_X + i * (treeHalf + 8), y: headY, w: treeHalf, h: HEAD_H, align: "center", ...control, column: "tree" });
    });
    treeRows.slice(treeScroll, treeScroll + treeRowsVisible).forEach((row, i) => {
      const y = bodyTop + i * TREE_STEP;
      const indent = Math.min(row.depth, 4) * TREE_INDENT;
      const x = TREE_X + indent;
      let labelX = x;
      if (row.expandable) {
        buttons.push({ x, y, w: EXPAND_W, h: TREE_ROW_H, align: "center", label: row.loading ? "…" : row.error ? "!" : row.expanded ? "▾" : "▸", run: () => tree.toggle(row.sourceId, row.path), enabled: true, folder: true, expander: true, column: "tree" });
        labelX = x + EXPAND_W + 4;
      } else if (row.kind === "dir") {
        labelX = x + EXPAND_W + 4;
      }
      // 연결 전 PC를 펼치거나 고르면 대역 탐색이 오래 걸린다: 멈춘 게 아니라고 이름 대신 안내를 보인다.
      const hint = row.loading && row.kind === "source" ? (getSource(row.sourceId)?.searchHint?.() ?? "") : "";
      buttons.push({
        x: labelX,
        y,
        w: TREE_X + TREE_W - labelX,
        h: TREE_ROW_H,
        label: hint || row.name,
        treeRow: true,
        source: row.kind === "source",
        run: () => selectTreeRow(row),
        enabled: true,
        current: row.current,
        column: "tree",
      });
    });

    // 오른쪽: 필터·정렬 줄
    const half = (LIST_W - 8) / 2;
    const controls = [
      { label: `종류: ${labelOf(KIND_FILTERS, view.kind)}`, run: () => library.setView({ kind: nextValue(KIND_FILTERS, view.kind) }), enabled: true },
      { label: `정렬: ${labelOf(SORTS, view.sort)}`, run: () => library.setView({ sort: nextValue(SORTS, view.sort) }), enabled: true },
    ];
    controls.forEach((control, i) => {
      buttons.push({ x: LIST_X + i * (half + 8), y: headY, w: half, h: HEAD_H, align: "center", ...control, column: "list" });
    });

    // 목록 넘기기 줄: 처음 · −100 · 위 · 아래 · +100 · 끝 (수천 개 목록의 먼 곳까지 가는 길)
    const navY = bodyTop;
    const navCount = 6;
    const navW = (LIST_W - 8 * (navCount - 1)) / navCount;
    const atTop = scroll <= 0;
    const atEnd = scroll >= maxScroll();
    const nav = [
      { label: "⏮", run: () => scrollTo(0), enabled: !atTop },
      { label: `−${JUMP_ROWS}`, run: () => scrollBy(-JUMP_ROWS), enabled: !atTop },
      { label: "▲", run: () => scrollBy(-(rowsVisible - 1)), enabled: !atTop },
      { label: "▼", run: () => scrollBy(rowsVisible - 1), enabled: !atEnd },
      { label: `+${JUMP_ROWS}`, run: () => scrollBy(JUMP_ROWS), enabled: !atEnd },
      { label: "⏭", run: () => scrollTo(Infinity), enabled: !atEnd },
    ];
    nav.forEach((control, i) => {
      buttons.push({ x: LIST_X + i * (navW + 8), y: navY, w: navW, h: HEAD_H, align: "center", ...control, column: "list" });
    });

    const listTop = navY + HEAD_STEP;
    rowsVisible = Math.max(1, Math.floor((bodyBottom - listTop) / FILE_STEP));
    if (library.folder !== lastFolder || library.listSourceId !== lastListSource) {
      lastFolder = library.folder;
      lastListSource = library.listSourceId;
      scroll = 0;
      followCurrent = false;
    }
    if (followCurrent && current) {
      const index = list.findIndex((entry) => entry.type === "item" && entry.item.id === current.id);
      if (index >= 0) scroll = index - Math.floor(rowsVisible / 2);
    }
    followCurrent = false;
    clampScroll();

    list.slice(scroll, scroll + rowsVisible).forEach((entry, row) => {
      const y = listTop + row * FILE_STEP;
      const rect = { x: LIST_X, y, w: LIST_W, h: FILE_ROW_H, fileRow: true, column: "list" };
      if (entry.type === "seqgroup") {
        buttons.push({ ...rect, label: `프레임 시퀀스 ${entry.count}곳`, tag: "seq", side: library.sequencesExpanded ? "접기 ▾" : "펼치기 ▸", folder: true, run: () => library.toggleSequences(), enabled: true });
        return;
      }
      if (entry.type === "seq") {
        const { sequence } = entry;
        buttons.push({ ...rect, label: sequence.name, tag: "seq", side: `${Number(sequence.count).toLocaleString("ko-KR")}장`, folder: true, run: () => library.openFolder(sequence.path), enabled: true });
        return;
      }
      const { item } = entry;
      const isCurrent = !!current && item.id === current.id;
      buttons.push({
        ...rect,
        label: `${isCurrent ? "▶ " : ""}${item.name}`,
        tag: item.kind,
        side: [extensionOf(item.name).toUpperCase(), formatBytes(item.size ?? NaN)].filter(Boolean).join(" · "),
        run: () => {
          pickedId = item.id;
          return library.open(item, { playlist: library.items });
        },
        enabled: library.canOpen(item),
        current: isCurrent,
      });
    });

    placeActions();
    return { listTop, actionsTop };
  }

  /** 사람이 누른 [여기로 옮기기]: UI 자리를 지금 보는 곳으로 옮긴다(패널·재생 컨트롤이 함께 옮겨진다). */
  function relocateHere() {
    ui.relocate(stage.camera);
    message = "UI를 지금 보는 곳으로 옮겼습니다";
    dirty = true;
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  }

  function draw() {
    const before = scroll;
    let { listTop } = layout();
    if (scroll !== before) ({ listTop } = layout()); // 스크롤 위치가 바뀌었으면 ▲▼ 활성 상태를 맞춰 다시 배치
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = COLORS.bg;
    roundRect(0, 0, W, H, 36);
    ctx.fill();
    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = 3;
    ctx.stroke();

    const current = library.current;
    // 오른쪽 위치 표시의 실제 폭을 먼저 재서, 긴 파일 이름이 그 앞에서 말줄임(…)되게 한다.
    const first = totalEntries ? scroll + 1 : 0;
    const last = Math.min(totalEntries, scroll + rowsVisible);
    const position = page === "options" ? "PLY 옵션" : page === "more" ? "더 보기" : totalEntries ? `${first}–${last} / ${totalEntries}` : "0개";
    const titleRight = W - MARGIN - CLOSE_W - 16; // 오른쪽 위 ✕ 버튼 앞까지
    ctx.font = `28px ${FONT}`;
    const positionWidth = ctx.measureText(position).width;
    ctx.fillStyle = COLORS.text;
    ctx.font = `600 38px ${FONT}`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    // 제목: 지금 보는 출처·폴더(오른쪽 파일 목록이 어느 폴더인지). 긴 경로는 앞을 줄이고 현재 폴더 이름을 남긴다.
    ctx.fillText(fitStart(page === "list" ? listTitle() : current ? current.name : "열린 파일 없음", titleRight - MARGIN - positionWidth - 24), MARGIN, 50);
    ctx.font = `28px ${FONT}`;
    ctx.fillStyle = COLORS.muted;
    ctx.textAlign = "right";
    ctx.fillText(position, titleRight, 50);
    ctx.fillStyle = COLORS.muted;
    drawFitLabel(ctx, message || "스틱: 목록 넘기기 · X/A: 이전·다음 · B/Y: UI 끄기(길게: 옮기기)", MARGIN, 94, W - MARGIN * 2, { family: FONT, weight: 400, sizes: [25, 23, 21], maxLines: 1, align: "left" });

    if (!totalEntries && page === "list") {
      ctx.fillStyle = COLORS.muted;
      ctx.font = `28px ${FONT}`;
      ctx.textAlign = "center";
      const searching = listLoading ? (getSource(library.listSourceId)?.searchHint?.() ?? "") : "";
      const empty = listLoading
        ? searching || "불러오는 중…"
        : library.allItems.length
        ? "이 종류의 파일이 없습니다"
        : library.listSourceId === "session"
          ? "VR에서는 기기 파일을 고를 수 없습니다. 'SHARP 뷰어'(2D)에서 열거나 보관함을 쓰세요"
          : "표시할 파일이 없습니다";
      // 오른쪽 목록 칸 안에 두 줄까지 나눠 그린다
      drawFitLabel(ctx, empty, layoutGeometry.LIST_X + layoutGeometry.LIST_W / 2, listTop + FILE_ROW_H, layoutGeometry.LIST_W - 24, { family: FONT, weight: 400, sizes: [28, 26, 24], maxLines: 3, maxHeight: 150 });
    }

    for (const button of buttons) {
      const key = `${button.x},${button.y}`;
      const hovered = hover.left === key || hover.right === key;
      ctx.fillStyle = !button.enabled
        ? COLORS.disabled
        : hovered
          ? COLORS.hover
          : button.current || button.on
            ? COLORS.current
            : button.folder
              ? COLORS.folder
              : COLORS.button;
      roundRect(button.x, button.y, button.w, button.h, 14);
      ctx.fill();
      ctx.strokeStyle = hovered ? COLORS.accent : COLORS.line;
      ctx.lineWidth = hovered ? 4 : 2;
      ctx.stroke();

      ctx.textBaseline = "middle";
      const cy = button.y + button.h / 2;
      if (button.treeRow) {
        // 트리 줄: 출처는 굵게, 폴더 이름은 두 줄까지 나눠 잘리지 않게
        ctx.fillStyle = button.enabled ? COLORS.text : COLORS.muted;
        drawFitLabel(ctx, button.label, button.x + 12, cy, button.w - 22, { family: FONT, weight: button.source ? 600 : 400, sizes: [28, 26, 24, 22], maxLines: 2, maxHeight: button.h - 4, align: "left" });
        continue;
      }
      if (button.fileRow) {
        // 파일 줄: [종류 태그] 이름(위) / 확장자 · 크기(아래)
        const tw = 64;
        let textX = button.x + 16;
        const tag = TAGS[button.tag];
        if (tag) {
          ctx.font = `24px ${FONT}`;
          ctx.fillStyle = tag.bg;
          roundRect(textX, cy - 17, tw, 34, 17);
          ctx.fill();
          ctx.fillStyle = tag.fg;
          ctx.textAlign = "center";
          ctx.fillText(tag.label, textX + tw / 2, cy + 1);
          textX += tw + 14;
        }
        const textW = button.x + button.w - 16 - textX;
        ctx.fillStyle = button.enabled ? COLORS.text : COLORS.muted;
        drawFitLabel(ctx, button.label, textX, button.side ? cy - 13 : cy, textW, { family: FONT, weight: 400, sizes: [30, 28, 26], maxLines: 1, align: "left" });
        if (button.side) {
          ctx.fillStyle = COLORS.muted;
          drawFitLabel(ctx, button.side, textX, cy + 20, textW, { family: FONT, weight: 400, sizes: [25, 23], maxLines: 1, align: "left" });
        }
        continue;
      }
      if (button.align === "center") {
        // 글씨 크기를 줄이거나 두 줄로 나눠 버튼 안에 다 들어가게 한다(잘리지 않음).
        ctx.fillStyle = button.enabled ? COLORS.text : COLORS.muted;
        drawFitLabel(ctx, button.label, button.x + button.w / 2, cy, button.w - 24, {
          family: FONT,
          sizes: button.close ? [34] : [30, 28, 26, 24, 22],
          maxLines: 2,
          maxHeight: button.h - 8,
        });
        continue;
      }
      // 목록 줄: [종류 태그] 이름 ........ 확장자 · 크기
      let textX = button.x + 20;
      const tag = TAGS[button.tag];
      if (tag) {
        ctx.font = `22px ${FONT}`;
        const tw = 84;
        ctx.fillStyle = tag.bg;
        roundRect(textX, cy - 16, tw, 32, 16);
        ctx.fill();
        ctx.fillStyle = tag.fg;
        ctx.textAlign = "center";
        ctx.fillText(tag.label, textX + tw / 2, cy + 1);
        textX += tw + 16;
      }
      let sideWidth = 0;
      if (button.side) {
        ctx.font = `24px ${FONT}`;
        ctx.fillStyle = COLORS.muted;
        ctx.textAlign = "right";
        sideWidth = Math.min(ctx.measureText(button.side).width, 260);
        ctx.fillText(button.side, button.x + button.w - 20, cy);
      }
      ctx.fillStyle = button.enabled ? COLORS.text : COLORS.muted;
      // 이름·옵션 문구는 줄이거나 두 줄로 나눈다(옵션 줄처럼 길면 두 줄, 파일 이름은 끝까지 안 들어가면 …).
      drawFitLabel(ctx, button.label, textX, cy, button.x + button.w - 20 - sideWidth - 16 - textX, {
        family: FONT,
        weight: 400,
        sizes: [30, 28, 26, 24],
        maxLines: 2,
        maxHeight: button.h - 6,
        align: "left",
      });
    }
    texture.needsUpdate = true;
    surface.invalidate();
    dirty = false;
  }

  /** 오른쪽 목록 칸의 제목: "PC / outputs / VR" 처럼 출처와 폴더. 최상위는 "PC / 최근 파일". */
  function listTitle() {
    const source = getSource(library.listSourceId);
    const label = source?.label ?? "목록";
    if (!source?.browsable) return label;
    return `${label} / ${describeFolder(library.folder)}`;
  }

  function fit(text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let out = text;
    while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) out = out.slice(0, -1);
    return `${out}…`;
  }

  /** 긴 경로는 앞쪽을 줄이고 현재 폴더 이름을 남긴다. */
  function fitStart(text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let out = text;
    while (out.length > 1 && ctx.measureText(`…${out}`).width > maxWidth) out = out.slice(1);
    return `…${out}`;
  }

  /** 컨트롤러 레이가 패널의 어느 버튼에 닿았는지. */
  function pick(side) {
    const controller = stage.controllers[side];
    if (!controller) return null;
    tempMatrix.identity().extractRotation(controller.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);
    const hit = raycaster.intersectObject(mesh, false)[0];
    if (!hit?.uv) {
      surface.setCursor(side, null);
      hitX[side] = null;
      return null;
    }
    const px = hit.uv.x * W;
    hitX[side] = px;
    const py = (1 - hit.uv.y) * H;
    // 레이어로 그릴 때 레이 선이 패널에 가려지므로 닿은 자리에 점을 보인다(점 주변 작은 조각만 올린다: core/quad-layer.js).
    surface.setCursor(side, { x: px, y: py });
    return buttons.find((b) => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) ?? null;
  }

  // 상태 문구(PC 연결 중·오류 등)를 VR 안에서도 볼 수 있게 제목 아래 줄에 보인다.
  on("app:status", ({ text }) => {
    message = text ?? "";
    dirty = true;
  });

  // UI 켜기·끄기: 패널을 다시 그리지 않고 보이기만 바꾼다(위치·스크롤·옵션 화면 상태는 그대로).
  on("ui:visibility", () => applyShown());
  // 앵커가 정해지거나(세션 시작 직후) 사람이 재배치하면 그 자리로 옮긴다. 이 밖에는 패널이 옮겨지지 않는다.
  on("ui:anchor", () => {
    if (open) place(ui.reference(stage.camera));
  });
  on("item:opened", ({ item }) => {
    if (pickedId && item?.id === pickedId) {
      pickedId = null;
      finishPick(item);
    }
  });
  on("item:error", () => {
    pickedId = null;
  });

  // 목록이 새로 열리면 그 폴더의 하위 폴더를 트리가 받아 두고(추가 요청 없음), 현재 폴더까지의 조상을 펼쳐 보인다.
  on("library:changed", (detail) => {
    listLoading = !!detail?.loading;
    if (detail?.loading) return;
    if (detail?.dirs && !detail.failed) tree.prime(detail.sourceId, detail.folder ?? "", detail.dirs);
    const revealKey = `${detail?.sourceId}|${detail?.folder ?? ""}`;
    if (revealKey !== lastRevealKey) {
      lastRevealKey = revealKey;
      if (getSource(detail?.sourceId)?.browsable) tree.reveal(detail.sourceId, detail.folder ?? "");
    }
  });

  // 목록·현재 항목이 바뀌면 다시 그린다. 항목이 새로 열리면 목록을 그 항목 쪽으로 맞춘다.
  for (const name of ["library:changed", "item:opened", "item:loading", "item:error", "item:closed", "slideshow:changed"]) {
    on(name, () => {
      if (name === "item:opened") followCurrent = true;
      dirty = true;
    });
  }

  return {
    /** 지금 눈에 보이는가(패널을 열었고 UI가 켜져 있음). 뷰어 입력 차단 판단에 쓴다. */
    get isOpen() {
      return shown();
    },
    /** 사람이 패널을 열어 둔 상태(UI를 꺼 둔 동안에도 true일 수 있다). */
    get wantsOpen() {
      return open;
    },
    open: () => setOpen(true),
    toggle: () => setOpen(!open),
    /** [PLY 옵션] 화면 보기·끄기(검증용으로도 열어 둔다). */
    get optionsOpen() {
      return page === "options";
    },
    setOptionsOpen(next) {
      page = next ? "options" : "list";
      dirty = true;
    },
    /** 보이는 화면: "list" | "more" | "options". 검증용으로도 열어 둔다. */
    get page() {
      return page;
    },
    setPage(next) {
      page = next === "more" || next === "options" ? next : "list";
      dirty = true;
    },
    /** 패널 캔버스(검증용: 글씨가 잘리는지 캡처해 본다). */
    get canvas() {
      return canvas;
    },
    close: () => setOpen(false),
    /** UI 출력 상태(검증용): 레이어로 그리는 중인지와 못 쓴 이유. */
    get layerState() {
      return { active: surface.active, failed: surface.failed, error: surface.lastError, size: surface.size ?? null };
    },
    showMessage(text) {
      message = text;
      dirty = true;
    },
    invalidate() {
      dirty = true;
    },
    /** 목록을 rows줄 넘긴다(스틱·▲▼가 같이 쓴다). 테스트·검증용으로도 열어 둔다. */
    scrollBy,
    scrollTo,
    /** 지금 그려진 버튼 영역(캔버스 좌표). 테스트·검증용. */
    get buttonRects() {
      return buttons.map(({ label, x, y, w, h, enabled }) => ({ label, x, y, w, h, enabled }));
    },
    get scrollState() {
      return { scroll, rowsVisible, total: totalEntries };
    },
    /** 폴더 트리(검증용): 보이는 행과 스크롤 상태. */
    get treeState() {
      return { rows: tree.rows({ sourceId: library.listSourceId, path: library.folder }), scroll: treeScroll, rowsVisible: treeRowsVisible, total: treeTotal };
    },
    tree,

    /**
     * 매 프레임 호출. 패널이 열려 있으면 레이 선택을 처리하고 true를 돌려준다(뷰어 입력 차단용).
     * @param {import('../core/types.js').XrInput} input
     */
    /**
     * 세션이 막 시작된 직후처럼 카메라가 아직 헤드셋 자세를 받기 전에는 패널을 바로 열면 엉뚱한 곳(바닥·뒤쪽)에 고정된다.
     * three는 첫 프레임의 그리기에서야 카메라를 헤드셋 자세로 갱신하므로, 몇 프레임 뒤에 연다.
     */
    openAfterPose() {
      pendingOpenFrames = OPEN_AFTER_FRAMES;
    },

    update(input) {
      if (!input.presenting) {
        pendingOpenFrames = 0;
        if (open) setOpen(false);
        surface.detach();
        mesh.material.visible = true;
        return false;
      }
      attachRays();
      if (pendingOpenFrames > 0 && --pendingOpenFrames === 0 && !open) setOpen(true);
      if (!shown()) {
        surface.sync(false);
        mesh.material.visible = true;
        return false;
      }

      // 스틱을 위(앞)로 밀면 위로, 아래(뒤)로 당기면 아래로. 누르고 있으면 일정 간격으로 반복한다.
      // 스틱 쪽 컨트롤러가 가리키는 칸을 넘긴다(왼쪽 트리 위를 가리키면 트리, 그 밖에는 파일 목록).
      const leftBigger = Math.abs(input.left.y) > Math.abs(input.right.y);
      const stick = leftBigger ? input.left.y : input.right.y;
      const pointerX = hitX[leftBigger ? "left" : "right"] ?? hitX[leftBigger ? "right" : "left"];
      const overTree = page === "list" && pointerX !== null && pointerX < layoutGeometry.LIST_X - COLUMN_GAP / 2;
      const now = performance.now();
      if (Math.abs(stick) > SCROLL_STICK) {
        if (!stickSince) stickSince = now;
        if (now - lastScrollAt > SCROLL_REPEAT_MS) {
          lastScrollAt = now;
          const step = SCROLL_ACCEL.find(([after]) => now - stickSince >= after)[1];
          if (overTree) treeScrollBy(stick > 0 ? step : -step);
          else scrollBy(stick > 0 ? step : -step);
        }
      } else {
        lastScrollAt = 0;
        stickSince = 0;
      }

      for (const side of /** @type {const} */ (["left", "right"])) {
        const button = pick(side);
        const key = button ? `${button.x},${button.y}` : null;
        if (hover[side] !== key) {
          hover[side] = key;
          dirty = true;
        }
        if (button && button.enabled && input[side].triggerPressed) {
          message = "";
          const result = button.run();
          if (result === "close") setOpen(false); // 버튼이 패널을 닫아 달라고 했다(예: 재생 컨트롤 불러오기)
          dirty = true;
        }
      }
      if (dirty) draw();
      // 레이어로 그렸으면 메시는 히트 테스트용으로만 두고 보이지 않게 한다. 못 그렸으면 메시가 보인다.
      mesh.material.visible = !surface.sync(true);
      return true;
    },
  };
}
