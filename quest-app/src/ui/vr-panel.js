// VR 안 패널: 캔버스 텍스처 평면 + 컨트롤러 레이 선택.
// B/Y로 열고 닫는다. 종류 필터·정렬, (PC) 폴더 이동, 스크롤되는 파일 목록, 이전/다음, 위치 초기화, VR 종료,
// 뷰어가 내놓는 panelActions 버튼을 보여 준다.
// 레이를 버튼에 맞추고 트리거를 누르면 선택된다. 스틱을 위·아래로 밀거나 ▲▼ 버튼으로 목록을 넘긴다.
// 목록이 수천 개여도 보이는 줄만 그리므로(가상 스크롤) 비용이 일정하다. 처음·끝·±100줄 점프 버튼과, 오래 밀수록 빨라지는 스틱 스크롤로 먼 곳까지 간다.
// 패널이 열려 있는 동안 뷰어에는 입력이 전달되지 않는다.
// 영역이 겹치지 않도록 위에서부터 쌓는다: 제목 → 필터·정렬·스크롤 → 폴더 줄 → 목록 → 동작 버튼(아래에 붙음).

import * as THREE from "three";
import { on } from "../core/events.js";
import { extensionOf, formatBytes } from "../core/kinds.js";
import { listSources } from "../core/registry.js";
import { dockCenter, dockRotation, panelYawOffset } from "../core/panel-layout.js";
import { JUMP_ROWS, KIND_FILTERS, SORTS, describeFolder, labelOf, nextValue } from "../core/list-view.js";

const W = 1024;
const H = 960;
const PLANE_W = 1.2;
const PLANE_H = PLANE_W * (H / W);
const DISTANCE = 1.25;
const UP = new THREE.Vector3(0, 1, 0);

