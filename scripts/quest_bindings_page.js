// PC 브라우저용 컨트롤러 버튼 지정 페이지(quest_media_server.py가 /settings/bindings로 내보낸다).
// 동작 목록·기본값·충돌 검사·설명 문구는 앱과 같은 모듈(quest-app/src/core/bindings.js → /settings/bindings.js)을 쓴다.
import { ACTIONS, BINDINGS_VERSION, FIXED, SCOPES, actionById, cleanOverrides, migrateOverrides, defaultBindings, describeAction, findConflicts, inputChoices, mergeBindings, sameInput } from "./bindings.js";

const $ = (id) => document.getElementById(id);
let overrides = {};
let saved = { updatedAt: 0 };
let dirty = false;
const rows = new Map();

function formatTime(ms) {
  return ms ? new Date(ms).toLocaleString("ko-KR") : "";
}

function build() {
  const sections = $("sections");
  sections.replaceChildren();
  for (const scope of Object.keys(SCOPES)) {
    const h = document.createElement("h2");
    h.textContent = SCOPES[scope];
    sections.appendChild(h);
    for (const action of ACTIONS.filter((a) => a.scope === scope)) {
      const row = document.createElement("div");
      row.className = "row";
      const label = document.createElement("label");
      label.htmlFor = `b-${action.id}`;
      label.textContent = action.label;
      if (action.note) label.title = action.note;
      const select = document.createElement("select");
      select.id = `b-${action.id}`;
      for (const choice of inputChoices(action.kind, action)) select.add(new Option(choice.label, choice.value));
      select.addEventListener("change", () => {
        const value = JSON.parse(select.value);
        if (sameInput(value, action.default)) delete overrides[action.id];
        else overrides[action.id] = value;
        setDirty(true);
      });
      const reset = document.createElement("button");
      reset.type = "button";
      reset.textContent = "기본";
      reset.title = `기본값: ${describeAction(defaultBindings(), action.id)}`;
      reset.addEventListener("click", () => {
        delete overrides[action.id];
        setDirty(true);
      });
      const warn = document.createElement("p");
      warn.className = "row-warn";
      warn.hidden = true;
      row.append(label, select, reset, warn);
      sections.appendChild(row);
      rows.set(action.id, { row, select, reset, warn });
    }
    for (const fixed of FIXED.filter((f) => f.scope === scope)) {
      const row = document.createElement("div");
      row.className = "row fixed";
      const a = document.createElement("span");
      a.textContent = fixed.label;
      const b = document.createElement("span");
      b.textContent = `${fixed.text} (고정)`;
      row.append(a, b);
      sections.appendChild(row);
    }
  }
}

const nameOf = (id) => actionById(id)?.label ?? FIXED.find((f) => f.id === id)?.label ?? id;

function render() {
  const map = mergeBindings(overrides);
  const conflicts = findConflicts(map);
  const byId = new Map();
  for (const c of conflicts) {
    for (const [self, other] of [[c.a, c.b], [c.b, c.a]]) {
      if (!byId.has(self)) byId.set(self, []);
      byId.get(self).push(other);
    }
  }
  for (const [id, { row, select, reset, warn }] of rows) {
    select.value = JSON.stringify(map[id] ?? null);
    reset.disabled = sameInput(map[id] ?? null, actionById(id).default);
    const clashes = byId.get(id) ?? [];
    row.classList.toggle("conflict", clashes.length > 0);
    warn.hidden = !clashes.length;
    warn.textContent = clashes.length ? `⚠ ${clashes.map(nameOf).join(", ")}과(와) 같은 입력` : "";
  }
  $("warn").hidden = !conflicts.length;
  $("warn").textContent = conflicts.length
    ? `⚠ 같은 입력에 동작이 두 개 걸린 곳이 ${conflicts.length}곳 있습니다. 저장은 되지만 둘 다 동작합니다: ${conflicts.map((c) => `${c.input} → ${nameOf(c.a)} / ${nameOf(c.b)}`).join(" · ")}`
    : "";
  $("meta").textContent = saved.updatedAt ? `PC에 저장된 배정: ${formatTime(saved.updatedAt)}${dirty ? " · 저장하지 않은 변경 있음" : ""}` : `PC에 저장된 배정 없음(앱 기본값)${dirty ? " · 저장하지 않은 변경 있음" : ""}`;
  $("save").disabled = !dirty;
}

function setDirty(next) {
  dirty = next;
  $("result").textContent = "";
  render();
}

async function load() {
  const res = await fetch("/api/bindings", { cache: "no-store" });
  if (!res.ok) throw new Error(`불러오기 실패(${res.status})`);
  const data = await res.json();
  overrides = migrateOverrides(cleanOverrides(data.bindings), Number(data.version) || 1);
  saved = { updatedAt: Number(data.updatedAt) || 0 };
  setDirty(false);
}

async function save() {
  $("save").disabled = true;
  const body = JSON.stringify({ version: BINDINGS_VERSION, bindings: cleanOverrides(overrides), updatedAt: Date.now(), force: true });
  const res = await fetch("/api/bindings", { method: "PUT", headers: { "Content-Type": "application/json" }, body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `저장 실패(${res.status})`);
  saved = { updatedAt: Number(data.updatedAt) || Date.now() };
  dirty = false;
  render();
  $("result").className = "ok";
  $("result").textContent = "저장했습니다. 앱은 다음에 PC에 연결될 때(또는 설정창의 [PC 배정 불러오기]로) 받아 갑니다.";
}

const report = (error) => {
  $("result").className = "";
  $("result").textContent = `⚠ ${error?.message ?? error}`;
  render();
};

build();
$("save").addEventListener("click", () => save().catch(report));
$("reload").addEventListener("click", () => load().catch(report));
$("reset").addEventListener("click", () => {
  overrides = {};
  setDirty(true);
});
window.addEventListener("beforeunload", (event) => {
  if (dirty) event.preventDefault();
});
load().catch(report);
