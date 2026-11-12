// 정책 링크(core/policy-links.js): 세 페이지 주소와 새 창으로 여는 속성 확인.
import assert from "node:assert/strict";
import { test } from "node:test";

import { POLICY_LINKS, createPolicyLink } from "../src/core/policy-links.js";

test("개인정보처리방침·지원·이용약관 세 링크가 사용자 사이트 sharp-quest/ 아래 https 주소다", () => {
  assert.deepEqual(
    POLICY_LINKS.map((link) => link.href),
    ["https://shimanskim.github.io/sharp-quest/privacy/", "https://shimanskim.github.io/sharp-quest/support/", "https://shimanskim.github.io/sharp-quest/terms/"],
  );
  for (const link of POLICY_LINKS) assert.ok(link.label);
});

test("링크는 새 창(target=_blank, noopener)으로 열어 앱 화면을 떠나지 않는다", () => {
  const doc = { createElement: (tag) => ({ tag }) };
  const anchor = createPolicyLink(doc, POLICY_LINKS[1]);
  assert.equal(anchor.tag, "a");
  assert.equal(anchor.href, "https://shimanskim.github.io/sharp-quest/support/");
  assert.equal(anchor.textContent, "지원");
  assert.equal(anchor.target, "_blank");
  assert.equal(anchor.rel, "noopener noreferrer");
});
