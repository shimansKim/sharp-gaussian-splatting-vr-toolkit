// legal/spark-rust-crates.json(Spark WebAssembly 안의 Rust 크레이트 고지) 형식 확인. 다시 만드는 법: dev/spark-rust-licenses.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const data = JSON.parse(readFileSync(new URL("../legal/spark-rust-crates.json", import.meta.url), "utf8"));

test("크레이트마다 이름·버전·라이선스·적용 라이선스가 있고, 적용 라이선스의 전문이 실려 있다", () => {
  assert.ok(data.crates.length > 0);
  assert.match(data.source, /sparkjsdev\/spark\/tree\/v/);
  const kinds = new Set(Object.keys(data.texts).map((key) => key.split(" (")[0]));
  for (const crate of data.crates) {
    assert.ok(crate.name && crate.version && crate.license && crate.chosen, JSON.stringify(crate));
    for (const license of crate.chosen.split(" AND ")) assert.ok(kinds.has(license), `${crate.name}: ${license} 전문 없음`);
  }
  for (const text of Object.values(data.texts)) assert.ok(text.length > 300);
});

test("Spark 버전과 고지 출처 태그가 맞다", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const version = pkg.dependencies["@sparkjsdev/spark"];
  assert.ok(data.source.endsWith(`/v${version}/rust`), `${data.source} ↔ spark ${version}: dev/spark-rust-licenses.mjs로 다시 만드세요`);
});
