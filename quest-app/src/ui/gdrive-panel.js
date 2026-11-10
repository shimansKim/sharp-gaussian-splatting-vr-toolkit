// [드라이브] 탭: 로그인·파일 고르기·고른 목록 관리·설정 안내. 소유: sync-dev.
// 앱 셸(app-dev)은 element를 탭에 붙이고, 고른 파일 목록이 바뀔 때 onChange를 받아 목록을 새로 그린다.
//
//   const panel = createGdrivePanel({ source: gdriveSource, onChange: () => reloadList() });
//   tabBody.append(panel.element);
//
// 로그인 팝업과 파일 선택 창은 "사용자 클릭" 안에서 열어야 하므로 버튼 핸들러에서만 부른다.

import { GdriveError } from "../sources/gdrive-source.js";

const STYLE_ID = "gdrive-panel-style";
const CSS = `
.gd-panel{display:grid;gap:12px;padding:16px;border-radius:12px;background:rgba(255,255,255,.06);font:16px/1.5 system-ui,sans-serif}
.gd-panel__status{font-weight:600}
.gd-panel__hint{opacity:.75;font-size:14px;margin:0}
.gd-panel__error{color:#ff8a80;margin:0}
.gd-panel ol,.gd-panel ul{margin:0;padding-left:1.2em}
.gd-panel li{margin:4px 0}
.gd-panel button{min-height:44px;padding:0 18px;border-radius:10px;border:0;font:inherit;font-weight:600;cursor:pointer}
.gd-panel__row{display:flex;gap:8px;align-items:center;justify-content:space-between}
.gd-panel__row button{min-height:36px;padding:0 12px;font-weight:500}
`;

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
}

/**
 * @param {object} options
 * @param {ReturnType<import('../sources/gdrive-source.js').createGdriveSource>} options.source
 * @param {() => void} [options.onChange]  고른 목록이 바뀐 뒤
 * @param {string} [options.setupGuideUrl] 설정 안내 문서 주소
 */
export function createGdrivePanel({ source, onChange, setupGuideUrl }) {
  if (!document.getElementById(STYLE_ID)) {
    document.head.append(el("style", { id: STYLE_ID, textContent: CSS }));
  }
  const status = el("div", { className: "gd-panel__status" });
  const message = el("p", { className: "gd-panel__hint" });
  const error = el("p", { className: "gd-panel__error" });
  const body = el("div");
  const root = el("section", { className: "gd-panel" }, status, body, message, error);
  root.setAttribute("aria-live", "polite");

  function show(text, isError = false) {
    message.textContent = isError ? "" : text;
    error.textContent = isError ? text : "";
  }

  function fail(err) {
    show(err instanceof GdriveError ? err.message : `문제가 생겼습니다: ${err?.message ?? err}`, true);
  }

  async function pick() {
    show("");
    try {
      const result = await source.pick();
      if (!result) return;
      const parts = [`${result.added.length}개를 목록에 추가했습니다.`];
      if (result.skipped.length) parts.push(`지원하지 않는 형식이라 뺀 파일: ${result.skipped.join(", ")}`);
      show(parts.join(" "));
      onChange?.();
    } catch (err) {
      fail(err);
    }
  }

  async function render() {
    body.replaceChildren();
    if (!source.isConfigured()) {
      status.textContent = "구글 드라이브 연결이 아직 설정되지 않았습니다";
      body.append(
        el("p", { className: "gd-panel__hint", textContent: "이 기능은 구글 클라우드에서 만든 설정값이 앱에 들어 있어야 동작합니다. 설정 전까지는 아래 방법으로 파일을 열 수 있습니다." }),
        el(
          "ol",
          {},
          el("li", { textContent: "Quest 브라우저에서 drive.google.com을 열고 파일을 내려받습니다(Download 폴더에 저장됩니다)." }),
          el("li", { textContent: "이 앱의 [기기에서 열기]로 내려받은 파일을 고릅니다." }),
        ),
      );
      if (setupGuideUrl) body.append(el("p", { className: "gd-panel__hint" }, "설정 방법: ", el("a", { href: setupGuideUrl, target: "_blank", rel: "noopener", textContent: "구글 드라이브 설정 안내" })));
      return;
    }
    const { items } = await source.list();
    status.textContent = source.state.signedIn ? "구글 드라이브: 로그인됨" : "구글 드라이브: 로그인 필요";
    body.append(el("button", { type: "button", textContent: items.length ? "파일 더 고르기" : "드라이브에서 파일 고르기", onclick: pick }));
    if (!items.length) {
      body.append(el("p", { className: "gd-panel__hint", textContent: "고른 파일만 앱이 볼 수 있습니다. 폴더 전체나 다른 파일은 접근하지 않습니다." }));
    } else {
      body.append(
        el(
          "ul",
          {},
          ...items.map((item) =>
            el("li", {}, el("div", { className: "gd-panel__row" }, el("span", { textContent: item.name }), el("button", { type: "button", textContent: "목록에서 빼기", onclick: () => { source.remove(item.path); onChange?.(); } }))),
          ),
        ),
      );
    }
    if (source.state.signedIn) {
      body.append(el("button", { type: "button", textContent: "로그아웃(접근 해제)", onclick: () => { source.signOut(); show("로그아웃했습니다."); } }));
    }
  }

  source.subscribe(() => {
    render().catch(fail);
  });
  render().catch(fail);

  return { element: root, render };
}
