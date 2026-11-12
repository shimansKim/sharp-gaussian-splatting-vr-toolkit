// Spark의 WebAssembly 모듈에 링크되는 Rust 크레이트와 라이선스를 모아 legal/spark-rust-crates.json을 만든다.
// 앱의 [설정] > 오픈소스 라이선스 창이 이 파일을 읽는다(vite.config.js collectLicenses).
//
// 쓰는 법(Rust 도구 cargo와 git이 필요하다. 앱을 빌드할 때는 필요 없다. @sparkjsdev/spark 버전을 올릴 때만 다시 실행한다):
//   git clone --depth 1 --branch v2.0.0 https://github.com/sparkjsdev/spark.git <폴더>   (package.json의 spark 버전과 같은 태그)
//   node dev/spark-rust-licenses.mjs <폴더>/rust v2.0.0
//
// 대상: Spark의 빌드 스크립트(rust/build_rust_wasm.sh)가 wasm으로 만드는 spark-rs·spark-worker-rs.
// cargo tree --locked --target wasm32-unknown-unknown -e normal,no-proc-macro 로 고른다:
// 빌드 전용(build-dependencies)·개발용(dev-dependencies)·proc-macro(컴파일 때만 쓰는 매크로)와 그 의존성은 빠진다.
// 여러 라이선스 중 고를 수 있는 크레이트(OR)는 MIT → Zlib → Apache-2.0 순으로 하나를 고른다. AND는 모두 적는다.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const [rustDir, tag = ""] = process.argv.slice(2);
if (!rustDir) {
  console.error("사용법: node dev/spark-rust-licenses.mjs <spark 저장소>/rust <태그>");
  process.exit(1);
}
const OUT = fileURLToPath(new URL("../legal/spark-rust-crates.json", import.meta.url));
const WASM_CRATES = ["spark-rs", "spark-worker-rs"];
const PREFERENCE = ["MIT", "Zlib", "Apache-2.0"];

const cargo = (args) => execFileSync("cargo", args, { cwd: rustDir, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });

cargo(["fetch", "--locked"]);
const tree = cargo(["tree", "--locked", "--offline", ...WASM_CRATES.flatMap((p) => ["-p", p]), "--target", "wasm32-unknown-unknown", "-e", "normal,no-proc-macro", "--prefix", "none", "--format", "{p}|{l}|{r}"]);
const seen = new Map();
for (const line of tree.split(/\r?\n/)) {
  const [pkg, license = "", repository = ""] = line.replace(" (*)", "").split("|");
  const match = /^(\S+) v(\S+)$/.exec(pkg.trim());
  if (!match || WASM_CRATES.includes(match[1]) || match[1] === "spark-lib") continue; // Spark 자신은 npm 패키지의 MIT 고지로 덮인다
  seen.set(`${match[1]}@${match[2]}`, { name: match[1], version: match[2], license, repository });
}

// cargo가 받아 둔 .crate(tar.gz)에서 라이선스 파일을 읽는다.
const registry = join(process.env.CARGO_HOME ?? join(homedir(), ".cargo"), "registry", "cache");
const cacheDir = join(registry, readdirSync(registry).find((d) => d.startsWith("index.crates.io")));

