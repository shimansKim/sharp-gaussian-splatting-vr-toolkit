// 정책 페이지 링크(개인정보처리방침·지원·이용약관). 페이지는 사용자 사이트 sharp-quest/ 에 있다(저장소 store-site 폴더에서 배포).
// [설정](main.js)과 스토어판 설치 안내(store-entry.js)에 쓴다. 모든 빌드에 들어간다.

export const POLICY_LINKS = [
  { label: "개인정보처리방침", href: "https://shimanskim.github.io/sharp-quest/privacy/" },
  { label: "지원", href: "https://shimanskim.github.io/sharp-quest/support/" },
  { label: "이용약관", href: "https://shimanskim.github.io/sharp-quest/terms/" },
];

/**
 * 정책 링크 요소를 만든다. 새 창(target=_blank)으로 열어 앱 화면을 그대로 둔다:
 * TWA(스토어 앱) 안에서는 앱 위에 브라우저 탭으로 열리고, 그 탭을 닫거나 뒤로 가면 앱으로 돌아온다. 일반 브라우저에서는 새 탭.
 * @param {Pick<Document, 'createElement'>} doc
 * @param {{ label: string, href: string }} link
 */
export function createPolicyLink(doc, { label, href }) {
  const anchor = doc.createElement("a");
  anchor.href = href;
  anchor.textContent = label;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  return anchor;
}
