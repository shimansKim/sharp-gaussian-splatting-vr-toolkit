// 앱 진입점. m2 본체에서 xr-stage, library, app-shell, 뷰어·소스 등록을 붙인다.
import { BASE_URL } from "./config.js";
import "./ui/styles.css";

const app = document.querySelector("#app");
app.innerHTML = `
  <main class="boot">
    <h1>SHARP Quest Viewer</h1>
    <p>앱 골격입니다. PLY·VR 영상 뷰어는 곧 이 자리에 들어옵니다.</p>
    <p><a href="${BASE_URL}probe.html">Quest 3 기능 프로브 열기</a></p>
  </main>
`;
