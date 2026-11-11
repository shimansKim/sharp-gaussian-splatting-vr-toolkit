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
before(async () => {
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => fakeContext() }) };
  ({ VrHud, formatTime, HUD_WIDTH_M } = await import('../src/viewers/media/vr-hud.js'));
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

test('영상 패널: 재생·10초·형식 버튼이 눌리고 탐색 막대가 비율을 낸다', () => {
  const actions = [];
  const hud = new VrHud((id, value) => actions.push([id, value]));
  hud.setState({ kind: 'video', stereo: true, canScale: false });
  for (const id of ['play', 'back10', 'fwd10', 'layoutPrev', 'layoutNext', 'recenter', 'close', 'mute', 'loop']) {
    const hit = hud.hitTest(...center(hud, id));
    assert.deepEqual(hit, { type: 'button', id }, id);
  }
  const bar = hud.seek;
  const seek = hud.hitTest(bar.x + bar.w / 2, bar.y + bar.h / 2);
  assert.equal(seek.type, 'seek');
  assert.ok(Math.abs(seek.fraction - 0.5) < 1e-9);
  assert.equal(hud.hitTest(bar.x - 10, bar.y).fraction, 0);
  assert.equal(hud.hitTest(bar.x + bar.w + 10, bar.y).fraction, 1);
});

test('비활성 버튼은 눌리지 않는다: 눈 바꿈(모노), 크기(360)', () => {
  const hud = new VrHud(() => {});
  hud.setState({ kind: 'video', stereo: false, canScale: false });
  assert.equal(hud.hitTest(...center(hud, 'swap')), null);
  assert.equal(hud.hitTest(...center(hud, 'sizeUp')), null);
  hud.setState({ stereo: true, canScale: true });
  assert.equal(hud.hitTest(...center(hud, 'swap')).id, 'swap');
  assert.equal(hud.hitTest(...center(hud, 'sizeUp')).id, 'sizeUp');
});

test('사진 패널에는 재생 컨트롤과 탐색 막대가 없다', () => {
  const hud = new VrHud(() => {});
  hud.setState({ kind: 'image', stereo: true });
  assert.ok(!hud.buttons.some((b) => ['play', 'back10', 'fwd10', 'mute', 'loop'].includes(b.id)));
  assert.ok(hud.buttons.some((b) => b.id === 'layoutNext'));
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
  const y = (0.5 - cy / 400) * HUD_WIDTH_M * (400 / 1024);
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
    return new Vector3((px / 1024 - 0.5) * HUD_WIDTH_M, (0.5 - py / 400) * HUD_WIDTH_M * (400 / 1024), 0);
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

test('패널은 눈높이 아래·앞에 놓이고 place()를 다시 부르기 전에는 움직이지 않는다', async () => {
  const { HUD_DISTANCE, HUD_DROP } = await import('../src/viewers/media/vr-hud.js');
  const hud = new VrHud(() => {});
  hud.place(new Vector3(0, 1.6, 0), 0);
  assert.ok(Math.abs(hud.mesh.position.y - (1.6 - HUD_DROP)) < 1e-6 && Math.abs(hud.mesh.position.z + HUD_DISTANCE) < 1e-6);
  // 3D 스크린(가로 90°, 위아래 ±29°)의 아래 가장자리보다 패널 위쪽 가장자리가 더 아래에 있어야 겹치지 않는다.
  const top = hud.mesh.position.y + 0.5 * HUD_WIDTH_M * (400 / 1024) * Math.cos(0.72);
  const angleBelow = Math.atan2(1.6 - top, HUD_DISTANCE) * (180 / Math.PI);
  assert.ok(angleBelow > 29 + 2, `패널 윗변이 수평선 아래 ${angleBelow.toFixed(1)}° — 스크린 아래 가장자리(29°)보다 아래`);
  const pos = hud.mesh.position.clone();
  hud.setState({ kind: 'video', layoutShort: 'X' });
  hud.setVisible(true);
  hud.updatePointers([{ id: 'r', origin: new Vector3(0, 0, 0), direction: new Vector3(0, 0, -1), pressed: true }], 0);
  hud.tick();
  assert.ok(hud.mesh.position.equals(pos), '누르거나 상태가 바뀌어도 패널 자리는 그대로');
});
