// [설정] > 오픈소스 라이선스: 앱에 들어 있는 오픈소스(three.js, Spark 등)의 이름·버전·라이선스 전문을 보여 주는 창.
// 목록은 빌드할 때 vite.config.js가 node_modules의 라이선스 파일에서 모은다(virtual:third-party-licenses).
// 라이선스 글은 창을 처음 열 때만 불러온다(앱 시작을 무겁게 하지 않게).

const STYLE_ID = "licenses-panel-style";
const CSS = `
.licenses-dialog{width:min(860px,calc(100vw - 32px));max-height:calc(100vh - 48px);overflow:hidden;padding:0;border:1px solid rgba(255,255,255,.16);border-radius:14px;background:#151b20;color:#e8eef2}
.licenses-dialog::backdrop{background:rgba(0,0,0,.55)}
.licenses-form{display:flex;flex-direction:column;gap:10px;padding:16px 18px 18px;max-height:calc(100vh - 48px);box-sizing:border-box}
.licenses-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
.licenses-head h2{margin:0;font-size:1.15rem}
.licenses-intro{margin:0;opacity:.8;font-size:.95rem}
.licenses-body{overflow:auto;min-height:0;flex:1;display:grid;gap:14px;padding-right:4px}
.licenses-item{border-top:1px solid rgba(255,255,255,.12);padding-top:10px}
.licenses-item h3{margin:0 0 4px;font-size:1.05rem}
.licenses-item p{margin:0 0 6px;font-size:.9rem;opacity:.8;overflow-wrap:anywhere}
.licenses-item pre{margin:0;padding:10px 12px;border-radius:8px;background:rgba(0,0,0,.3);white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.5 ui-monospace,Consolas,monospace}
`;

/** 화면에 보일 한 항목의 머리글. 예: "three 0.180.0 · MIT" */
export function licenseHeading(entry) {
  return [entry.name, entry.version].filter(Boolean).join(" ") + (entry.license ? ` · ${entry.license}` : "");
}

/** 링크 주소를 사람이 읽기 쉽게 정리한다(git+https://…/x.git → https://…/x). */
export function cleanHomepage(url) {
  return String(url ?? "")
    .replace(/^git\+/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/\.git$/, "");
}

/**
 * @param {{ doc?: Document, load?: () => Promise<Array<{ name: string, version?: string, license?: string, homepage?: string, note?: string, text: string }>> }} [options]
 */
export function createLicensesPanel({ doc = document, load = () => import("virtual:third-party-licenses").then((mod) => mod.default) } = {}) {
  if (!doc.getElementById(STYLE_ID)) {
    const style = doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    doc.head.append(style);
  }
  const dialog = doc.createElement("dialog");
  dialog.className = "licenses-dialog";
  dialog.setAttribute("aria-labelledby", "licenses-title");
  dialog.innerHTML = `
    <form method="dialog" class="licenses-form">
      <div class="licenses-head">
        <h2 id="licenses-title">오픈소스 라이선스</h2>
        <button class="btn" type="submit">닫기</button>
      </div>
      <p class="licenses-intro">이 앱은 아래 오픈소스 소프트웨어를 포함합니다. 각 라이선스의 전문입니다.</p>
      <div class="licenses-body" data-role="body"><p>불러오는 중…</p></div>
    </form>
  `;
  doc.body.appendChild(dialog);
  const body = /** @type {HTMLElement} */ (dialog.querySelector('[data-role="body"]'));
  let loaded = false;

  async function fill() {
    try {
      const list = await load();
      body.replaceChildren(
        ...list.map((entry) => {
          const item = doc.createElement("section");
          item.className = "licenses-item";
          const title = doc.createElement("h3");
          title.textContent = licenseHeading(entry);
          item.append(title);
          const meta = [entry.note, cleanHomepage(entry.homepage)].filter(Boolean).join(" · ");
          if (meta) {
            const line = doc.createElement("p");
            line.textContent = meta;
            item.append(line);
          }
          const text = doc.createElement("pre");
          text.textContent = entry.text;
          item.append(text);
          return item;
        }),
      );
      loaded = true;
    } catch (error) {
      console.error(error);
      body.replaceChildren(Object.assign(doc.createElement("p"), { textContent: "라이선스 목록을 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 다시 열어 주세요." }));
    }
  }

  return {
    dialog,
    open() {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
      if (!loaded) fill();
    },
    close() {
      dialog.close?.();
    },
  };
}
