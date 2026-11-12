import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { Vector3 } from 'three';

// node에는 DOM이 없으므로 그리기 호출은 모두 받아 넘기는 캔버스 대역을 쓴다.
function fakeContext() {
  const target = { measureText: (t) => ({ width: String(t).length * 10 }) };
  return new Proxy(target, {
    get: (t, key) => (key in t ? t[key] : () => {}),
    set: () => true,
  });
}

let VrHud;
let formatTime;
let HUD_WIDTH_M;
let HUD_H;
before(async () => {
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => fakeContext() }) };
  let HUD_CANVAS;
  ({ VrHud, formatTime, HUD_WIDTH_M, HUD_CANVAS } = await import('../src/viewers/media/vr-hud.js'));
  HUD_H = HUD_CANVAS.H;
});

test('formatTime', () => {
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(65.9), '1:05');
  assert.equal(formatTime(3725), '1:02:05');
  assert.equal(formatTime(NaN), '--:--');
  assert.equal(formatTime(-1), '--:--');
  assert.equal(formatTime(Infinity), '--:--');
});

function center(hud, id) {
  const b = hud.buttons.find((x) => x.id === id);
  return [b.x + b.w / 2, b.y + b.h / 2];
}

test('영상 패널 기본 화면: 자주 쓰는 10개만 있고, 눌리며, 탐색 막대가 비율을 낸다', () => {
  const hud = new VrHud(() => {});
  hud.setState({ kind: 'video', stereo: true, canScale: true, navCanStep: true });
  const ids = hud.buttons.map((b) => b.id).filter((id) => id !== 'close');
  assert.deepEqual(ids, ['back10', 'play', 'fwd10', 'navPrev', 'navNext', 'navShow', 'sizeDown', 'sizeUp', 'navList', 'more']);
  for (const id of [...ids, 'close']) {
    const hit = hud.hitTest(...center(hud, id));
    assert.deepEqual(hit, { type: 'button', id }, id);
  }
  // 드물게 쓰는 것은 기본 화면에 없다
  for (const id of ['mute', 'loop', 'diag', 'swap', 'layoutPrev', 'layoutNext', 'recenter', 'navInterval']) assert.ok(!hud.buttons.some((b) => b.id === id), `${id}는 [더 보기]에`);
  const bar = hud.seek;
  const seek = hud.hitTest(bar.x + bar.w / 2, bar.y + bar.h / 2);
  assert.equal(seek.type, 'seek');
  assert.ok(Math.abs(seek.fraction - 0.5) < 1e-9);
  assert.equal(hud.hitTest(bar.x - 10, bar.y).fraction, 0);
  assert.equal(hud.hitTest(bar.x + bar.w + 10, bar.y).fraction, 1);
});

test('[더 보기]를 누르면 소리·반복·눈 바꿈·진단·형식·위치 맞춤·간격 화면으로 바뀌고, [돌아가기]나 숨기기로 기본 화면에 돌아온다', () => {
  const actions = [];
  const hud = new VrHud((id) => actions.push(id));
  hud.setState({ kind: 'video', stereo: true, canScale: true, navCanStep: true });
  hud.setVisible(true);
  assert.equal(hud.page, 'main');
  hud._press('more'); // 화면 전환은 앱에 알리지 않는다
  assert.deepEqual(actions, []);
  assert.equal(hud.page, 'more');
  const ids = hud.buttons.map((b) => b.id).filter((id) => id !== 'close');
  assert.deepEqual(ids, ['mute', 'loop', 'swap', 'diag', 'layoutPrev', 'layoutLabel', 'layoutNext', 'recenter', 'navInterval', 'less']);
  assert.ok(!hud.buttons.some((b) => b.id === 'play'), '한 번에 한 화면만 보인다');
  assert.equal(hud.hitTest(...center(hud, 'mute')).id, 'mute');
  assert.equal(hud.hitTest(...center(hud, 'swap')).id, 'swap');
  hud._press('less');
  assert.equal(hud.page, 'main');
  hud._press('more');
  hud.setVisible(false); // 숨기면 기본 화면으로
  assert.equal(hud.page, 'main');
  assert.ok(hud.buttons.some((b) => b.id === 'play'));
});

