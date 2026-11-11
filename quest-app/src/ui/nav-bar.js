// 2D 화면 아래쪽 이동 바: [◀ 이전] [번호] [▶ 슬라이드쇼] [간격] [다음 ▶].
// 항목을 열었을 때만 보인다. 무대(.stage) 안에 놓이며 목록 공간을 쓰지 않는다.
import { on } from "../core/events.js";
import { INTERVALS } from "../core/slideshow.js";

/**
 * @param {{
 *   library: ReturnType<typeof import('../core/library.js').createLibrary>,
 *   slideshow: ReturnType<typeof import('../core/slideshow.js').createSlideshow>,
 * }} options
 */
export function createNavBar({ library, slideshow }) {
  const el = document.createElement("div");
  el.className = "navbar";
  el.hidden = true;
  el.setAttribute("role", "toolbar");
  el.setAttribute("aria-label", "이전·다음·슬라이드쇼");
  el.innerHTML = `
    <button class="btn small" type="button" data-act="prev" aria-label="이전 파일">◀ 이전</button>
    <span class="navpos" data-role="pos" aria-live="polite"></span>
    <button class="btn small" type="button" data-act="show" aria-pressed="false">▶ 슬라이드쇼</button>
    <label class="navint"><span class="sr-only">슬라이드쇼 간격</span><select data-role="interval" aria-label="슬라이드쇼 간격"></select></label>
    <button class="btn small" type="button" data-act="next" aria-label="다음 파일">다음 ▶</button>
  `;
  const $ = (selector) => el.querySelector(selector);
  const prev = /** @type {HTMLButtonElement} */ ($('[data-act="prev"]'));
  const next = /** @type {HTMLButtonElement} */ ($('[data-act="next"]'));
  const show = /** @type {HTMLButtonElement} */ ($('[data-act="show"]'));
  const select = /** @type {HTMLSelectElement} */ ($('[data-role="interval"]'));
  const pos = $('[data-role="pos"]');
  for (const seconds of INTERVALS) {
    const option = document.createElement("option");
    option.value = String(seconds);
    option.textContent = `${seconds}초`;
    select.appendChild(option);
  }

  prev.addEventListener("click", () => library.prev());
  next.addEventListener("click", () => library.next());
  show.addEventListener("click", () => slideshow.toggle());
  select.addEventListener("change", () => slideshow.setInterval(Number(select.value)));

  function render() {
    const current = library.current;
    el.hidden = !current;
    if (!current) return;
    const list = library.playlist;
    const index = list.findIndex((entry) => entry.id === current.id);
    pos.textContent = index >= 0 && list.length > 1 ? `${index + 1} / ${list.length}` : "";
    const canStep = list.length > 1;
    prev.disabled = !canStep;
    next.disabled = !canStep;
    show.disabled = !canStep && !slideshow.running;
    show.textContent = slideshow.running ? "⏸ 슬라이드쇼 멈춤" : "▶ 슬라이드쇼";
    show.setAttribute("aria-pressed", String(slideshow.running));
    select.value = String(slideshow.interval);
  }

  for (const name of ["library:changed", "item:loading", "item:opened", "item:error", "item:closed", "slideshow:changed"]) on(name, render);
  render();

  return { element: el, render };
}
