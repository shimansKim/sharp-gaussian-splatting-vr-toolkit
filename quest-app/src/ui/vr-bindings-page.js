// VR 공용 패널 [더 보기] > [컨트롤러 버튼 지정] 화면(ui/vr-panel.js가 page "bindings"로 보여 준다).
// 사람 요청(실기기 2026-11-13): "VR에서 컨트롤러 지정이 되야함."
// - 범위 탭(모든 화면·영상/사진·PLY)마다 동작과 지금 배정을 줄로 보인다(충돌이면 ⚠).
// - 줄을 누르면 "지정할 버튼을 누르세요" 상태: 사람이 누른 버튼(떼면 '짧게', 0.8초 넘게 누르면 '길게')·스틱 방향을 받아 배정한다(core/binding-capture.js).
//   그동안과, 지정이 끝나 손을 다 뗄 때까지는 그 입력이 다른 동작(UI 켜기·끄기, 이전·다음 등)을 실행하지 않는다(inputBlocked).
// - [취소]·[이 줄 기본값]·[지정 안 함]·[양손]·[모두 기본값].
// - 안전장치: UI 켜기·끄기는 비워 둘 수 없고 트리거에 둘 수 없다(core/bindings.js required·avoidButtons).
//   UI 켜기·끄기를 바꾸면 10초 안에 새 버튼을 한 번 눌러 확인해야 하고, 확인하지 않으면 원래 버튼으로 되돌린다.
//   [모두 기본값]은 언제든 B/Y로 돌아오는 길이다.
// 저장은 core/bindings.js 저장소 그대로라 PC 동기화 규칙(나중에 바꾼 쪽이 이긴다)도 그대로다.
import { ACTIONS, FIXED, SCOPES, actionById, allowedFor, bindings as defaultStore, describeAction, describeInput, findConflicts, normalizeInput } from "../core/bindings.js";
import { createBindingCapture, inputIsNeutral } from "../core/binding-capture.js";
import { buttonDown } from "../core/input-map.js";

export const CONFIRM_MS = 10_000;
const SCOPE_ORDER = /** @type {const} */ (["common", "media", "splat"]);
const PROMPT = {
  button: "지정할 버튼을 누르세요 (0.8초 넘게 누르면 '길게'). 트리거는 패널 밖을 가리키고 당기세요.",
  axis: "쓸 스틱을 원하는 방향(좌우·상하)으로 끝까지 미세요.",
  stick: "쓸 스틱을 아무 방향으로 끝까지 미세요.",
};
/** 패널 제목 아래 짧은 안내(긴 안내·결과는 화면 안 큰 상자에 보인다) */
export const PAGE_HINT = "줄을 누른 뒤 지정할 버튼·스틱을 누르세요 · 취소는 [취소]";

/**
 * @param {{ store?: ReturnType<typeof import('../core/bindings.js').createBindingStore>, now?: () => number, onChange?: () => void }} [options]
 */
