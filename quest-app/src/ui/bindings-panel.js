// 2D 설정의 '컨트롤러 버튼 지정' 창. 동작마다 드롭다운으로 입력(손·버튼·짧게/길게, 스틱·축)을 고른다.
// 저장은 core/bindings.js 저장소(localStorage)이고, 바꾸는 즉시 VR 조작·안내 문구에 반영된다.
// 같은 입력에 두 동작이 걸리면 그 줄과 맨 위에 경고를 띄운다(저장은 막지 않는다: 둘 다 동작한다).
// PC 연결 중이면 PC 서버와 배정을 주고받는 줄(sync 옵션)을 보인다 — 규칙은 "나중에 바꾼 쪽이 이긴다".
import "./bindings-panel.css";
import { ACTIONS, FIXED, SCOPES, actionById, bindings as defaultStore, describeAction, findConflicts, inputChoices, sameInput } from "../core/bindings.js";

const SOURCE_LABEL = { default: "기본값", device: "이 기기에서 바꿈", pc: "PC에서 받아 옴" };

function formatTime(ms) {
  if (!ms) return "";
  try {
    return new Date(ms).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

/**
 * @param {{
 *   store?: ReturnType<typeof import('../core/bindings.js').createBindingStore>,
 *   sync?: { status: () => { connected: boolean, text: string }, pull: () => Promise<string>, push: () => Promise<string>, subscribe: (fn: () => void) => () => void } | null,
 *   doc?: Document,
 * }} [options]
 */
export function createBindingsPanel({ store = defaultStore, sync = null, doc = document } = {}) {
  const dialog = doc.createElement("dialog");
  dialog.className = "bindings-dialog";
  dialog.setAttribute("aria-labelledby", "bindings-title");
  dialog.innerHTML = `
    <form method="dialog" class="bindings-form">
      <header class="bindings-head">
        <h2 id="bindings-title">컨트롤러 버튼 지정</h2>
        <button class="btn small" value="close" type="submit" aria-label="닫기">닫기</button>
      </header>
      <p class="muted bindings-intro">동작마다 쓸 버튼이나 스틱을 고르세요. 바꾸면 바로 저장되고 VR 조작과 안내 문구에 반영됩니다. 같은 버튼이라도 '짧게'와 '길게'는 따로 쓸 수 있습니다.</p>
      <p class="bindings-meta" data-role="meta"></p>
      <div class="bindings-sync" data-role="sync" hidden></div>
      <div class="bindings-warn" data-role="warn" role="alert" hidden></div>
      <div data-role="sections"></div>
      <footer class="bindings-foot">
        <button class="btn" type="button" data-role="reset-all">모두 기본값으로</button>
      </footer>
    </form>
  `;
  doc.body.appendChild(dialog);
  const $ = (role) => dialog.querySelector(`[data-role="${role}"]`);

  /** 줄마다 선택 상자를 만든다(처음 한 번). 값·경고는 render()가 채운다. */
  const rows = new Map();
  const sections = $("sections");
  for (const scope of Object.keys(SCOPES)) {
    const section = doc.createElement("section");
    section.className = "bindings-section";
    const h = doc.createElement("h3");
    h.textContent = SCOPES[scope];
    section.appendChild(h);
    for (const action of ACTIONS.filter((a) => a.scope === scope)) {
      const row = doc.createElement("div");
      row.className = "bindings-row";
      const label = doc.createElement("label");
      label.className = "bindings-label";
      label.htmlFor = `binding-${action.id}`;
      label.textContent = action.label;
      if (action.note) label.title = action.note;
      const select = doc.createElement("select");
      select.id = `binding-${action.id}`;
      select.dataset.action = action.id;
      for (const choice of inputChoices(action.kind)) {
        const option = doc.createElement("option");
        option.value = choice.value;
        option.textContent = choice.label;
        select.appendChild(option);
      }
      select.addEventListener("change", () => {
        store.set(action.id, JSON.parse(select.value));
      });
      const reset = doc.createElement("button");
      reset.type = "button";
      reset.className = "btn small";
      reset.textContent = "기본";
      reset.title = `기본값: ${describeAction({ [action.id]: action.default }, action.id)}`;
      reset.addEventListener("click", () => store.reset(action.id));
      const warn = doc.createElement("p");
      warn.className = "bindings-row-warn";
      warn.hidden = true;
      row.append(label, select, reset, warn);
      section.appendChild(row);
      rows.set(action.id, { select, reset, warn, row });
    }
    for (const fixed of FIXED.filter((f) => f.scope === scope)) {
      const row = doc.createElement("div");
      row.className = "bindings-row fixed";
      row.innerHTML = `<span class="bindings-label"></span><span class="bindings-fixed"></span>`;
      row.children[0].textContent = fixed.label;
      row.children[1].textContent = `${fixed.text} (고정)`;
      section.appendChild(row);
    }
    sections.appendChild(section);
  }
  $("reset-all").addEventListener("click", () => store.reset());

  function render() {
    const map = store.get();
    const meta = store.meta();
    const conflicts = findConflicts(map);
    const byId = new Map();
    for (const c of conflicts) {
      for (const [self, other] of [[c.a, c.b], [c.b, c.a]]) {
        if (!byId.has(self)) byId.set(self, []);
        byId.get(self).push(other);
      }
    }
    for (const [id, { select, reset, warn, row }] of rows) {
      select.value = JSON.stringify(map[id] ?? null);
      reset.disabled = sameInput(map[id] ?? null, actionById(id).default);
      const clashes = byId.get(id) ?? [];
      row.classList.toggle("conflict", clashes.length > 0);
      warn.hidden = clashes.length === 0;
      warn.textContent = clashes.length ? `⚠ ${clashes.map((o) => actionById(o)?.label ?? fixedLabel(o)).join(", ")}과(와) 같은 입력` : "";
    }
    const warnBox = $("warn");
    warnBox.hidden = conflicts.length === 0;
    warnBox.textContent = conflicts.length
      ? `⚠ 같은 입력에 동작이 두 개 걸린 곳이 ${conflicts.length}곳 있습니다. 둘 다 동작하니 하나를 바꾸세요: ${conflicts.map((c) => `${c.input} → ${nameOf(c.a)} / ${nameOf(c.b)}`).join(" · ")}`
      : "";
    $("meta").textContent = `지금 배정: ${SOURCE_LABEL[meta.source] ?? meta.source}${meta.updatedAt ? ` (${formatTime(meta.updatedAt)})` : ""}`;
    renderSync();
  }

  const fixedLabel = (id) => FIXED.find((f) => f.id === id)?.label ?? id;
  const nameOf = (id) => actionById(id)?.label ?? fixedLabel(id);

  function renderSync() {
    const box = $("sync");
    if (!sync) {
      box.hidden = true;
      return;
    }
    const status = sync.status();
    box.hidden = false;
    box.replaceChildren();
    const text = doc.createElement("p");
    text.className = "muted";
    text.textContent = status.text;
    box.appendChild(text);
    // 이 기기에서 바꾼 배정이 PC의 더 최근 배정에 밀려 버려졌으면 눈에 띄게 알린다(경고 줄).
    if (sync.notice) {
      const warn = doc.createElement("p");
      warn.className = "bindings-warn";
      warn.dataset.role = "sync-notice";
      warn.setAttribute("role", "alert");
      warn.textContent = `⚠ ${sync.notice}`;
      box.appendChild(warn);
    }
    if (!status.connected) return;
    const pull = doc.createElement("button");
    pull.type = "button";
    pull.className = "btn small";
    pull.textContent = "PC 배정 불러오기";
    const push = doc.createElement("button");
    push.type = "button";
    push.className = "btn small";
    push.textContent = "이 배정을 PC로 보내기";
    const result = doc.createElement("span");
    result.className = "muted";
    result.setAttribute("aria-live", "polite");
    const run = (fn) => async () => {
      pull.disabled = push.disabled = true;
      try {
        result.textContent = await fn();
      } catch (error) {
        result.textContent = `실패: ${error?.message ?? error}`;
      } finally {
        pull.disabled = push.disabled = false;
      }
    };
    pull.addEventListener("click", run(sync.pull));
    push.addEventListener("click", run(sync.push));
    box.append(pull, push, result);
  }

  store.subscribe(() => {
    if (dialog.open) render();
  });
  sync?.subscribe?.(() => {
    if (dialog.open) renderSync();
  });

  return {
    dialog,
    open() {
      render();
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    },
    close() {
      dialog.close?.();
    },
    render,
  };
}
