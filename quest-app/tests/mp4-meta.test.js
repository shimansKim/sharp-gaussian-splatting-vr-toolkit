import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMp4Meta } from '../src/viewers/media/mp4-meta.js';
import { AVCC_HIGH_40, buildMp4, hvcC, installFakeFetch } from './helpers/mp4-builder.js';

test('H.264 MP4: 코덱 문자열, 해상도, 프레임레이트, 길이를 읽는다', async () => {
  const data = buildMp4({ sample: 'avc1', width: 8192, height: 2730, frames: 300, seconds: 10, codecBox: AVCC_HIGH_40 });
  const fake = installFakeFetch({ 'x.mp4': data });
  try {
    const meta = await readMp4Meta('x.mp4', data.length);
    assert.equal(meta.family, 'h264');
    assert.equal(meta.codec, 'avc1.640028');
    assert.equal(meta.width, 8192);
    assert.equal(meta.height, 2730);
    assert.equal(meta.frameRate, 30);
    assert.equal(meta.durationSec, 10);
    assert.equal(meta.bitrate, Math.round((data.length * 8) / 10));
    assert.equal(meta.stereoMode, undefined);
  } finally {
    fake.restore();
  }
});

test('moov가 앞에 있어도 읽고, 필요한 범위만 Range로 요청한다', async () => {
  const data = buildMp4({ sample: 'avc1', width: 1920, height: 1080, frames: 60, seconds: 2, codecBox: AVCC_HIGH_40, moovFirst: true, mdatBytes: 5_000_000 });
  const fake = installFakeFetch({ 'y.mp4': data });
  try {
    const meta = await readMp4Meta('y.mp4', data.length);
    assert.equal(meta.width, 1920);
    // 5MB mdat 본문은 한 번도 요청하지 않는다
    assert.ok(fake.calls.every((c) => c.range), '모든 요청이 Range여야 한다');
    const bytes = fake.calls.map((c) => /bytes=(\d+)-(\d+)/.exec(c.range)).reduce((n, m) => n + (Number(m[2]) - Number(m[1]) + 1), 0);
    assert.ok(bytes < 4096, `읽은 바이트가 작아야 한다: ${bytes}`);
  } finally {
    fake.restore();
  }
});

test('HEVC(hvcC) 코덱 문자열', async () => {
  const data = buildMp4({ sample: 'hvc1', width: 7680, height: 3840, frames: 60, seconds: 2, codecBox: hvcC() });
  const fake = installFakeFetch({ 'h.mp4': data });
  try {
    const meta = await readMp4Meta('h.mp4', data.length);
    assert.equal(meta.family, 'h265');
    assert.match(meta.codec, /^hvc1\.1\.6\.L153/);
  } finally {
    fake.restore();
  }
});

test('st3d(좌우)와 sv3d equi(VR180 경계)를 읽는다', async () => {
  const data = buildMp4({ sample: 'avc1', width: 4096, height: 2048, frames: 30, seconds: 1, codecBox: AVCC_HIGH_40, stereoMode: 2, equi: [0, 0, 0.25, 0.25] });
  const fake = installFakeFetch({ 'v.mp4': data });
  try {
    const meta = await readMp4Meta('v.mp4', data.length);
    assert.equal(meta.stereoMode, 'left-right');
    assert.equal(meta.projection, 'equirect');
    assert.ok(Math.abs(meta.equirectBounds.left - 0.25) < 1e-6);
    assert.ok(Math.abs(meta.equirectBounds.right - 0.25) < 1e-6);
  } finally {
    fake.restore();
  }
});

test('st3d 위아래(1)와 360 equi(경계 0)', async () => {
  const data = buildMp4({ sample: 'avc1', width: 2048, height: 2048, frames: 30, seconds: 1, codecBox: AVCC_HIGH_40, stereoMode: 1, equi: [0, 0, 0, 0] });
  const fake = installFakeFetch({ 't.mp4': data });
  try {
    const meta = await readMp4Meta('t.mp4', data.length);
    assert.equal(meta.stereoMode, 'top-bottom');
    assert.equal(meta.equirectBounds.left, 0);
  } finally {
    fake.restore();
  }
});

test('MP4가 아니면 null (예외를 던지지 않는다)', async () => {
  const fake = installFakeFetch({ 'n.mp4': new TextEncoder().encode('this is not an mp4 file at all') });
  try {
    assert.equal(await readMp4Meta('n.mp4', 30), null);
    assert.equal(await readMp4Meta('missing.mp4', 100), null);
  } finally {
    fake.restore();
  }
});

test('Range를 무시하는 서버(200)에서도 앞부분만 읽고 끝낸다', async () => {
  const data = buildMp4({ sample: 'avc1', width: 640, height: 360, frames: 30, seconds: 1, codecBox: AVCC_HIGH_40, moovFirst: true });
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(data, { status: 200 });
  try {
    const meta = await readMp4Meta('z.mp4', data.length);
    assert.equal(meta.width, 640);
  } finally {
    globalThis.fetch = original;
  }
});
