// [PC] 탭의 연결 상태 표시와 실패 안내. 소유: sync-dev.
// 앱 셸(app-dev)은 element를 [PC] 탭에 붙이고, 탭이 보일 때 activate()를, 연결되면 onConnected를 받는다.
//
//   const panel = createPcPanel({ source: pcSource, onConnected: () => reloadList() });
//   tabBody.append(panel.element);
//   panel.activate();  // 탭이 열릴 때
//
// 첫 연결은 LNA 권한 프롬프트가 뜨므로 "사용자 클릭" 안에서 시작하는 편이 자연스럽다.
// 권한이 이미 허용됐거나 마지막 주소가 있으면 activate()가 자동으로 연결한다.

import { describeFailure, queryLnaPermission } from "../sources/pc-connect.js";

const STYLE_ID = "pc-panel-style";
const CSS = `
.pc-panel{display:grid;gap:12px;padding:16px;border-radius:12px;background:rgba(255,255,255,.06);font:16px/1.5 system-ui,sans-serif}
.pc-panel__status{display:flex;align-items:center;gap:10px;font-weight:600}
.pc-panel__dot{width:12px;height:12px;border-radius:50%;background:#888;flex:none}
.pc-panel[data-status=connected] .pc-panel__dot{background:#3ecf6a}
.pc-panel[data-status=connecting] .pc-panel__dot{background:#f0b840;animation:pc-pulse 1s infinite}
.pc-panel[data-status=failed] .pc-panel__dot{background:#ef5350}
.pc-panel__guide{margin:0;padding-left:1.2em}
.pc-panel__guide li{margin:4px 0}
.pc-panel__hint{opacity:.75;font-size:14px;margin:0}
.pc-panel button{min-height:44px;padding:0 18px;border-radius:10px;border:0;font:inherit;font-weight:600;cursor:pointer}
.pc-panel details{font-size:14px}
.pc-panel input{min-height:40px;padding:0 10px;border-radius:8px;border:1px solid #666;font:inherit;width:min(100%,18em)}
.pc-panel>div:empty{display:none}
.pc-panel.compact{grid-template-columns:1fr auto;align-items:center;gap:8px;padding:8px 12px}
.pc-panel.compact .pc-panel__status{min-width:0;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pc-panel.compact button{min-height:44px;padding:0 14px;font-size:16px}
@keyframes pc-pulse{50%{opacity:.35}}
`;

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
}

/**
 * @param {object} options
 * @param {ReturnType<import('../sources/pc-source.js').createPcSource>} options.source
 * @param {() => void} [options.onConnected]
 */
export function createPcPanel({ source, onConnected }) {
  if (!document.getElementById(STYLE_ID)) {
    document.head.append(el("style", { id: STYLE_ID, textContent: CSS }));
  }
  const connection = source.connection;

  const dot = el("span", { className: "pc-panel__dot" });
  const statusText = el("span");
  const guide = el("div");
  const button = el("button", { type: "button", textContent: "PC에 연결" });
  const manualInput = el("input", { type: "text", placeholder: "예: 192.168.0.23 (보통 필요 없음)", inputMode: "url" });
  manualInput.value = connection.getManualBase() ?? "";
  const manualSave = el("button", { type: "button", textContent: "저장" });
  const manualMsg = el("p", { className: "pc-panel__hint" });
  const advanced = el(
    "details",
    {},
    el("summary", { textContent: "고급: 주소 직접 입력" }),
    el("p", { className: "pc-panel__hint", textContent: "자동 연결이 안 될 때만 쓰는 비상용입니다. 비우고 저장하면 지웁니다." }),
    manualInput,
    " ",
    manualSave,
    manualMsg,
  );
  const root = el("section", { className: "pc-panel" }, el("div", { className: "pc-panel__status" }, dot, statusText), guide, button, advanced);
  root.setAttribute("aria-live", "polite");

  function render(state) {
    root.dataset.status = state.status;
    // 연결된 뒤에는 목록이 화면을 쓰도록 한 줄로 줄인다.
    root.classList.toggle("compact", state.status === "connected");
    advanced.hidden = state.status === "connected";
    guide.replaceChildren();
    button.hidden = state.status === "connecting";
    if (state.status === "connected") {
      const name = state.info?.host ? `${state.info.host} (${new URL(state.base).hostname})` : state.base;
      statusText.textContent = `PC 연결됨: ${name}`;
      button.textContent = "다시 연결";
    } else if (state.status === "connecting") {
      statusText.textContent = "PC를 찾는 중입니다…";
      guide.append(el("p", { className: "pc-panel__hint", textContent: "브라우저가 '로컬 네트워크 기기 찾기' 권한을 물으면 허용을 누르세요. 오래 걸리면 아래 '고급: 주소 직접 입력'을 열어 PC 주소를 넣어 볼 수 있습니다." }));
    } else if (state.status === "failed") {
      const { title, steps } = describeFailure(state);
      statusText.textContent = title;
      button.textContent = "다시 연결";
      guide.append(el("ol", { className: "pc-panel__guide" }, ...steps.map((text) => el("li", { textContent: text }))));
      if (state.attempts.length) {
        const tried = state.attempts.map((a) => `${a.base} (${a.error})`).join(", ");
        guide.append(el("p", { className: "pc-panel__hint", textContent: `시도한 주소: ${tried}` }));
      }
    } else {
      statusText.textContent = "PC에 연결되지 않았습니다";
      button.textContent = "PC에 연결";
    }
  }

  let notified = false;
  async function connect() {
    const state = await connection.connect();
    render(state);
    if (state.status === "connected" && !notified) {
      notified = true;
      onConnected?.();
    } else if (state.status !== "connected") {
      notified = false;
    }
    return state;
  }

  // connection이 상태를 바꿀 때마다(요청 실패로 끊김 등) 화면을 맞춘다.
  connection.subscribe(render);

  button.addEventListener("click", connect);
  manualSave.addEventListener("click", () => {
    const ok = connection.setManualBase(manualInput.value);
    manualMsg.textContent = ok ? "저장했습니다. [다시 연결]을 누르세요." : "주소 형식이 올바르지 않습니다.";
  });
  render(connection.state);

  return {
    element: root,
    connect,
    /** 탭이 열릴 때. 연결돼 있지 않고, 권한이 이미 있거나 마지막 주소가 있으면 자동으로 연결한다. */
    async activate() {
      if (connection.state.status === "connected" || connection.state.status === "connecting") return;
      const permission = await queryLnaPermission();
      if (permission === "granted" || connection.hasLastBase()) await connect();
    },
  };
}
