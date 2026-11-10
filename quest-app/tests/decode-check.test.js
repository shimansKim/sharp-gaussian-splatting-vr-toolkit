import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { checkVideoDecode, questLimitWarnings, summarizeWarnings } from '../src/viewers/media/decode-check.js';

const codes = (warnings) => warnings.map((w) => w.code);

test('이 저장소의 8192x2730 H.264 출력은 4K 한계 초과 오류를 낸다', () => {
  const w = questLimitWarnings({ family: 'h264', width: 8192, height: 2730, frameRate: 30 });
  assert.ok(codes(w).includes('h264-over-4k'));
  assert.equal(w.find((x) => x.code === 'h264-over-4k').level, 'error');
  assert.match(w[0].text, /HEVC/);
});

test('HEVC 8192x4096@60은 경고 없음, 한계를 넘으면 오류', () => {
  assert.deepEqual(questLimitWarnings({ family: 'h265', width: 8192, height: 4096, frameRate: 60 }), []);
  assert.ok(codes(questLimitWarnings({ family: 'h265', width: 8192, height: 8192, frameRate: 30 })).includes('over-hw-limit'));
  assert.ok(codes(questLimitWarnings({ family: 'h265', width: 16384, height: 4096, frameRate: 30 })).includes('over-hw-limit'));
});

test('H.264 4K까지는 통과, 고해상도 VP9/VP8은 소프트웨어 디코드 경고', () => {
  assert.deepEqual(questLimitWarnings({ family: 'h264', width: 3840, height: 2160, frameRate: 30 }), []);
  assert.deepEqual(questLimitWarnings({ family: 'h264', width: 4096, height: 2048, frameRate: 30 }), []);
  assert.ok(codes(questLimitWarnings({ family: 'vp9', width: 5760, height: 2880, frameRate: 30 })).includes('sw-decode'));
  assert.ok(codes(questLimitWarnings({ family: 'vp8', width: 1280, height: 720, frameRate: 30 })).includes('sw-decode'));
  assert.deepEqual(questLimitWarnings({ family: 'vp9', width: 1920, height: 1080, frameRate: 30 }), []);
});

test('4K 초과 해상도의 60fps 초과는 경고', () => {
  assert.ok(codes(questLimitWarnings({ family: 'h265', width: 5760, height: 2880, frameRate: 120 })).includes('high-fps'));
  assert.deepEqual(questLimitWarnings({ family: 'h265', width: 1920, height: 1080, frameRate: 120 }), []);
});

const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
afterEach(() => {
  if (original) Object.defineProperty(globalThis, 'navigator', original);
  else delete globalThis.navigator;
});

function fakeNavigator(decodingInfo) {
  Object.defineProperty(globalThis, 'navigator', { value: { mediaCapabilities: { decodingInfo } }, configurable: true, writable: true });
}

test('MediaCapabilities를 쓸 수 없으면 info 경고만 낸다', async () => {
  Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true, writable: true });
  const r = await checkVideoDecode({ name: 'a.mp4', family: 'h265', codec: 'hvc1.1.6.L153.B0', width: 4096, height: 2048 });
  assert.equal(r.supported, null);
  assert.deepEqual(codes(r.warnings), ['no-capabilities']);
  assert.ok(r.ok);
});

test('디코딩 불가 보고는 오류, 요청에는 컨테이너·코덱·해상도가 실린다', async () => {
  let asked;
  fakeNavigator(async (config) => {
    asked = config;
    return { supported: false, smooth: false, powerEfficient: false };
  });
  const r = await checkVideoDecode({ name: 'a.mp4', family: 'h265', codec: 'hvc1.1.6.L153.B0', width: 4096, height: 2048, frameRate: 30 });
  assert.equal(r.ok, false);
  assert.ok(codes(r.warnings).includes('unsupported'));
  assert.equal(asked.type, 'file');
  assert.match(asked.video.contentType, /^video\/mp4; codecs="hvc1\.1\.6\.L153\.B0"$/);
  assert.equal(asked.video.width, 4096);
  assert.equal(asked.video.framerate, 30);
  assert.match(summarizeWarnings(r), /디코딩할 수 없다/);
});

test('끊김·전력 경고 단계', async () => {
  fakeNavigator(async () => ({ supported: true, smooth: false, powerEfficient: false }));
  const rough = await checkVideoDecode({ name: 'a.mp4', family: 'h265', codec: 'hvc1.1.6.L153.B0', width: 4096, height: 2048 });
  assert.deepEqual(codes(rough.warnings), ['not-smooth']);
  fakeNavigator(async () => ({ supported: true, smooth: true, powerEfficient: false }));
  const sw = await checkVideoDecode({ name: 'a.mp4', family: 'h265', codec: 'hvc1.1.6.L153.B0', width: 4096, height: 2048 });
  assert.deepEqual(codes(sw.warnings), ['sw-decode']);
  assert.ok(sw.ok, 'info만 있으면 ok');
  fakeNavigator(async () => ({ supported: true, smooth: true, powerEfficient: true }));
  const good = await checkVideoDecode({ name: 'a.mp4', family: 'h265', codec: 'hvc1.1.6.L153.B0', width: 4096, height: 2048 });
  assert.deepEqual(good.warnings, []);
});

test('코덱을 모르면 후보를 차례로 시험해 지원되는 첫 코덱을 고른다(webm은 VP9/AV1만)', async () => {
  const tried = [];
  fakeNavigator(async ({ video }) => {
    tried.push(video.contentType);
    return { supported: /vp09/.test(video.contentType), smooth: true, powerEfficient: true };
  });
  const r = await checkVideoDecode({ name: 'clip.webm', width: 1920, height: 1080 });
  assert.equal(r.family, 'vp9');
  assert.ok(tried.every((t) => t.startsWith('video/webm')));
  assert.ok(tried.every((t) => !/avc1|hvc1/.test(t)));
  assert.equal(r.supported, true);
});

test('H.264 8K는 MediaCapabilities가 괜찮다고 해도 오류를 유지한다', async () => {
  fakeNavigator(async () => ({ supported: true, smooth: true, powerEfficient: true }));
  const r = await checkVideoDecode({ name: 'a.mp4', family: 'h264', codec: 'avc1.640033', width: 8192, height: 2730, frameRate: 30 });
  assert.equal(r.ok, false);
  assert.equal(summarizeWarnings(r).includes('HEVC'), true);
});
