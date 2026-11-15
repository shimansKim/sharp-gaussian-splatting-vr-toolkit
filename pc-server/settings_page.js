"use strict";
// SHARP PC 서버 관리 창. 토큰은 주소의 ?t= 로 받아 모든 API 요청 헤더(X-Admin-Token)에 싣는다.
(() => {
  const token = new URLSearchParams(location.search).get("t") || "";
  const $ = (id) => document.getElementById(id);
  let state = null;
  let busy = false;

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value);
    }
    for (const child of children) if (child) node.append(child);
    return node;
  }

  function toast(message, bad = false) {
    const box = $("toast");
    box.textContent = message;
    box.className = "toast show" + (bad ? " bad" : "");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => (box.className = "toast"), bad ? 5000 : 2200);
  }

  async function api(path, body) {
    const options = { headers: { "X-Admin-Token": token } };
    if (body !== undefined) {
      options.method = "POST";
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }
    const response = await fetch(path, options);
    const data = await response.json().catch(() => ({ ok: false, error: "응답을 읽지 못했습니다." }));
    if (data && data.folders) render(data);
    if (!response.ok || !data.ok) throw new Error(data.error || `요청이 거절되었습니다(${response.status}).`);
    return data;
  }

  async function act(path, body, success) {
    if (busy) return;
    busy = true;
    try {
      const data = await api(path, body);
      if (success && !data.cancelled) toast(success);
      return data;
    } catch (error) {
      toast(error.message, true);
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
    toast("복사했습니다: " + text);
  }

  function render(next) {
    state = next;
    document.title = "SHARP PC 서버 관리"; // 트레이 앱이 이 제목으로 열린 관리 창을 찾는다
    const server = next.server;
    $("version").textContent = next.version ? `v${next.version}` : "";
    $("dot").className = "dot " + (server.state === "running" ? "running" : server.state === "error" ? "error" : "");
    $("status-text").textContent =
      server.state === "running" ? `실행 중 · 포트 ${server.port}` : server.state === "error" ? "오류 — 서버가 꺼져 있습니다" : "중지됨";
    const errorBox = $("status-error");
    errorBox.hidden = !server.error;
    errorBox.textContent = server.error || "";
    $("probe-note").hidden = !server.probe;

    const addresses = $("addresses");
    addresses.replaceChildren();
    const urls = server.state === "running" ? server.urls : [];
    if (server.state !== "running") {
      addresses.append(el("div", { class: "muted", text: "서버가 켜져 있지 않아 주소가 없습니다." }));
    } else if (!urls.length) {
      addresses.append(el("div", { class: "notice warn", text: "사설 IPv4 주소를 찾지 못했습니다. Wi-Fi/랜 연결을 확인하세요." }));
    }
    for (const url of urls) {
      addresses.append(
        el("div", { class: "row" }, el("div", { class: "grow path", text: url }), el("button", { text: "복사", onclick: () => copy(url) })),
      );
    }

    const folders = $("folders");
    folders.replaceChildren();
    for (const folder of next.folders) {
      const label = el("div", { class: "grow" }, el("span", { class: "path", text: folder.path }));
      if (folder.kind === "default") label.append(el("span", { class: "tag", text: "기본 폴더" }));
      if (folder.kind === "session") label.append(el("span", { class: "tag", text: "이번 실행에서만" }));
      if (!folder.exists) label.append(el("span", { class: "tag warn", text: "폴더를 찾을 수 없음" }));
      folders.append(
        el(
          "div",
          { class: "row" },
          label,
          el("button", { text: "탐색기로 열기", disabled: folder.exists ? null : "disabled", onclick: () => act("/api/admin/folders/open", { path: folder.path }) }),
          el("button", {
            class: "danger",
            text: "제거",
            disabled: folder.removable ? null : "disabled",
            title: folder.removable ? "" : "다른 폴더를 추가하면 기본 폴더는 쓰지 않습니다.",
            onclick: () => act("/api/admin/folders/remove", { path: folder.path }, "목록에서 뺐습니다."),
          }),
        ),
      );
    }
    if (next.folders.some((f) => !f.exists)) {
      folders.append(el("div", { class: "notice warn", text: "찾을 수 없는 폴더는 Quest에 보이지 않습니다. 외장 드라이브라면 연결한 뒤 [서버 다시 시작]을 누르세요." }));
    }

    $("default-port").textContent = next.defaultPort;
    if (document.activeElement !== $("port")) $("port").value = server.port || next.settings.port;
    $("autostart").checked = next.settings.autostart;
    $("open-on-start").checked = next.settings.openWindowOnStart;
    $("data-dir").textContent = next.dataDir ? `설정 위치: ${next.dataDir}` : "";

    const link = $("bindings-link");
    if (server.bindingsUrl) link.setAttribute("href", server.bindingsUrl);
    else link.removeAttribute("href");
    $("bindings-button").disabled = !server.bindingsUrl;
  }

  async function refresh() {
    if (busy) return;
    try {
      render(await api("/api/admin/state"));
    } catch (error) {
      document.title = "SHARP PC 서버 (연결 끊김)";
      $("status-text").textContent = "앱과 연결할 수 없습니다 — 앱이 끝났을 수 있습니다.";
      $("dot").className = "dot error";
    }
  }

  $("restart").addEventListener("click", () => act("/api/admin/restart", {}, "서버를 다시 시작했습니다."));
  $("add-folder").addEventListener("click", async () => {
    const data = await act("/api/admin/folders/choose", {}, "폴더를 추가했습니다.");
    void data;
  });
  $("add-path").addEventListener("click", async () => {
    const input = $("folder-path");
    const data = await act("/api/admin/folders/add", { path: input.value }, "폴더를 추가했습니다.");
    if (data) input.value = "";
  });
  $("folder-path").addEventListener("keydown", (event) => {
    if (event.key === "Enter") $("add-path").click();
  });
  $("apply-port").addEventListener("click", () => act("/api/admin/settings", { port: $("port").value }, "포트를 바꿨습니다."));
  $("port").addEventListener("keydown", (event) => {
    if (event.key === "Enter") $("apply-port").click();
  });
  $("autostart").addEventListener("change", async (event) => {
    const data = await act("/api/admin/settings", { autostart: event.target.checked }, event.target.checked ? "Windows 시작 시 자동 실행합니다." : "자동 실행을 껐습니다.");
    if (!data) refresh();
  });
  $("open-on-start").addEventListener("change", (event) => act("/api/admin/settings", { openWindowOnStart: event.target.checked }, "저장했습니다."));
  $("quit").addEventListener("click", async () => {
    if (!confirm("앱을 끝내면 Quest에서 PC에 연결할 수 없습니다. 끝낼까요?")) return;
    await act("/api/admin/quit", {});
    $("status-text").textContent = "앱을 끝냈습니다. 이 창을 닫아도 됩니다.";
    $("dot").className = "dot";
  });

  refresh();
  setInterval(refresh, 3000);
})();
