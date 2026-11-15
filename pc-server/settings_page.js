"use strict";
// SHARP PC 서버 관리 창. 토큰은 주소의 ?t= 로 받아 모든 API 요청 헤더(X-Admin-Token)에 싣는다.
// 화면은 주소의 # 뒤(#home, #folders, #options, #options/buttons, #help)로 바꾼다.
(() => {
  const token = new URLSearchParams(location.search).get("t") || "";
  const $ = (id) => document.getElementById(id);
  const SVG_NS = "http://www.w3.org/2000/svg";
  const TITLE = "SHARP PC 서버 관리"; // 트레이 앱이 이 제목으로 열린 관리 창을 찾는다
  const OFFLINE = "앱과 연결할 수 없습니다. 앱이 켜져 있는지 확인하세요.";
  let state = null;
  let busy = false;
  let online = true;
  let quitted = false;
  let view = "home";
  const seen = { status: "", addresses: "", folders: "" }; // 바뀐 부분만 다시 그린다(포커스·열린 메뉴 유지)

  // ---------------------------------------------------------------- 도구
  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? "" : value);
    }
    for (const child of children) if (child) node.append(child);
    return node;
  }

  function icon(name) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "ic");
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS(SVG_NS, "use");
    use.setAttribute("href", "#i-" + name);
    svg.append(use);
    return svg;
  }

  function toast(message, bad = false) {
    const box = $("toast");
    box.textContent = message;
    box.className = "toast show" + (bad ? " bad" : "");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => (box.className = "toast"), bad ? 6000 : 2600);
  }

  // 확인 창. buttons: [{label, value, kind}] — Esc나 바깥 닫기는 "cancel".
  function ask({ title, body, buttons }) {
    return new Promise((resolve) => {
      const dialog = $("dialog");
      $("dialog-title").textContent = title;
      $("dialog-body").textContent = body;
      const bar = $("dialog-bar");
      bar.replaceChildren(...buttons.map((b) => el("button", { class: b.kind || "", text: b.label, onclick: () => dialog.close(b.value) })));
      dialog.returnValue = "";
      dialog.onclose = () => resolve(dialog.returnValue || "cancel");
      dialog.showModal();
      bar.firstElementChild.focus(); // 첫 버튼은 늘 안전한 쪽(취소)
    });
  }

  async function request(path, body) {
    const options = { headers: { "X-Admin-Token": token } };
    if (body !== undefined) {
      options.method = "POST";
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }
    const response = await fetch(path, options);
    const data = await response.json().catch(() => ({ ok: false, error: "" }));
    if (data && data.folders) render(data);
    return { status: response.status, ok: response.ok && data.ok === true, data };
  }

  // 서버가 준 한국어 안내는 그대로, 영어 내부 메시지는 사람 말로 바꾼다.
  function explain(result) {
    if (result.status === 403) return "이 창의 연결 정보가 오래됐습니다. 창을 닫고 화면 오른쪽 아래 아이콘에서 다시 열어 주세요.";
    const text = (result.data && result.data.error) || "";
    if (/[가-힣]/.test(text)) return text;
    return `요청을 처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요. (코드 ${result.status})`;
  }

  async function act(path, body, success) {
    if (busy) return null;
    busy = true;
    try {
      const result = await request(path, body);
      if (!result.ok) {
        toast(explain(result), true);
        return null;
      }
      if (success && !result.data.cancelled) toast(success);
      return result.data;
    } catch {
      toast(OFFLINE, true);
      return null;
    } finally {
      busy = false;
    }
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = el("textarea", { style: "position:fixed;left:-999px" });
      area.value = text;
      document.body.append(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    toast("주소를 복사했습니다.");
  }

  // ---------------------------------------------------------------- 화면 전환
  const ROUTES = { home: "home", folders: "folders", options: "options", "options/buttons": "buttons", help: "help" };

  function route() {
    view = ROUTES[location.hash.replace(/^#/, "")] || "home";
    for (const node of document.querySelectorAll(".view")) node.hidden = node.id !== "view-" + view;
    const current = view === "buttons" ? "options" : view;
    for (const link of document.querySelectorAll("nav a")) {
      if (link.dataset.nav === current) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
    window.scrollTo(0, 0);
    if (view === "buttons" || view === "options") loadBindings();
  }

  // ---------------------------------------------------------------- 상태
  function currentStatus() {
    if (quitted) return { level: "", icon: "power", short: "끝냄", title: "앱을 끝냈습니다", sub: "이 창은 닫아도 됩니다. 다시 쓰려면 시작 메뉴에서 SHARP PC 서버를 실행하세요." };
    if (!online) return { level: "bad", icon: "warn", short: "연결 끊김", title: "앱과 연결이 끊겼어요", sub: "앱이 꺼졌다면 시작 메뉴에서 SHARP PC 서버를 다시 실행해 주세요." };
    if (!state) return { level: "", icon: "info", short: "확인하는 중…", title: "상태를 확인하는 중…", sub: "" };
    const server = state.server;
    if (server.state === "error") return { level: "bad", icon: "warn", short: "서버 꺼짐", title: "서버를 켜지 못했어요", sub: server.error || "다시 시작해 보세요.", actions: ["restart", "port"] };
    if (server.state !== "running") return { level: "warn", icon: "warn", short: "서버 꺼짐", title: "서버가 꺼져 있어요", sub: "다시 시작하면 Quest에서 연결할 수 있습니다.", actions: ["restart"] };
    if (!server.urls.length) return { level: "warn", icon: "warn", short: "네트워크 없음", title: "네트워크에 연결되어 있지 않아요", sub: "이 PC의 Wi-Fi나 랜선 연결을 확인하세요. 연결되면 자동으로 바뀝니다." };
    if (!state.folders.some((f) => f.exists !== false)) return { level: "warn", icon: "folder", short: "폴더 없음", title: "공유할 폴더를 추가해 주세요", sub: "Quest에서 볼 영상·사진·3D 파일이 든 폴더를 고르세요.", actions: ["add"] };
    return { level: "ok", icon: "check", short: "실행 중", title: "Quest에서 볼 준비가 됐어요", sub: "같은 Wi-Fi에 있는 Quest의 [PC] 탭에 이 PC가 나타납니다." };
  }

  const HERO_ACTIONS = {
    restart: () => el("button", { class: "primary", text: "다시 시작", onclick: restart }),
    port: () => el("a", { class: "btn", href: "#options", text: "포트 바꾸기" }),
    add: () => el("button", { class: "primary", onclick: chooseFolders }, icon("plus"), "폴더 추가"),
  };

  function renderStatus() {
    const status = currentStatus();
    const signature = JSON.stringify(status);
    if (signature === seen.status) return;
    seen.status = signature;
    const dot = { ok: "ok", warn: "warn", bad: "bad" }[status.level] || "";
    $("side-dot").className = "dot " + dot;
    $("side-status").textContent = status.short;
    $("hero").className = "card hero " + status.level;
    $("hero-icon").setAttribute("href", "#i-" + status.icon);
    $("hero-title").textContent = status.title;
    $("hero-sub").textContent = status.sub;
    $("hero-actions").replaceChildren(...(status.actions || []).map((name) => HERO_ACTIONS[name]()));
    $("offline").hidden = online || quitted;
  }

  function addressRow(url) {
    return el("div", { class: "addr" }, el("code", { text: url }), el("button", { onclick: () => copy(url) }, icon("copy"), "주소 복사"));
  }

  function renderAddresses() {
    const server = state.server;
    const urls = server.state === "running" ? server.urls : [];
    const signature = server.state + "|" + urls.join("|");
    if (signature === seen.addresses) return;
    seen.addresses = signature;
    const box = $("addresses");
    box.replaceChildren();
    if (server.state !== "running") {
      box.append(el("p", { class: "muted", text: "서버가 켜지면 주소가 나타납니다." }));
    } else if (!urls.length) {
      box.append(el("div", { class: "note warn" }, icon("warn"), el("span", { text: "주소를 찾지 못했습니다. Wi-Fi나 랜선 연결을 확인하세요." })));
    } else {
      box.append(addressRow(urls[0]));
      if (urls.length > 1) {
        const more = el("details", { class: "addr-more", style: "margin-top: 8px" }, el("summary", { text: `다른 주소 ${urls.length - 1}개 보기` }),
          el("p", { class: "muted small", text: "PC에 네트워크 연결이 여러 개일 때 나타납니다. 위 주소로 안 되면 아래 주소를 써 보세요." }));
        for (const url of urls.slice(1)) more.append(addressRow(url));
        box.append(more);
      }
    }
  }

  // ---------------------------------------------------------------- 공유 폴더
  const KINDS = [["video", "영상"], ["photo", "사진"], ["ply", "3D"]];

  function folderName(path) {
    const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/);
    const last = parts[parts.length - 1];
    return parts.length > 1 && last ? last : path;
  }

  function folderChips(folder) {
    const chips = el("div", { class: "chips" });
    if (folder.exists === false || folder.scanStatus === "unavailable") {
      chips.append(el("span", { class: "chip warn", text: "찾을 수 없음" }));
    } else if (!folder.counts) {
      chips.append(el("span", { class: "chip plain", text: "파일을 세는 중…" }));
    } else {
      const more = folder.counts.truncated ? "+" : "";
      for (const [key, label] of KINDS) {
        if (folder.counts[key] > 0) chips.append(el("span", { class: "chip", text: `${label} ${folder.counts[key].toLocaleString("ko-KR")}${more}` }));
      }
      if (folder.counts.truncated) chips.append(el("span", { class: "chip plain", text: chips.children.length ? "파일이 많아 일부만 셌습니다" : "파일이 많아 다 세지 못했습니다" }));
      else if (!chips.children.length) chips.append(el("span", { class: "chip plain", text: "볼 수 있는 파일이 아직 없습니다" }));
    }
    return chips;
  }

  async function removeFolder(folder) {
    const name = folderName(folder.path);
    const answer = await ask({
      title: `“${name}” 폴더를 목록에서 뺄까요?`,
      body: "Quest에서 이 폴더가 보이지 않게 됩니다.\nPC에 있는 폴더와 파일은 지워지지 않습니다.",
      buttons: [{ label: "취소", value: "cancel" }, { label: "목록에서 빼기", value: "ok", kind: "danger-fill" }],
    });
    if (answer !== "ok") return;
    $("add-result").replaceChildren();
    await act("/api/admin/folders/remove", { path: folder.path }, `“${name}” 폴더를 목록에서 뺐습니다.`);
  }

  function folderRow(folder) {
    const missing = folder.exists === false;
    const name = el("div", { class: "folder-name" }, el("span", { text: folderName(folder.path) }));
    if (folder.kind === "default") name.append(el("span", { class: "tag", text: "기본 폴더" }));
    if (folder.kind === "session") name.append(el("span", { class: "tag", text: "이번 실행에서만" }));
    const actions = el("div", { class: "folder-actions" },
      el("button", { disabled: !folder.canOpen, title: "Windows 탐색기에서 이 폴더를 엽니다", onclick: () => act("/api/admin/folders/open", { path: folder.path }) }, icon("open"), "열기"));
    if (folder.removable) actions.append(el("button", { class: "danger", onclick: () => removeFolder(folder) }, icon("remove"), "빼기"));
    return el("div", { class: "folder" + (missing ? " missing" : "") },
      el("div", { class: "folder-ic" }, icon(missing ? "warn" : "folder")),
      el("div", {}, name, el("div", { class: "folder-path", text: folder.path }), folderChips(folder)),
      actions);
  }

  function renderFolders() {
    const folders = state.folders;
    const signature = JSON.stringify(folders);
    if (signature === seen.folders) return;
    seen.folders = signature;

    const list = $("folders");
    if (!folders.length) {
      list.replaceChildren(el("div", { class: "empty" }, el("div", { class: "folder-ic" }, icon("folder")), el("h2", { text: "아직 공유 폴더가 없습니다" }),
        el("p", { class: "muted", text: "Quest에서 볼 영상·사진·3D 파일이 든 폴더를 추가하세요." }),
        el("button", { class: "primary", onclick: chooseFolders }, icon("plus"), "폴더 추가")));
    } else {
      list.replaceChildren(...folders.map(folderRow));
    }

    const note = $("folders-note");
    note.replaceChildren();
    if (folders.some((f) => f.exists === false)) {
      note.append(el("div", { class: "note warn" }, icon("warn"),
        el("span", { class: "grow", text: "찾을 수 없는 폴더는 Quest에 보이지 않습니다. 외장 드라이브나 네트워크 폴더라면 연결한 뒤 서버를 다시 시작하세요." }),
        el("button", { text: "서버 다시 시작", onclick: restart })));
    } else if (folders.some((f) => f.kind === "default")) {
      note.append(el("div", { class: "note" }, icon("info"), el("span", { text: "기본 폴더는 처음 쓸 때 자동으로 만들어진 폴더입니다. 다른 폴더를 추가하면 목록에서 빠집니다." })));
    }

    // 홈의 요약과 1단계
    const own = folders.filter((f) => f.kind !== "default" && f.exists !== false);
    const total = { video: 0, photo: 0, ply: 0 };
    for (const f of folders) if (f.counts) for (const [key] of KINDS) total[key] += f.counts[key] || 0;
    const parts = [`폴더 ${folders.length}개`];
    for (const [key, label] of KINDS) if (total[key]) parts.push(`${label} ${total[key].toLocaleString("ko-KR")}`);
    const lost = folders.filter((f) => f.exists === false).length;
    if (lost) parts.push(`찾을 수 없는 폴더 ${lost}개`);
    $("home-folders").textContent = folders.length ? parts.join(" · ") : "아직 없습니다.";
    $("step-folder").className = own.length ? "done" : "";
    $("step-folder-num").replaceChildren(own.length ? icon("check") : "1");
    $("step-folder-text").textContent = own.length
      ? `폴더 ${own.length}개를 공유하고 있습니다. [공유 폴더]에서 더 추가하거나 뺄 수 있습니다.`
      : "영상·사진·3D(PLY) 파일이 든 폴더를 추가하세요. 여러 개를 한 번에 고를 수 있습니다.";
    $("step-add").hidden = own.length > 0;
  }

  const RESULT_TEXT = {
    added: "추가했습니다",
    duplicate: "이미 목록에 있습니다",
    overlap: "이미 공유 중인 폴더와 겹칩니다(한 폴더가 다른 폴더 안에 있음)",
    missing: "폴더를 찾을 수 없습니다",
    invalid: "쓸 수 없는 경로입니다",
  };

  function showAddResult(results) {
    const box = $("add-result");
    box.replaceChildren();
    if (!results.length) return;
    const added = results.filter((r) => r.status === "added").length;
    const failed = results.length - added;
    const headline = !failed ? `폴더 ${added}개를 추가했습니다.` : added ? `폴더 ${added}개를 추가했고, ${failed}개는 추가하지 않았습니다.` : results.length === 1 ? "폴더를 추가하지 않았습니다." : `고른 폴더 ${failed}개를 추가하지 않았습니다.`;
    const body = el("div", { class: "grow" }, el("b", { text: headline }));
    if (failed || results.length > 1) {
      const list = el("ul");
      for (const r of results) list.append(el("li", {}, el("b", { text: folderName(String(r.path).trim() || "(빈 줄)") }), ` — ${RESULT_TEXT[r.status] || "추가하지 못했습니다"}`));
      body.append(list);
    }
    box.append(el("div", { class: "note " + (failed ? "warn" : "ok") }, icon(failed ? "warn" : "check"), body,
      el("button", { class: "ghost", text: "닫기", onclick: () => box.replaceChildren() })));
  }

  async function chooseFolders() {
    if (busy) return;
    toast("폴더 고르는 창을 열었습니다. Ctrl이나 Shift를 누른 채 여러 폴더를 고를 수 있습니다.");
    const data = await act("/api/admin/folders/choose", {});
    if (!data || data.cancelled) return;
    showAddResult(data.results || []);
    if (view !== "folders") location.hash = "#folders";
  }

  async function addTypedPaths() {
    const input = $("folder-paths");
    const paths = input.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!paths.length) {
      toast("폴더 경로를 적어 주세요.", true);
      input.focus();
      return;
    }
    const data = await act("/api/admin/folders/add-many", { paths });
    if (!data) return;
    const results = data.results || [];
    showAddResult(results);
    input.value = results.filter((r) => r.status !== "added" && r.status !== "duplicate").map((r) => r.path).join("\n"); // 안 된 줄만 남겨 고치게 한다
  }

  // ---------------------------------------------------------------- 옵션
  async function restart() {
    const data = await act("/api/admin/restart", {});
    if (!data) return;
    if (data.server.state === "running") toast("서버를 다시 시작했습니다.");
    else toast("서버를 켜지 못했습니다. 홈에서 이유를 확인하세요.", true);
  }

  async function applyPort() {
    if (busy) return;
    const input = $("port");
    const error = $("port-error");
    error.hidden = true;
    busy = true;
    try {
      const result = await request("/api/admin/settings", { port: input.value });
      if (result.ok) {
        input.value = result.data.server.port;
        toast(`포트 번호를 ${result.data.server.port}번으로 바꿨습니다.`);
      } else {
        error.textContent = explain(result);
        error.hidden = false;
        input.focus();
      }
    } catch {
      toast(OFFLINE, true);
    } finally {
      busy = false;
    }
  }

  function renderOptions() {
    const version = state.version ? `v${state.version}` : "";
    $("version").textContent = version;
    $("version-2").textContent = version;
    $("version-3").textContent = version || "알 수 없음";
    $("default-port").textContent = state.defaultPort;
    if (document.activeElement !== $("port")) $("port").value = state.server.port || state.settings.port;
    $("autostart").checked = state.settings.autostart;
    $("open-on-start").checked = state.settings.openWindowOnStart;
    $("data-dir").textContent = state.dataDir ? `설정 저장 위치: ${state.dataDir}` : "";
    $("probe-note").hidden = !state.server.probe;
  }

  function render(next) {
    state = next;
    online = true;
    document.title = TITLE;
    renderStatus();
    renderAddresses();
    renderFolders();
    renderOptions();
  }

  async function refresh() {
    if (busy || quitted) return;
    try {
      const result = await request("/api/admin/state");
      if (!result.ok) throw new Error("state");
      if (view === "buttons" && bind.ready && !bindDirty() && !$("dialog").open) loadBindings(); // Quest에서 바꾼 설정을 따라간다
    } catch {
      online = false;
      document.title = "SHARP PC 서버 (연결 끊김)";
      renderStatus();
    }
  }

  // ---------------------------------------------------------------- 조이스틱 버튼 설정
  const bind = { ready: false, loading: false, saving: false, slots: [], actions: [], defaults: {}, loaded: null, draft: null };
  const PAD_SIDES = [["왼쪽 컨트롤러", ["X", "Y", "menu"]], ["오른쪽 컨트롤러", ["A", "B"]]];
  const PAD_KEYS = { A: ["A", "A 버튼"], B: ["B", "B 버튼"], X: ["X", "X 버튼"], Y: ["Y", "Y 버튼"], menu: ["≡", "메뉴 버튼"] };
  const PRESS = { short: "짧게 누르기", long: "길게 누르기" };
  const ACTION_GROUPS = [
    ["화면·메뉴", ["ui.toggle", "ui.move", "list.toggle", "passthrough.toggle", "hud.toggle"]],
    ["파일 넘기기", ["nav.prev", "nav.next", "slideshow.toggle"]],
    ["영상 재생", ["hud:play", "hud:back10", "hud:fwd10", "hud:mute", "hud:loop"]],
    ["화면 조정", ["hud:layout", "hud:screenCurve", "hud:swapEyes", "hud:recenter", "hud:zoomIn", "hud:zoomOut"]],
    ["3D(PLY)", ["hud:fitView", "hud:quality"]],
  ];
  const REQUIRED = "ui.toggle"; // 이 동작이 어느 버튼에도 없으면 Quest 앱이 설정을 받지 않는다

  const sameBindings = (a, b) => bind.slots.every((slot) => (a[slot.id] || "") === (b[slot.id] || ""));
  const bindDirty = () => bind.ready && !sameBindings(bind.draft, bind.loaded.bindings);

  function buildSelect(slot) {
    const select = el("select", { "data-slot": slot.id, "aria-label": slot.label });
    const labels = new Map(bind.actions.map((a) => [a.id, a.label]));
    select.append(el("option", { value: "", text: labels.get("") || "없음" }));
    const used = new Set([""]);
    for (const [title, ids] of ACTION_GROUPS) {
      const group = el("optgroup", { label: title });
      for (const id of ids) {
        if (!labels.has(id)) continue;
        used.add(id);
        group.append(el("option", { value: id, text: labels.get(id) }));
      }
      if (group.children.length) select.append(group);
    }
    const rest = bind.actions.filter((a) => !used.has(a.id));
    if (rest.length) select.append(el("optgroup", { label: "그 밖의 동작" }, ...rest.map((a) => el("option", { value: a.id, text: a.label }))));
    select.addEventListener("change", () => {
      bind.draft[slot.id] = select.value;
      renderBindStatus();
    });
    return select;
  }

  function padKey(key) {
    return document.querySelector(`.pad .key[data-key="${key}"]`);
  }

  function buildBindRows() {
    const byKey = new Map();
    for (const slot of bind.slots) {
      const [key, press] = slot.id.split(".");
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push({ slot, press });
    }
    const list = $("bind-list");
    list.replaceChildren();
    const sides = PAD_SIDES.map(([title, keys]) => [title, keys.filter((key) => byKey.has(key))]);
    const known = new Set(PAD_SIDES.flatMap(([, keys]) => keys));
    sides.push(["그 밖의 버튼", [...byKey.keys()].filter((key) => !known.has(key))]);
    for (const [title, keys] of sides) {
      if (!keys.length) continue;
      const group = el("div", { class: "bind-group", role: "group", "aria-label": title }, el("h3", { text: title }));
      for (const key of keys) {
        const [cap, name] = PAD_KEYS[key] || [key.slice(0, 2), key];
        const row = el("div", { class: "bind", id: "bind-row-" + key }, el("div", { class: "bind-key" }, el("span", { class: "keycap", text: cap, "aria-hidden": "true" }), name));
        for (const { slot, press } of byKey.get(key)) row.append(el("label", {}, PRESS[press] || slot.label, buildSelect(slot)));
        row.addEventListener("focusin", () => {
          row.classList.add("on");
          if (padKey(key)) padKey(key).classList.add("on");
        });
        row.addEventListener("focusout", () => {
          row.classList.remove("on");
          if (padKey(key)) padKey(key).classList.remove("on");
        });
        group.append(row);
      }
      list.append(group);
    }
  }

  function syncSelects() {
    for (const select of document.querySelectorAll("#bind-list select")) {
      const value = bind.draft[select.dataset.slot] || "";
      select.value = value;
      if (select.value !== value) {
        // 이 PC 버전이 모르는 동작(새 Quest 앱이 저장한 값)도 지우지 않고 그대로 보여 준다
        select.append(el("option", { value, text: `알 수 없는 동작 (${value})` }));
        select.value = value;
      }
    }
  }

  function renderBindStatus() {
    const save = $("bind-save");
    const reset = $("bind-reset");
    const text = $("bind-status");
    if (!bind.ready) {
      text.textContent = bind.loading ? "설정을 불러오는 중…" : "";
      save.disabled = reset.disabled = true;
      return;
    }
    const valid = Object.values(bind.draft).includes(REQUIRED);
    const dirty = bindDirty();
    const label = (bind.actions.find((a) => a.id === REQUIRED) || {}).label || "UI 켜기·끄기";
    $("savebar").classList.toggle("bad", !valid);
    text.textContent = !valid
      ? `‘${label}’를 버튼 하나에는 꼭 지정해야 저장할 수 있습니다. 이 동작이 없으면 Quest에서 메뉴를 다시 열 수 없습니다.`
      : dirty ? "저장하지 않은 변경이 있습니다."
      : sameBindings(bind.loaded.bindings, bind.defaults) ? "기본값을 쓰고 있습니다." : "저장되어 있습니다.";
    save.disabled = !valid || !dirty || bind.saving;
    reset.disabled = bind.saving || (sameBindings(bind.loaded.bindings, bind.defaults) && !dirty);
    $("bindings-summary").textContent = sameBindings(bind.loaded.bindings, bind.defaults)
      ? "컨트롤러의 A·B·X·Y·메뉴 버튼에 동작을 지정합니다. 지금은 기본값입니다."
      : "컨트롤러의 A·B·X·Y·메뉴 버튼에 동작을 지정합니다. 직접 바꾼 설정을 쓰고 있습니다.";
  }

  function adopt(record) {
    bind.loaded = record;
    bind.draft = { ...record.bindings };
    syncSelects();
    renderBindStatus();
  }

  async function loadBindings() {
    if (bind.loading || bind.saving || bindDirty()) return; // 고치던 내용은 덮어쓰지 않는다
    bind.loading = true;
    renderBindStatus();
    try {
      const result = await request("/api/admin/bindings");
      if (!result.ok) throw new Error(explain(result));
      if (bindDirty()) return;
      if (!bind.ready) {
        bind.slots = result.data.slots;
        bind.actions = result.data.actions;
        bind.defaults = result.data.defaults;
        buildBindRows();
        bind.ready = true;
      }
      $("bind-load").hidden = true;
      adopt(result.data.record);
    } catch (error) {
      if (!bind.ready) {
        $("bind-load-text").textContent = "버튼 설정을 불러오지 못했습니다. " + (error instanceof TypeError ? OFFLINE : error.message);
        $("bind-load").hidden = false;
      }
    } finally {
      bind.loading = false;
      renderBindStatus();
    }
  }

  async function resolveConflict(current, retry, mineLabel) {
    const answer = await ask({
      title: "Quest에서 버튼 설정을 더 최근에 바꿨습니다",
      body: "Quest에서 바꾼 설정을 불러올지, 이 화면의 설정으로 덮어쓸지 고르세요.",
      buttons: [{ label: "취소", value: "cancel", kind: "ghost" }, { label: "Quest 설정 불러오기", value: "theirs" }, { label: mineLabel, value: "mine", kind: "primary" }],
    });
    if (answer === "theirs") {
      adopt(current);
      toast("Quest에서 바꾼 설정을 불러왔습니다.");
    } else if (answer === "mine") {
      await retry();
    }
  }

  // 저장·되돌리기 공통: 409(저장된 설정이 더 최신)면 어느 쪽을 살릴지 묻는다.
  async function sendBindings(path, body, done, mineLabel, force = false) {
    if (bind.saving) return;
    bind.saving = true;
    renderBindStatus();
    let conflict = null;
    try {
      if (!force) {
        // 이 화면을 연 뒤 Quest에서 바꾼 것이 있으면 덮어쓰기 전에 알린다
        const latest = await request("/api/admin/bindings");
        if (latest.ok && latest.data.record.updatedAt !== bind.loaded.updatedAt && !sameBindings(latest.data.record.bindings, bind.loaded.bindings)) conflict = latest.data.record;
      }
      if (!conflict) {
        const result = await request(path, force ? { ...body, force: true } : body);
        if (result.status === 409 && result.data.current) conflict = result.data.current;
        else if (!result.ok) toast(explain(result), true);
        else done(result.data.record);
      }
    } catch {
      toast(OFFLINE, true);
    } finally {
      bind.saving = false;
      renderBindStatus();
    }
    if (conflict) await resolveConflict(conflict, () => sendBindings(path, body, done, mineLabel, true), mineLabel);
  }

  function saveBindings() {
    if (!bindDirty() || !Object.values(bind.draft).includes(REQUIRED)) return;
    return sendBindings("/api/admin/bindings/save", { bindings: { ...bind.draft } }, (record) => {
      bind.loaded = record;
      toast("저장했습니다. Quest 앱이 PC에 연결되거나 다시 켜질 때 적용됩니다.");
    }, "이 화면 설정으로 저장");
  }

  async function resetBindings() {
    const answer = await ask({
      title: "버튼 설정을 기본값으로 되돌릴까요?",
      body: "지금 저장된 설정과 이 화면에서 고친 내용이 모두 기본값으로 바뀝니다.",
      buttons: [{ label: "취소", value: "cancel" }, { label: "기본값으로 되돌리기", value: "ok", kind: "primary" }],
    });
    if (answer !== "ok") return;
    await sendBindings("/api/admin/bindings/reset", {}, (record) => {
      adopt(record);
      toast("기본값으로 되돌렸습니다.");
    }, "기본값으로 덮어쓰기");
  }

  function jumpToKey(key) {
    const row = $("bind-row-" + key);
    if (!row) return;
    row.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    const select = row.querySelector("select");
    if (select) select.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------- 이벤트
  $("add-folder").addEventListener("click", chooseFolders);
  $("step-add").addEventListener("click", chooseFolders);
  $("add-paths").addEventListener("click", addTypedPaths);
  $("restart").addEventListener("click", restart);
  $("apply-port").addEventListener("click", applyPort);
  $("port").addEventListener("keydown", (event) => {
    if (event.key === "Enter") applyPort();
  });
  $("port").addEventListener("input", () => ($("port-error").hidden = true));
  $("autostart").addEventListener("change", async (event) => {
    const data = await act("/api/admin/settings", { autostart: event.target.checked }, event.target.checked ? "Windows를 켤 때 자동으로 시작합니다." : "자동 시작을 껐습니다.");
    if (!data && state) event.target.checked = state.settings.autostart;
  });
  $("open-on-start").addEventListener("change", async (event) => {
    const data = await act("/api/admin/settings", { openWindowOnStart: event.target.checked }, "저장했습니다.");
    if (!data && state) event.target.checked = state.settings.openWindowOnStart;
  });
  $("quit").addEventListener("click", async () => {
    const answer = await ask({
      title: "앱을 끝낼까요?",
      body: "끝내면 Quest에서 이 PC에 연결할 수 없습니다.\n창만 닫으려면 취소를 누르고 창의 X를 누르세요. 앱은 계속 켜져 있습니다.",
      buttons: [{ label: "취소", value: "cancel" }, { label: "앱 끝내기", value: "ok", kind: "danger-fill" }],
    });
    if (answer !== "ok") return;
    if (!(await act("/api/admin/quit", {}))) return;
    quitted = true;
    renderStatus();
    location.hash = "#home";
  });
  $("bind-save").addEventListener("click", saveBindings);
  $("bind-reset").addEventListener("click", resetBindings);
  $("bind-retry").addEventListener("click", loadBindings);
  for (const key of document.querySelectorAll(".pad .key")) {
    key.addEventListener("click", () => jumpToKey(key.dataset.key));
    key.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      jumpToKey(key.dataset.key);
    });
  }
  window.addEventListener("hashchange", route);
  window.addEventListener("beforeunload", (event) => {
    if (bindDirty()) event.preventDefault(); // 저장하지 않은 버튼 설정이 있으면 닫기 전에 한 번 묻는다
  });

  route();
  renderStatus();
  refresh();
  setInterval(refresh, 3000);
})();