export function createVrBindingsPage({ store = defaultStore, now = () => performance.now(), onChange = () => {} } = {}) {
  let scope = "common";
  /** 지정 중인 동작 id와 받는 중인 입력 */
  let capturing = null;
  let capture = null;
  /** '양손(어느 손이든)'으로 지정할지. 동작을 고를 때 지금 배정이 양손이면 켠다. */
  let either = false;
  /** UI 켜기·끄기를 바꾼 뒤 확인 대기 { previous, value, deadline } */
  let confirm = null;
  /** 지정·확인이 끝난 뒤 사람이 손을 다 뗄 때까지 입력을 막는다 */
  let waitRelease = false;
  let message = "";

  const changed = () => onChange();
  const nameOf = (id) => actionById(id)?.label ?? FIXED.find((f) => f.id === id)?.label ?? id;

  function begin(id) {
    const action = actionById(id);
    if (!action) return;
    capturing = id;
    const current = store.get()[id];
    either = action.kind === "button" && current?.hand === "either";
    capture = createBindingCapture({ kind: action.kind, either, now });
    message = `「${action.label}」 ${PROMPT[action.kind]}`;
    changed();
  }

  function cancel(text = "지정을 취소했습니다.") {
    if (!capturing) return;
    capturing = null;
    capture = null;
    waitRelease = true;
    message = text;
    changed();
  }

  /** 동작에 값을 둔다(안전장치·충돌 안내 포함). */
  function assign(id, value) {
    const action = actionById(id);
    const normalized = value === null ? null : normalizeInput(action.kind, value);
    if (normalized === undefined) return;
    if (!allowedFor(action, normalized)) {
      message = normalized === null ? `「${action.label}」은(는) 비워 둘 수 없습니다(메뉴로 돌아오는 길).` : `「${action.label}」은(는) ${describeInput(action.kind, normalized)}에 둘 수 없습니다(패널 선택과 겹칩니다). 다른 버튼을 누르세요.`;
      changed();
      return false;
    }
    const previous = store.get()[id];
    store.set(id, normalized);
    const map = store.get();
    const clashes = findConflicts(map).filter((c) => c.a === id || c.b === id).map((c) => nameOf(c.a === id ? c.b : c.a));
    message = `「${action.label}」 → ${describeInput(action.kind, normalized)}${clashes.length ? ` · ⚠ ${clashes.join(", ")}과(와) 같은 입력입니다(둘 다 동작). 하나를 바꾸세요.` : ""}`;
    if (id === "common.uiToggle" && !sameValue(previous, normalized)) {
      confirm = { previous, value: normalized, deadline: now() + CONFIRM_MS };
      message = `UI 켜기·끄기를 ${describeInput("button", normalized)}(으)로 바꿨습니다. 10초 안에 그 버튼을 한 번 눌러 확인하세요. 확인하지 않으면 ${describeInput("button", previous)}(으)로 되돌립니다.`;
    }
    changed();
    return true;
  }

  const sameValue = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

  return {
    /** 지정 중·확인 대기 중·손을 떼기 전에는 true: 앱은 그동안 공통 버튼(UI 켜기·끄기, 이전·다음)을 처리하지 않는다. */
    get inputBlocked() {
      return !!capturing || !!confirm || waitRelease;
    },
    get capturing() {
      return capturing;
    },
    get confirming() {
      return confirm ? { ...confirm, remainingMs: Math.max(0, confirm.deadline - now()) } : null;
    },
    get scope() {
      return scope;
    },
    /** 패널 제목 아래 안내 줄에 보일 문구(없으면 빈 문자열). */
    get message() {
      if (confirm) {
        const left = Math.ceil(Math.max(0, confirm.deadline - now()) / 1000);
        return `새 UI 켜기·끄기 버튼(${describeInput("button", confirm.value)})을 한 번 눌러 확인하세요 · ${left}초 뒤 되돌림`;
      }
      return message;
    },
    begin,
    cancel,
    assign,
    /** 화면을 떠날 때: 지정 중이면 취소(확인 대기는 계속: 시간이 지나면 되돌린다). */
    leave() {
      if (capturing) cancel("");
    },

    /**
     * 매 프레임(패널이 보이지 않아도). 지정 입력을 받고, UI 켜기·끄기 확인 시간을 잰다.
     * @param {import('../core/types.js').XrInput} input
     * @param {{ left?: boolean, right?: boolean }} rayOnPanel
     */
    tick(input, rayOnPanel = {}) {
      if (!input?.presenting) {
        if (capturing) cancel("");
        return;
      }
      if (capturing && capture) {
        const value = capture.update(input, rayOnPanel);
        if (value !== undefined) {
          const id = capturing;
          capturing = null;
          capture = null;
          waitRelease = true;
          if (assign(id, value) === false) {
            // 둘 수 없는 입력이었다: 까닭을 남기고 다시 받는다
            const why = message;
            begin(id);
            message = why;
          }
        }
      }
      if (confirm) {
        if (!waitRelease && buttonDown(input, confirm.value)) {
          confirm = null;
          waitRelease = true;
          message = "확인했습니다. 이제 이 버튼이 UI 켜기·끄기입니다.";
          changed();
        } else if (now() >= confirm.deadline) {
          const back = confirm.previous;
          confirm = null;
          store.set("common.uiToggle", back);
          message = `확인하지 않아 UI 켜기·끄기를 ${describeInput("button", back)}(으)로 되돌렸습니다.`;
          changed();
        } else {
          changed(); // 남은 초를 다시 그린다
        }
      }
      if (waitRelease && !capturing && inputIsNeutral(input)) {
        waitRelease = false;
        changed();
      }
    },

    /**
     * 화면 버튼들(캔버스 좌표). vr-panel이 일반 버튼처럼 그리고 누른다.
     * @param {{ W: number, margin: number, top: number, bottom: number, gap?: number }} box
     */
    layout({ W, margin, top, bottom, gap = 14 }) {
      const out = [];
      const map = store.get();
      const conflicted = new Set(findConflicts(map).flatMap((c) => [c.a, c.b]));
      const width = W - margin * 2;
      // 범위 탭
      const tabW = (width - gap * 2) / 3;
      SCOPE_ORDER.forEach((s, i) => {
        out.push({ x: margin + i * (tabW + gap), y: top, w: tabW, h: 60, align: "center", label: SCOPES[s], on: scope === s, enabled: !capturing, run: () => {
          scope = s;
          changed();
        } });
      });
      // 동작 줄
      const rowH = 66;
      const step = 74;
      let y = top + 76;
      for (const action of ACTIONS.filter((a) => a.scope === scope)) {
        const active = capturing === action.id;
        const conflict = conflicted.has(action.id);
        out.push({
          x: margin,
          y,
          w: width,
          h: rowH,
          label: action.label,
          side: active ? "누르세요…" : `${conflict ? "⚠ " : ""}${describeAction(map, action.id)}`,
          current: active,
          enabled: !capturing || active,
          run: () => (active ? cancel() : begin(action.id)),
        });
        y += step;
      }
      for (const fixed of FIXED.filter((f) => f.scope === scope)) {
        out.push({ x: margin, y, w: width, h: rowH - 8, label: fixed.label, side: `${fixed.text} (고정)`, enabled: false });
        y += step - 8;
      }
      // 안내·결과 상자: 줄어든 패널에서도 읽히게 큰 글씨로 화면 안에 보인다(제목 아래 줄은 짧은 안내만).
      const note = this.message;
      if (note) {
        out.push({ x: margin, y: bottom - 70 - 16 - 132, w: width, h: 132, align: "center", label: note, enabled: false, note: true });
      }
      // 아래 조작 줄
      const controls = capturing
        ? [
            { label: "취소", run: () => cancel() },
            { label: "이 줄 기본값", run: () => {
              const id = capturing;
              cancel("");
              store.reset(id);
              message = `「${nameOf(id)}」을(를) 기본값(${describeAction(store.get(), id)})으로 되돌렸습니다.`;
              changed();
            } },
            ...(actionById(capturing).required ? [] : [{ label: "지정 안 함", run: () => {
              const id = capturing;
              cancel("");
              assign(id, null);
            } }]),
            ...(actionById(capturing).kind === "button"
              ? [{ label: either ? "양손: 켬" : "양손: 끔", on: either, run: () => {
                  either = !either;
                  capture = createBindingCapture({ kind: "button", either, now });
                  changed();
                } }]
              : []),
          ]
        : [
            { label: "모두 기본값", run: () => {
              store.reset();
              confirm = null;
              message = "모든 버튼을 기본값으로 되돌렸습니다(UI 켜기·끄기 = B/Y).";
              changed();
            } },
          ];
      const ctrlW = Math.min(240, (width - gap * (controls.length - 1)) / controls.length);
      controls.forEach((c, i) => {
        out.push({ x: margin + i * (ctrlW + gap), y: bottom - 70, w: ctrlW, h: 64, align: "center", enabled: true, ...c });
      });
      return out;
    },
  };
}
