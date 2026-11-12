import test from "node:test";
import assert from "node:assert/strict";
import { ellipsize, fitLabel, wrap } from "../src/core/label-fit.js";

// 글자 하나가 글씨 크기(px)의 1배 폭인 단순한 측정(한글 전각 가정)
const measure = (text, size = 30) => [...text].length * size;

test("fitLabel: 들어가면 가장 큰 글씨 한 줄", () => {
  const fit = fitLabel(measure, "이전", 200, { sizes: [30, 28, 26] });
  assert.deepEqual(fit, { size: 30, lines: ["이전"], truncated: false });
});

test("fitLabel: 넘치면 글씨를 줄여서 한 줄로", () => {
  // 7글자: 30px=210, 28px=196
  const fit = fitLabel(measure, "슬라이드쇼 ▶", 200, { sizes: [30, 28, 26, 24, 22] });
  assert.equal(fit.truncated, false);
  assert.equal(fit.lines.length, 1);
  assert.ok(fit.size <= 28);
  assert.ok(measure(fit.lines[0], fit.size) <= 200);
});

test("fitLabel: 한 줄로 안 되면 큰 글씨 두 줄로 나눈다(잘리지 않는다)", () => {
  const text = "UI를 여기로 옮기기"; // 11글자: 22px에서도 242 > 200
  const fit = fitLabel(measure, text, 200, { sizes: [30, 28, 26, 24, 22], maxLines: 2 });
  assert.equal(fit.truncated, false);
  assert.equal(fit.lines.length, 2);
  assert.equal(fit.lines.join(""), text);
  assert.ok(fit.lines.every((line) => measure(line, fit.size) <= 200));
  assert.ok(fit.size >= 22);
});

test("fitLabel: 지정한 줄바꿈(\\n)은 그대로 쓰고 줄마다 폭을 맞춘다", () => {
  const fit = fitLabel(measure, "슬라이드쇼\n▶ 시작", 200, { sizes: [30, 28, 26] });
  assert.deepEqual(fit.lines, ["슬라이드쇼", "▶ 시작"]);
  assert.equal(fit.size, 30 * 5 <= 200 ? 30 : 28);
  assert.equal(fit.truncated, false);
});

test("fitLabel: maxHeight를 넘는 크기는 쓰지 않는다", () => {
  // 두 줄 × 30px × 1.2 = 72 > 60 → 두 줄은 26px 이하(2×26×1.2=62.4>60 → 24px)
  const fit = fitLabel(measure, "가".repeat(14), 200, { sizes: [30, 28, 26, 24, 22], maxLines: 2, maxHeight: 60 });
  assert.ok(fit.lines.length * fit.size * 1.2 <= 60);
});

test("fitLabel: 정말 길면 가장 작은 글씨 두 줄 + …, truncated 표시", () => {
  const fit = fitLabel(measure, "가".repeat(40), 200, { sizes: [30, 24, 22], maxLines: 2 });
  assert.equal(fit.truncated, true);
  assert.equal(fit.lines.length, 2);
  assert.ok(fit.lines[1].endsWith("…"));
  assert.ok(measure(fit.lines[1], fit.size) <= 200);
});

test("ellipsize·wrap", () => {
  const m = (t) => [...t].length * 10;
  assert.equal(ellipsize(m, "짧다", 100), "짧다");
  assert.ok(ellipsize(m, "가".repeat(30), 100).endsWith("…"));
  assert.deepEqual(wrap(m, "가".repeat(15), 100, 2), { lines: ["가".repeat(10), "가".repeat(5)], truncated: false });
  assert.equal(wrap(m, "가".repeat(40), 100, 2).truncated, true);
});

test("앱의 실제 버튼 라벨은 폭 200 안에 잘리지 않고 들어간다", () => {
  // 공용 패널 4열 버튼 폭(224-24)과 HUD 5열 버튼 폭에서 쓰는 라벨들. 글자 폭은 한글 전각(크기의 1.0배)로 보수적으로 잡는다.
  const labels = [
    "◀ 이전", "다음 ▶", "슬라이드쇼 ▶", "슬라이드쇼 ■", "더 보기 ▸", "◂ 목록", "슬라이드쇼 간격: 30초", "UI를 여기로 옮기기", "위치 초기화", "VR 종료", "PLY 옵션 ▸",
    "크기 초기화", "1:1 몰입", "조작 안내", "재생/일시정지", "10초 뒤로", "10초 앞으로", "형식: HSBS 스크린", "재생 컨트롤 보기", "진단 보기", "눈 테스트 끄기", "눈 분리: 카메라(기본)", "출력: 레이어(권장)",
    "이번에 연 파일", "보관함", "PC", "드라이브", "종류: 전체", "정렬: 확장자순",
  ];
  for (const label of labels) {
    const fit = fitLabel(measure, label, 200, { sizes: [30, 28, 26, 24, 22], maxLines: 2, maxHeight: 64 });
    assert.equal(fit.truncated, false, label);
  }
});