test('비활성 버튼은 눌리지 않는다: 눈 바꿈(모노), 줌(360)', () => {
  const hud = new VrHud(() => {});
  hud.setState({ kind: 'video', stereo: false, canScale: false });
  assert.equal(hud.hitTest(...center(hud, 'sizeUp')), null);
  hud._press('more');
  assert.equal(hud.hitTest(...center(hud, 'swap')), null);
  hud._press('less');
  hud.setState({ stereo: true, canScale: true });
  assert.equal(hud.hitTest(...center(hud, 'sizeUp')).id, 'sizeUp');
  hud._press('more');
  assert.equal(hud.hitTest(...center(hud, 'swap')).id, 'swap');
});

test('사진 패널에는 재생 컨트롤과 탐색 막대가 없고, 기본 화면은 7개뿐이다', () => {
  const hud = new VrHud(() => {});
  hud.setState({ kind: 'image', stereo: true, canScale: true, navCanStep: true });
  assert.deepEqual(hud.buttons.map((b) => b.id).filter((id) => id !== 'close'), ['navPrev', 'navNext', 'navShow', 'navList', 'sizeDown', 'sizeUp', 'more']);
  hud._press('more');
  const ids = hud.buttons.map((b) => b.id);
  assert.ok(!ids.some((id) => ['play', 'back10', 'fwd10', 'mute', 'loop'].includes(id)));
  assert.ok(ids.includes('layoutNext'));
  const bar = hud.seek;
  assert.equal(hud.hitTest(bar.x + bar.w / 2, bar.y + bar.h / 2), null);
});

test('레이 교차 → 캔버스 좌표 → 버튼 동작(컨트롤러 트리거 한 번에 한 번만)', () => {
  const actions = [];
  const hud = new VrHud((id, value) => actions.push([id, value]));
  hud.setState({ kind: 'video', stereo: true });
  hud.setVisible(true);
  hud.mesh.position.set(0, 0, -1);
  hud.mesh.updateMatrixWorld(true);
  const [cx, cy] = center(hud, 'play');
  // 캔버스 좌표 → 패널 위 월드 좌표 → 정면에서 쏘는 레이
  const x = (cx / 1024 - 0.5) * HUD_WIDTH_M;
  const y = (0.5 - cy / HUD_H) * HUD_WIDTH_M * (HUD_H / 1024);
  const origin = new Vector3(x, y, 0);
  const direction = new Vector3(0, 0, -1);
  const hit = hud.intersect(origin, direction);
  assert.ok(hit && Math.abs(hit.px - cx) < 1 && Math.abs(hit.py - cy) < 1);

  const pointer = (pressed) => [{ id: 'right', origin, direction, pressed }];
  hud.updatePointers(pointer(false), 0);
  hud.updatePointers(pointer(true), 16);
  hud.updatePointers(pointer(true), 32); // 누르고 있는 동안 반복하지 않는다
  hud.updatePointers(pointer(false), 48);
  assert.deepEqual(actions, [['play', undefined]]);

  // 패널 밖을 가리키면 적중 없음
  const miss = hud.updatePointers([{ id: 'right', origin: new Vector3(5, 5, 0), direction, pressed: false }], 64);
  assert.equal(miss.get('right'), null);
});

test('탐색 막대 드래그: 누르면 바로, 끌면 200ms 간격으로, 떼면 마지막 위치를 낸다', () => {
  const actions = [];
  const hud = new VrHud((id, value) => actions.push([id, value]));
  hud.setState({ kind: 'video', stereo: true });
  hud.setVisible(true);
  hud.mesh.position.set(0, 0, -1);
  hud.mesh.updateMatrixWorld(true);
  const at = (fraction) => {
    const px = hud.seek.x + hud.seek.w * fraction;
    const py = hud.seek.y + hud.seek.h / 2;
    return new Vector3((px / 1024 - 0.5) * HUD_WIDTH_M, (0.5 - py / HUD_H) * HUD_WIDTH_M * (HUD_H / 1024), 0);
  };
  const dir = new Vector3(0, 0, -1);
  hud.updatePointers([{ id: 1, origin: at(0.2), direction: dir, pressed: true }], 1000);
  hud.updatePointers([{ id: 1, origin: at(0.3), direction: dir, pressed: true }], 1050); // 너무 일러서 건너뜀
  hud.updatePointers([{ id: 1, origin: at(0.6), direction: dir, pressed: true }], 1300);
  hud.updatePointers([{ id: 1, origin: at(0.9), direction: dir, pressed: false }], 1310);
  const fractions = actions.filter(([id]) => id === 'seek').map(([, v]) => +v.toFixed(2));
  assert.deepEqual(fractions, [0.2, 0.6, 0.9]);
});