const MARGIN = 40;
const ROW_H = 64; // 레이로 고르기 쉬운 크기(실제 약 7.5cm)
const ROW_STEP = 72;
const ACTION_H = 72;
const ACTION_STEP = 84;
const PER_ACTION_ROW = 4;
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

  /** @type {Array<{ x: number, y: number, w: number, h: number, label: string, run: () => void, enabled: boolean, current?: boolean, tag?: string, side?: string, folder?: boolean, align?: string }>} */
  let buttons = [];
  /** @type {{ left: string | null, right: string | null }} */
  const hover = { left: null, right: null };
  let open = false;
  /** openAfterPose 호출 뒤 남은 프레임 수(0이면 대기 없음) */
  let pendingOpenFrames = 0;
  const OPEN_AFTER_FRAMES = 4;
  /** 뷰어가 panelOptions()를 내놓으면 [옵션] 버튼으로 목록 대신 옵션 줄을 보여 준다. */
  let optionsOpen = false;
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
    const changed = open !== next;
    open = next;
    mesh.visible = open;
    if (open) {
      placeInFront();
      optionsOpen = false;
      followCurrent = true;
      dirty = true;
    }
    for (const line of Object.values(rayLines)) line.visible = open;
    if (changed) library.activeViewer?.onPanelToggle?.(open);
  }

  /**
   * 시선 방향(수평)으로 DISTANCE만큼 앞, 눈높이에 둔다. 열 때 한 번만 놓고 이후 조작(레이·스틱·트리거)으로는 움직이지 않는다.
   * 뷰어가 panelPlacement()를 내놓으면 그 값(옆으로 비키기 yawOffset, 거리)을 쓴다(PLY: 장면과 겹치지 않게 왼쪽 옆).
   */
  function placeInFront() {
    const camera = stage.camera;
    camera.getWorldPosition(tempVec);
    camera.getWorldDirection(tempDir);
    tempDir.y = 0;
    if (tempDir.lengthSq() < 0.001) tempDir.set(0, 0, -1);
    tempDir.normalize();
    const placement = library.activeViewer?.panelPlacement?.() ?? {};
    if (placement.dock) {
      // 영상·사진: 재생 컨트롤과 같은 도크 자리에 윗변을 맞춰 건다(스크린과 겹치지 않고 한 곳에서 조작).
      const { top, yaw, tilt, scale } = placement.dock;
      mesh.scale.setScalar(scale);
      mesh.rotation.copy(dockRotation(yaw, tilt));
      mesh.position.copy(dockCenter(top, yaw, tilt, PLANE_H * scale));
      return;
    }
    mesh.scale.setScalar(1);
    const distance = placement.distance ?? DISTANCE;
    let yawOffset = placement.yawOffset ?? 0;
    if (placement.avoidHalf !== undefined) {
      // 장면(avoidYaw 방향, 반폭 avoidHalf)의 바깥 가장자리 쪽으로 비켜 연다.
      yawOffset = panelYawOffset({ avoidYaw: placement.avoidYaw, avoidHalf: placement.avoidHalf, panelHalf: Math.atan(PLANE_W / 2 / distance) });
    }
    if (yawOffset) tempDir.applyAxisAngle(UP, yawOffset);
    mesh.position.copy(tempVec).addScaledVector(tempDir, distance);
    mesh.lookAt(tempVec.x, mesh.position.y, tempVec.z);
  }

  /** 목록에 보이는 줄: 하위 폴더, 프레임 시퀀스 폴더, 그다음 파일. */
  function entries() {
    const kind = library.view.kind;
    const sequences = kind === "video" || kind === "splat" ? [] : library.sequences;
    // 시퀀스 폴더가 둘 이상이면 「프레임 시퀀스 N곳」 한 줄로 접고, 누르면 펼친다(2D 목록과 같은 상태).
    const group = sequences.length >= 2 ? [{ type: "seqgroup", count: sequences.length }] : [];
    const shownSequences = sequences.length >= 2 && !library.sequencesExpanded ? [] : sequences;
    return [
      ...library.folders.map((folder) => ({ type: "dir", folder })),
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

    // 동작 버튼은 아래에 붙인다(개수가 늘어도 목록 쪽이 줄 뿐 겹치지 않는다).
    const optionRows = library.activeViewer?.panelOptions?.() ?? [];
    if (!optionRows.length) optionsOpen = false;
    const actions = [
      { label: "이전", run: () => library.prev(), enabled: library.playlist.length > 1 },
      { label: "다음", run: () => library.next(), enabled: library.playlist.length > 1 },
      ...(slideshow
        ? [
            { label: slideshow.running ? "슬라이드쇼 ■" : "슬라이드쇼 ▶", run: () => slideshow.toggle(), enabled: library.playlist.length > 1 || slideshow.running },
            { label: `간격 ${slideshow.interval}초`, run: () => slideshow.cycleInterval(), enabled: true },
          ]
        : []),
      { label: "위치 초기화", run: () => (library.activeViewer?.resetView ? library.activeViewer.resetView() : stage.resetPlayer()), enabled: true },
      { label: "VR 종료", run: () => stage.exitVR(), enabled: true },
      ...getActions().map((action) => ({ label: action.label, run: action.run, enabled: true })),
      ...(optionRows.length ? [{ label: optionsOpen ? "파일 목록" : "PLY 옵션", run: () => (optionsOpen = !optionsOpen), enabled: true }] : []),
    ];
    const actionRows = Math.ceil(actions.length / PER_ACTION_ROW);
    const actionsTop = H - 24 - actionRows * ACTION_STEP + (ACTION_STEP - ACTION_H);

    const gap = 16;
    if (optionsOpen) {
      // 옵션 화면: 큰 줄 하나씩. 눌러서 값을 바꾼다(값은 오른쪽에 보인다).
      const step = ROW_STEP + 8;
      optionRows.forEach((row, i) => {
        buttons.push({ x: MARGIN, y: 124 + i * step, w: W - MARGIN * 2, h: ROW_H + 8, label: row.label, side: row.side, run: row.run, enabled: true });
      });
      totalEntries = 0;
      placeActions();
      return { listTop: 124, actionsTop };
    }

    function placeActions() {
      actions.forEach((action, i) => {
        const perRowWidth = (W - MARGIN * 2 - gap * (PER_ACTION_ROW - 1)) / PER_ACTION_ROW;
        buttons.push({
          x: MARGIN + (i % PER_ACTION_ROW) * (perRowWidth + gap),
          y: actionsTop + Math.floor(i / PER_ACTION_ROW) * ACTION_STEP,
          w: perRowWidth,
          h: ACTION_H,
          align: "center",
          ...action,
        });
      });
    }

    // 소스 줄: 기기·보관함·PC·드라이브. VR 앱("SHARP VR")은 2D 탭이 없어 여기서 고른다.
    const sourceY = 124;
    const sources = listSources();
    const sourceW = (W - MARGIN * 2 - gap * (sources.length - 1)) / Math.max(1, sources.length);
    sources.forEach((source, i) => {
      buttons.push({
        x: MARGIN + i * (sourceW + gap),
        y: sourceY,
        w: sourceW,
        h: ROW_H,
        align: "center",
        label: source.label,
        run: () => library.setListSource(source.id),
        enabled: true,
        current: source.id === library.listSourceId,
      });
    });

    // 필터·정렬 줄
    const controlY = sourceY + ROW_STEP;
    const half = (W - MARGIN * 2 - gap) / 2;
    const controls = [
      { label: `종류: ${labelOf(KIND_FILTERS, view.kind)}`, run: () => library.setView({ kind: nextValue(KIND_FILTERS, view.kind) }), enabled: true },
      { label: `정렬: ${labelOf(SORTS, view.sort)}`, run: () => library.setView({ sort: nextValue(SORTS, view.sort) }), enabled: true },
    ];
    controls.forEach((control, i) => {
      buttons.push({ x: MARGIN + i * (half + gap), y: controlY, w: half, h: ROW_H, align: "center", ...control });
    });

    // 목록 넘기기 줄: 처음 · −100 · 위 · 아래 · +100 · 끝 (수천 개 목록의 먼 곳까지 가는 길)
    const navY = controlY + ROW_STEP;
    const navCount = 6;
    const navW = (W - MARGIN * 2 - gap * (navCount - 1)) / navCount;
    const atTop = scroll <= 0;
    const atEnd = scroll >= maxScroll();
    const nav = [
      { label: "⏮ 처음", run: () => scrollTo(0), enabled: !atTop },
      { label: `−${JUMP_ROWS}`, run: () => scrollBy(-JUMP_ROWS), enabled: !atTop },
      { label: "▲ 위", run: () => scrollBy(-(rowsVisible - 1)), enabled: !atTop },
      { label: "▼ 아래", run: () => scrollBy(rowsVisible - 1), enabled: !atEnd },
      { label: `+${JUMP_ROWS}`, run: () => scrollBy(JUMP_ROWS), enabled: !atEnd },
      { label: "⏭ 끝", run: () => scrollTo(Infinity), enabled: !atEnd },
    ];
    nav.forEach((control, i) => {
      buttons.push({ x: MARGIN + i * (navW + gap), y: navY, w: navW, h: ROW_H, align: "center", ...control });
    });

    // 폴더 줄(PC처럼 폴더가 있는 소스에서만)
    let listTop = navY + ROW_STEP + 8;
    if (library.canBrowse) {
      buttons.push({ x: MARGIN, y: listTop, w: 200, h: ROW_H, label: "⬆ 상위", run: () => library.upFolder(), enabled: !!library.folder, align: "center" });
      buttons.push({ x: MARGIN + 216, y: listTop, w: 160, h: ROW_H, label: "최근", run: () => library.openFolder(""), enabled: !!library.folder, align: "center" });
      listTop += ROW_STEP + 8;
    }

    rowsVisible = Math.max(1, Math.floor((actionsTop - 12 - listTop) / ROW_STEP));
    if (library.folder !== lastFolder) {
      lastFolder = library.folder;
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
      const y = listTop + row * ROW_STEP;
      if (entry.type === "dir") {
        buttons.push({
          x: MARGIN,
          y,
          w: W - MARGIN * 2,
          h: ROW_H,
          label: entry.folder.name,
          tag: "dir",
          side: "열기 ›",
          folder: true,
          run: () => library.openFolder(entry.folder.path),
          enabled: true,
        });
        return;
      }
      if (entry.type === "seqgroup") {
        buttons.push({
          x: MARGIN,
          y,
          w: W - MARGIN * 2,
          h: ROW_H,
          label: `프레임 시퀀스 ${entry.count}곳`,
          tag: "seq",
          side: library.sequencesExpanded ? "접기 ▾" : "펼치기 ▸",
          folder: true,
          run: () => library.toggleSequences(),
          enabled: true,
        });
        return;
      }
      if (entry.type === "seq") {
        const { sequence } = entry;
        buttons.push({
          x: MARGIN,
          y,
          w: W - MARGIN * 2,
          h: ROW_H,
          label: sequence.name,
          tag: "seq",
          side: `${Number(sequence.count).toLocaleString("ko-KR")}장`,
          folder: true,
          run: () => library.openFolder(sequence.path),
          enabled: true,
        });
        return;
      }
      const { item } = entry;
      const isCurrent = !!current && item.id === current.id;
      buttons.push({
        x: MARGIN,
        y,
        w: W - MARGIN * 2,
        h: ROW_H,
        label: `${isCurrent ? "▶ " : ""}${item.name}`,
        tag: item.kind,
        side: [extensionOf(item.name).toUpperCase(), formatBytes(item.size ?? NaN)].filter(Boolean).join(" · "),
        run: () => library.open(item, { playlist: library.items }),
        enabled: library.canOpen(item),
        current: isCurrent,
      });
    });

    placeActions();
    return { listTop, actionsTop };
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
    const position = optionsOpen ? "PLY 옵션" : totalEntries ? `${first}–${last} / ${totalEntries}` : "0개";
    ctx.font = `28px ${FONT}`;
    const positionWidth = ctx.measureText(position).width;
    ctx.fillStyle = COLORS.text;
    ctx.font = `600 38px ${FONT}`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText(fit(current ? current.name : "열린 파일 없음", W - MARGIN * 2 - positionWidth - 24), MARGIN, 50);
    ctx.font = `28px ${FONT}`;
    ctx.fillStyle = COLORS.muted;
    ctx.textAlign = "right";
    ctx.fillText(position, W - MARGIN, 50);
    ctx.textAlign = "left";
    ctx.font = `25px ${FONT}`;
    ctx.fillText(fit(message || "스틱 위·아래: 넘기기   X/A: 이전·다음   B/Y: 닫기   트리거: 선택", W - MARGIN * 2), MARGIN, 94);

    if (library.canBrowse && !optionsOpen) {
      ctx.fillStyle = COLORS.muted;
      ctx.font = `26px ${FONT}`;
      ctx.textAlign = "left";
      const pathX = MARGIN + 216 + 160 + 20;
      const rowY = 124 + ROW_STEP * 3 + 8 + ROW_H / 2;
      ctx.fillText(fitStart(describeFolder(library.folder), W - MARGIN - pathX), pathX, rowY);
    }
    if (!totalEntries && !optionsOpen) {
      ctx.fillStyle = COLORS.muted;
      ctx.font = `28px ${FONT}`;
      ctx.textAlign = "center";
      const empty = library.allItems.length
        ? "이 종류의 파일이 없습니다"
        : library.listSourceId === "session"
          ? "VR에서는 기기 파일을 고를 수 없습니다. 'SHARP 뷰어'(2D)에서 열거나 보관함을 쓰세요"
          : "표시할 파일이 없습니다";
      ctx.fillText(fit(empty, W - MARGIN * 2), W / 2, listTop + ROW_H / 2);
    }

    for (const button of buttons) {
      const key = `${button.x},${button.y}`;
      const hovered = hover.left === key || hover.right === key;
      ctx.fillStyle = !button.enabled
        ? COLORS.disabled
        : hovered
          ? COLORS.hover
          : button.current
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
      if (button.align === "center") {
        ctx.fillStyle = button.enabled ? COLORS.text : COLORS.muted;
        ctx.font = `30px ${FONT}`;
        ctx.textAlign = "center";
        ctx.fillText(fit(button.label, button.w - 24), button.x + button.w / 2, cy);
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
      ctx.font = `30px ${FONT}`;
      ctx.fillStyle = button.enabled ? COLORS.text : COLORS.muted;
      ctx.textAlign = "left";
      ctx.fillText(fit(button.label, button.x + button.w - 20 - sideWidth - 16 - textX), textX, cy);
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
    if (!hit?.uv) return null;
    const px = hit.uv.x * W;
    const py = (1 - hit.uv.y) * H;
    return buttons.find((b) => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) ?? null;
  }

  // 상태 문구(PC 연결 중·오류 등)를 VR 안에서도 볼 수 있게 제목 아래 줄에 보인다.
  on("app:status", ({ text }) => {
    message = text ?? "";
    dirty = true;
  });

  // 목록·현재 항목이 바뀌면 다시 그린다. 항목이 새로 열리면 목록을 그 항목 쪽으로 맞춘다.
  for (const name of ["library:changed", "item:opened", "item:loading", "item:error", "item:closed", "slideshow:changed"]) {
    on(name, () => {
      if (name === "item:opened") followCurrent = true;
      dirty = true;
    });
  }

  return {
    get isOpen() {
      return open;
    },
    toggle: () => setOpen(!open),
    /** [PLY 옵션] 화면 보기·끄기(검증용으로도 열어 둔다). */
    get optionsOpen() {
      return optionsOpen;
    },
    setOptionsOpen(next) {
      optionsOpen = !!next;
      dirty = true;
    },
    close: () => setOpen(false),
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
    get scrollState() {
      return { scroll, rowsVisible, total: totalEntries };
    },

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
        return false;
      }
      attachRays();
      if (pendingOpenFrames > 0 && --pendingOpenFrames === 0 && !open) setOpen(true);
      if (input.left.secondaryPressed || input.right.secondaryPressed) setOpen(!open);
      if (!open) return false;

      // 스틱을 위(앞)로 밀면 위로, 아래(뒤)로 당기면 아래로. 누르고 있으면 일정 간격으로 반복한다.
      const stick = Math.abs(input.left.y) > Math.abs(input.right.y) ? input.left.y : input.right.y;
      const now = performance.now();
      if (Math.abs(stick) > SCROLL_STICK) {
        if (!stickSince) stickSince = now;
        if (now - lastScrollAt > SCROLL_REPEAT_MS) {
          lastScrollAt = now;
          const step = SCROLL_ACCEL.find(([after]) => now - stickSince >= after)[1];
          scrollBy(stick > 0 ? step : -step);
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
      return true;
    },
  };
}
