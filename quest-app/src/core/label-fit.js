// 버튼 글씨가 잘리지 않게 크기·줄 수를 고른다(순수 함수: 글자 폭 재는 함수를 받는다). VR 공용 패널과 미디어 재생 컨트롤이 같이 쓴다.
// 순서: 큰 글씨 한 줄 → 줄여서 한 줄 → 두 줄(글자 단위로 끊음) → 마지막 수단으로 가장 작은 글씨로 두 줄 + …
// 라벨에 "\n"이 있으면 그 줄바꿈을 그대로 쓴다(예: "슬라이드쇼\n▶ 시작"). 줄마다 같은 크기에서 맞는지 본다.

/**
 * @param {(text: string, size: number) => number} measure 글씨 크기(px)에서 text의 폭
 * @param {string} text
 * @param {number} maxWidth
 * @param {{ sizes?: number[], maxLines?: number, maxHeight?: number, lineGap?: number }} [options]
 *   sizes: 큰 것부터 쓸 글씨 크기들. maxLines: 최대 줄 수. maxHeight가 있으면 줄 수×크기×lineGap이 그 안에 들어가는 크기만 쓴다.
 * @returns {{ size: number, lines: string[], truncated: boolean }}
 */
export function fitLabel(measure, text, maxWidth, { sizes = [28, 26, 24, 22], maxLines = 2, maxHeight = Infinity, lineGap = 1.2 } = {}) {
  const explicit = String(text).split("\n");
  const heightOk = (size, lines) => lines * size * lineGap <= maxHeight;
  const fitsAll = (lines, size) => lines.every((line) => measure(line, size) <= maxWidth);

  // 1) 한 줄(또는 지정한 줄바꿈 그대로)로 맞는 가장 큰 크기
  if (explicit.length <= maxLines) {
    for (const size of sizes) {
      if (heightOk(size, explicit.length) && fitsAll(explicit, size)) return { size, lines: explicit, truncated: false };
    }
  }
  // 2) 두 줄로 끊어서 맞는 가장 큰 크기(지정한 줄바꿈이 있으면 줄마다 끊는 대신 마지막 수단으로 넘긴다)
  if (explicit.length === 1 && maxLines >= 2) {
    for (const size of sizes) {
      if (!heightOk(size, 2)) continue;
      const wrapped = wrap((t) => measure(t, size), explicit[0], maxWidth, maxLines);
      if (!wrapped.truncated) return { size, lines: wrapped.lines, truncated: false };
    }
  }
  // 3) 그래도 안 되면 높이에 들어가는 가장 작은 크기로 줄이고 …를 붙인다
  const size = [...sizes].reverse().find((s) => heightOk(s, Math.min(maxLines, explicit.length))) ?? sizes[sizes.length - 1];
  const source = explicit.length > 1 ? explicit.slice(0, maxLines) : [explicit[0]];
  if (source.length > 1) {
    return { size, lines: source.map((line) => ellipsize((t) => measure(t, size), line, maxWidth)), truncated: source.some((line) => measure(line, size) > maxWidth) };
  }
  const wrapped = wrap((t) => measure(t, size), source[0], maxWidth, maxLines);
  return { size, lines: wrapped.lines, truncated: wrapped.truncated };
}

/** 폭을 넘으면 끝을 …로 줄인다. */
export function ellipsize(measure, text, maxWidth) {
  if (measure(text) <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && measure(`${out}…`) > maxWidth) out = out.slice(0, -1);
  return `${out}…`;
}

/** 글자 단위로 줄을 나눈다(한글은 띄어쓰기 없이도 끊는다). 마지막 줄이 넘치면 …로 줄이고 truncated를 켠다. */
export function wrap(measure, text, maxWidth, maxLines) {
  const lines = [];
  let line = "";
  for (const ch of text) {
    if (line && measure(line + ch) > maxWidth) {
      if (lines.length === maxLines - 1) {
        return { lines: [...lines, ellipsize(measure, `${line}${ch}`, maxWidth)], truncated: true };
      }
      lines.push(line);
      line = ch === " " ? "" : ch;
    } else {
      line += ch;
    }
  }
  if (line) lines.push(line);
  return { lines, truncated: false };
}

/**
 * 캔버스에 버튼 라벨을 가운데 맞춰 그린다(fitLabel로 크기·줄 수를 고른다). 호출 전에 fillStyle·textAlign은 호출 쪽이 정한다.
 * @returns {{ size: number, lines: string[], truncated: boolean }}
 */
export function drawFitLabel(ctx, text, cx, cy, maxWidth, { weight = 500, family, sizes, maxLines, maxHeight, lineGap = 1.2, align = "center", x } = {}) {
  const fit = fitLabel(
    (t, size) => {
      ctx.font = `${weight} ${size}px ${family}`;
      return ctx.measureText(t).width;
    },
    text,
    maxWidth,
    { sizes, maxLines, maxHeight, lineGap },
  );
  ctx.font = `${weight} ${fit.size}px ${family}`;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  const step = fit.size * lineGap;
  const top = cy - ((fit.lines.length - 1) * step) / 2;
  fit.lines.forEach((line, i) => ctx.fillText(line, align === "left" ? (x ?? cx) : cx, top + i * step + 1));
  return fit;
}