test('wrapText: 긴 경고를 글자 단위로 두 줄에 나누고 넘치면 …로 줄인다', async () => {
  const { wrapText } = await import('../src/viewers/media/vr-hud.js');
  const measure = (t) => [...t].length * 10;
  assert.deepEqual(wrapText(measure, '짧은 경고', 200, 2), ['짧은 경고']);
  const two = wrapText(measure, 'a'.repeat(30), 200, 2);
  assert.equal(two.length, 2);
  assert.equal(two[0].length, 20);
  assert.equal(two[1], 'a'.repeat(10));
  const cut = wrapText(measure, 'a'.repeat(50), 200, 2);
  assert.equal(cut.length, 2);
  assert.ok(cut[1].endsWith('…'));
  assert.ok(measure(cut[1]) <= 200);
});

test('형식 버튼 문구: 형식이 바뀌면 이름이 바로 바뀌고, 다시 그린 캔버스는 GPU 텍스처로 다시 올라간다', () => {
  const hud = new VrHud(() => {});
  hud.setVisible(true);
  hud.setState({ kind: 'video', layoutShort: 'VR180', layoutLabel: 'VR180 3D 좌우(SBS)' });
  hud._press('more'); // 형식 줄은 [더 보기] 화면에 있다
  const label = () => hud.buttons.find((b) => b.id === 'layoutLabel').label;
  assert.equal(label(), 'VR180');
  hud.tick();
  const v0 = hud.texture.version;
  hud.setState({ kind: 'video', layoutShort: '360 TB', layoutLabel: '360° 3D 위아래(TB)' });
  assert.equal(label(), '360 TB', '버튼 글씨가 새 형식으로 바뀐다');
  hud.tick();
  assert.ok(hud.texture.version > v0, '캔버스를 다시 그리면 texture.needsUpdate로 다시 올린다(없으면 패널이 첫 모습으로 굳는다)');
  const v1 = hud.texture.version;
  hud.tick();
  assert.equal(hud.texture.version, v1, '바뀐 게 없으면 다시 올리지 않는다');
});

test('패널은 눈높이 아래·앞의 도크에 놓이고 place()를 다시 부르기 전에는 움직이지 않는다', async () => {
  const { DOCK_TOP_DROP, DOCK_TOP_FORWARD } = await import('../src/core/panel-layout.js');
  const hud = new VrHud(() => {});
  assert.equal(hud.dock(), null, '아직 놓지 않았으면 도크 자리가 없다');
  hud.place(new Vector3(0, 1.6, 0), 0);
  // 윗변 한가운데가 도크 기준점에 와야 한다(월드 기준 위쪽 가장자리 중심).
  const topCenter = new Vector3(0, HUD_WIDTH_M * (HUD_H / 1024) / 2, 0).applyEuler(hud.mesh.rotation).add(hud.mesh.position);
  assert.ok(Math.abs(topCenter.y - (1.6 - DOCK_TOP_DROP)) < 1e-6 && Math.abs(topCenter.z + DOCK_TOP_FORWARD) < 1e-6, `윗변 중심 ${topCenter.toArray()}`);
  // 3D 스크린(가로 90°, 위아래 ±29°)의 아래 가장자리보다 패널 윗변이 더 아래에 있어야 겹치지 않는다.
  const angleBelow = Math.atan2(1.6 - topCenter.y, -topCenter.z) * (180 / Math.PI);
  assert.ok(angleBelow > 29 + 2, `패널 윗변이 수평선 아래 ${angleBelow.toFixed(1)}° — 스크린 아래 가장자리(29°)보다 아래`);
  const pos = hud.mesh.position.clone();
  hud.setState({ kind: 'video', layoutShort: 'X' });
  hud.setVisible(true);
  hud.updatePointers([{ id: 'r', origin: new Vector3(0, 0, 0), direction: new Vector3(0, 0, -1), pressed: true }], 0);
  hud.tick();
  assert.ok(hud.mesh.position.equals(pos), '누르거나 상태가 바뀌어도 패널 자리는 그대로');
});