/** .crate(tar.gz) 맨 위 폴더의 파일들을 { 이름: Buffer }로 읽는다(외부 tar 도구 없이). */
function readCrateTopFiles(path) {
  const data = gunzipSync(readFileSync(path));
  const files = {};
  for (let offset = 0; offset + 512 <= data.length; ) {
    const header = data.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const field = (start, length) => {
      const raw = header.subarray(start, start + length);
      const end = raw.indexOf(0);
      return raw.subarray(0, end < 0 ? raw.length : end).toString("utf8");
    };
    const name = [field(345, 155), field(0, 100)].filter(Boolean).join("/");
    const size = parseInt(field(124, 12).trim() || "0", 8);
    const type = field(156, 1);
    const parts = name.split("/");
    if ((type === "0" || type === "") && parts.length === 2) files[parts[1]] = data.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

/** "MIT OR Apache-2.0", "MIT/Apache-2.0", "(MIT OR Apache-2.0) AND Unicode-3.0" → 고른 라이선스 목록 */
function choose(expression) {
  return expression.split(/\s+AND\s+/).map((part) => {
    const options = part.replace(/[()]/g, "").split(/\s+OR\s+|\//).map((s) => s.trim());
    return PREFERENCE.find((p) => options.includes(p)) ?? options[0];
  });
}

const FILE_PATTERNS = {
  MIT: [/^licen[cs]e-mit(\.md|\.txt)?$/i, /^licen[cs]e(\.md|\.txt)?$/i],
  "Apache-2.0": [/^licen[cs]e-apache(\.md|\.txt)?$/i, /^copying$/i, /^licen[cs]e(\.md|\.txt)?$/i],
  Zlib: [/^licen[cs]e-zlib(\.md|\.txt)?$/i, /^licen[cs]e(\.md|\.txt)?$/i],
  "Unicode-3.0": [/^licen[cs]e-unicode(\.md|\.txt)?$/i],
};

/** 저작권 줄: "Copyright (c) 2015 …", "Copyright 2024 …", "(C) 2024 …", "Copyright © 1991-2023 …" 처럼 연도가 붙은 줄 */
const COPYRIGHT_LINE = /^(copyright\s*(\(c\)|©)?|\(c\)|©)\s*\[?\d{4}/i;
/** 비교용: 저작권 줄·마크다운 기호·공백 차이를 없앤 글 */
const normalize = (text) =>
  text
    .split("\n")
    .filter((line) => !COPYRIGHT_LINE.test(line.trim()))
    .join(" ")
    .replace(/[#*`_>"'“”]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
/** 단어 기준으로 거의 같은 글인가(앞뒤 제목·한두 단어 차이는 같은 글로 본다) */
function similar(a, b) {
  const sa = new Set(a.split(" "));
  const sb = new Set(b.split(" "));
  const common = [...sa].filter((w) => sb.has(w)).length;
  const jaccard = common / (sa.size + sb.size - common);
  return jaccard > 0.93 && b.length < a.length * 1.1 && a.length < b.length * 1.1;
}
const canonicalTexts = {};

const crates = [];
const texts = {};
for (const entry of [...seen.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))) {
  const contents = readCrateTopFiles(join(cacheDir, `${entry.name}-${entry.version}.crate`));
  const files = Object.keys(contents);
  const notices = files.filter((f) => /^notice/i.test(f));
  if (notices.length) throw new Error(`${entry.name}: NOTICE 파일이 있어 따로 고지해야 합니다 (${notices.join(", ")})`);
  const chosen = choose(entry.license);
  const copyright = [];
  for (const license of chosen) {
    const file = FILE_PATTERNS[license]?.flatMap((re) => files.filter((f) => re.test(f)))[0];
    if (!file) throw new Error(`${entry.name}: ${license} 라이선스 파일을 찾지 못했습니다 (${files.join(", ")})`);
    const text = contents[file].toString("utf8").replace(/\r\n?/g, "\n").trim();
    // 저작권 줄은 크레이트마다 다르므로 크레이트별로 남기고, 본문은 종류별로 한 번만 싣는다.
    for (const line of text.split("\n")) if (COPYRIGHT_LINE.test(line.trim())) copyright.push(line.trim());
    // 같은 종류의 글은 한 번만 싣는다. 저작권 줄·줄바꿈만 다른 글은 같은 글로 보고, 내용이 다르면(추가 고지 등) 크레이트 이름을 붙여 따로 싣는다.
    const canonical = canonicalTexts[license];
    if (!canonical) {
      canonicalTexts[license] = normalize(text);
      texts[license] = text;
    } else if (!similar(canonical, normalize(text))) {
      texts[`${license} (${entry.name})`] = text;
    }
  }
  crates.push({ name: entry.name, version: entry.version, license: entry.license, chosen: chosen.join(" AND "), copyright: [...new Set(copyright)], repository: entry.repository });
}

// MIT 본문은 특정 크레이트의 저작권 줄이 없는 일반 글로 싣는다.
if (texts.MIT) texts.MIT = texts.MIT.split("\n").filter((line) => !COPYRIGHT_LINE.test(line.trim())).join("\n").replace(/\n{3,}/g, "\n\n").trim();

// 저장소 규칙대로 CRLF로 쓴다(JSON 문자열 안의 줄바꿈은 \n 이스케이프라 영향 없음).
writeFileSync(OUT, `${JSON.stringify({ source: `https://github.com/sparkjsdev/spark/tree/${tag}/rust`, targets: WASM_CRATES, crates, texts }, null, 1)}\n`.replace(/\n/g, "\r\n"));
console.log(`${crates.length}개 크레이트, 라이선스 글 ${Object.keys(texts).length}종 → ${OUT}`);
