// 스토어판(VITE_STORE_BUILD=1) 진입점. vite.config.js가 이 빌드에서만 index.html의 진입을 main.js에서 이 파일로 바꾼다.
// Horizon Store에서 설치한 앱(TWA) 안이면 앱(main.js)을 그대로 불러오고, 일반 브라우저로 주소를 직접 열었으면 설치 안내만 보인다.
// 판별은 core/store-gate.js(보수적: 신호가 하나라도 있으면 통과).
import { POLICY_LINKS, createPolicyLink } from "./core/policy-links.js";
import { detectStoreAppInBrowser } from "./core/store-gate.js";

const NOTICE_CSS = `
html,body{margin:0;min-height:100%;background:#11161a;color:#e8eef2;font:18px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
.store-notice{box-sizing:border-box;max-width:40rem;margin:0 auto;padding:12vh 20px 40px;display:grid;gap:14px}
.store-notice h1{margin:0;font-size:28px;line-height:1.3}
.store-notice p{margin:0}
.store-notice .muted{opacity:.7;font-size:15px}
.store-notice__links{display:flex;flex-wrap:wrap;gap:4px 18px}
.store-notice__links a{color:#9fd2ff;display:inline-flex;align-items:center;min-height:40px}
`;

function showInstallNotice() {
  document.title = "SHARP 뷰어 - Horizon Store에서 설치하세요";
  const style = document.createElement("style");
  style.textContent = NOTICE_CSS;
  document.head.append(style);
  const root = document.querySelector("#app") ?? document.body;
  const section = document.createElement("section");
  section.className = "store-notice";
  const lines = [
    ["h1", "Meta Horizon Store에서 설치하세요"],
    ["p", "이 뷰어는 Quest의 Horizon Store에서 설치한 앱으로만 쓸 수 있어요. 브라우저 주소로는 열 수 없습니다."],
    ["p", "Quest에서 Horizon Store를 열어 이 앱을 설치한 뒤, 앱 목록에서 실행하세요. 이미 설치했다면 앱 목록에서 바로 여세요."],
    ["p", "Please install this app from the Meta Horizon Store on your Quest. It cannot be used directly in a web browser."],
  ];
  for (const [tag, text] of lines) {
    const node = document.createElement(tag);
    node.textContent = text;
    if (tag === "p" && text.startsWith("Please")) node.className = "muted";
    section.append(node);
  }
  // 지원·개인정보처리방침·이용약관 링크(문의할 곳을 찾을 수 있게).
  const links = document.createElement("p");
  links.className = "store-notice__links";
  links.append(...POLICY_LINKS.map((link) => createPolicyLink(document, link)));
  section.append(links);
  root.replaceChildren(section);
}

const gate = detectStoreAppInBrowser();
if (gate.allowed) {
  import("./main.js");
} else {
  showInstallNotice();
}