test('이동 버튼: 이전·다음·슬라이드쇼·목록(기본)·간격(더 보기)이 nav 동작을 내고, 한 항목뿐이면 이전·다음은 눌리지 않는다', () => {
  const hud = new VrHud(() => {});
  hud.setState({ kind: 'image', stereo: false, navCanStep: false, navPos: '', navShow: false, navInterval: 5 });
  assert.equal(hud.hitTest(...center(hud, 'navPrev')), null);
  assert.equal(hud.hitTest(...center(hud, 'navNext')), null);
  assert.equal(hud.hitTest(...center(hud, 'navShow')), null, '넘길 항목이 없으면 슬라이드쇼도 못 켠다');
  assert.equal(hud.hitTest(...center(hud, 'navList')).id, 'navList');
  hud.setState({ navCanStep: true, navPos: '2 / 9', navShow: false, navInterval: 8 });
  for (const id of ['navPrev', 'navNext', 'navShow', 'navList']) {
    const hit = hud.hitTest(...center(hud, id));
    assert.equal(hit?.id, id, id);
  }
  assert.equal(hud.buttons.find((b) => b.id === 'navShow').label, '슬라이드쇼\n▶ 시작');
  hud.setState({ navShow: true });
  assert.equal(hud.buttons.find((b) => b.id === 'navShow').label, '슬라이드쇼\n■ 정지');
  assert.equal(hud.buttons.find((b) => b.id === 'navShow').on, true);
  // 켜져 있으면 항목이 하나뿐이어도 끌 수 있다
  hud.setState({ navCanStep: false });
  assert.equal(hud.hitTest(...center(hud, 'navShow'))?.id, 'navShow');
  // 간격은 [더 보기] 화면
  hud._press('more');
  assert.equal(hud.buttons.find((b) => b.id === 'navInterval').label, '슬라이드쇼 간격 8초');
  assert.equal(hud.hitTest(...center(hud, 'navInterval')).id, 'navInterval');
});

test('두 화면 모두 영상·사진에서 버튼이 캔버스 안에 있고 서로 겹치지 않는다', () => {
  for (const page of ['main', 'more']) {
  for (const kind of ['video', 'image']) {
    const hud = new VrHud(() => {});
    hud.setState({ kind, stereo: true, canScale: true, navCanStep: true });
    if (page === 'more') hud._press('more');
    const rects = hud.buttons;
    for (let i = 0; i < rects.length; i++) {
      assert.ok(rects[i].x >= 0 && rects[i].x + rects[i].w <= 1024 && rects[i].y + rects[i].h <= HUD_H, `${kind}/${page} ${rects[i].id} 캔버스 안`);
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        assert.ok(!overlap, `${kind}/${page}: ${a.id} 와 ${b.id} 겹침`);
      }
    }
  }
  }
});

test('detachSurface: 세션이 끝나면 레이어를 걷고 메시를 다시 보이게 한다(레이어가 없어도 안전)', () => {
  const hud = new VrHud(() => {});
  assert.doesNotThrow(() => hud.detachSurface());
  let detached = 0;
  hud.surface = { detach: () => detached++, sync: () => true, invalidate() {} };
  hud.material.visible = false; // 레이어로 그리는 중
  hud.detachSurface();
  assert.equal(detached, 1);
  assert.equal(hud.material.visible, true);
});

test('media-viewer는 세션 종료 때 HUD 레이어도 걷는다', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../src/viewers/media/media-viewer.js', import.meta.url), 'utf8');
  const handler = source.slice(source.indexOf('_onSessionEnd = () => {'));
  assert.match(handler.slice(0, handler.indexOf('};')), /this\.hud\.detachSurface\(\)/);
});
