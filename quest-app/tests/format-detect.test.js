import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LAYOUTS, LAYOUT_ORDER, detectLayout, eyeAspect, eyeRegion, isLayout, parseNameHints } from '../src/viewers/media/format-detect.js';

const detect = (name, width, height, spatial) => detectLayout({ name, width, height, spatial }).layout;

test('LAYOUT_ORDER는 LAYOUTS의 모든 형식을 한 번씩 담는다', () => {
  assert.deepEqual([...LAYOUT_ORDER].sort(), Object.keys(LAYOUTS).sort());
  assert.ok(isLayout('sbs180'));
  assert.ok(!isLayout('nope'));
  assert.ok(!isLayout('toString'));
});

test('이 저장소의 8192x2730 Full SBS 출력은 가상 스크린으로 판별한다', () => {
  assert.equal(detect('DJAWA_Maruemon_02_quest3_8k_3D_FSBS.mp4', 8192, 2730), 'sbsScreenFull');
  // 이름 힌트 없이도 비율(3:1)로 Full SBS 스크린
  assert.equal(detect('movie.mp4', 8192, 2730), 'sbsScreenFull');
});

test('이름 힌트: 360 / VR180 / TB / SBS', () => {
  assert.equal(detect('beach_360.mp4', 4096, 2048), 'mono360');
  assert.equal(detect('beach_360_TB.mp4', 4096, 4096), 'tb360');
  assert.equal(detect('beach_360_OU.mp4', 4096, 4096), 'tb360');
  assert.equal(detect('beach_360_SBS.mp4', 8192, 2048), 'sbs360');
  assert.equal(detect('a_VR180_SBS.mp4', 4096, 2048), 'sbs180');
  assert.equal(detect('a_VR180.mp4', 4096, 2048), 'sbs180');
  assert.equal(detect('a_180_LR.mp4', 4096, 2048), 'sbs180');
  assert.equal(detect('a_180_mono.mp4', 2048, 2048), 'mono180');
  assert.equal(detect('show_HSBS.mp4', 1920, 1080), 'sbsScreenHalf');
  assert.equal(detect('show_FSBS.mp4', 3840, 1080), 'sbsScreenFull');
  assert.equal(detect('show_SBS.mp4', 1920, 1080), 'sbsScreenHalf');
  assert.equal(detect('show_TB.mp4', 1920, 2160), 'tbScreen');
});

test('이름 단서가 없으면 비율로 추정하고 확신도를 낮게 둔다', () => {
  const r = detectLayout({ name: 'clip.mp4', width: 4096, height: 2048 });
  assert.equal(r.layout, 'mono360');
  assert.equal(r.confidence, 'low');
  assert.equal(detect('clip.mp4', 2048, 2048), 'tb360');
  assert.equal(detect('clip.mp4', 8192, 2048), 'sbs360');
  assert.equal(detect('clip.mp4', 1920, 1080), 'mono2d');
  assert.equal(detect('clip.mp4', 1080, 1920), 'mono2d');
  assert.equal(detect('clip.mp4', 0, 0), 'mono2d');
  assert.equal(detect('photo.jpg', 4032, 3024), 'mono2d');
});

test('SBS 이름 + 2:1 비율은 VR180으로 본다', () => {
  assert.equal(detect('trip_3D_SBS.mp4', 4096, 2048), 'sbs180');
});

test('MP4 공간 메타데이터가 이름보다 우선한다', () => {
  const vr180 = { stereoMode: 'left-right', projection: 'equirect', equirectBounds: { top: 0, bottom: 0, left: 0.25, right: 0.25 } };
  assert.equal(detect('whatever.mp4', 4096, 2048, vr180), 'sbs180');
  const tb360 = { stereoMode: 'top-bottom', projection: 'equirect', equirectBounds: { top: 0, bottom: 0, left: 0, right: 0 } };
  assert.equal(detect('whatever_SBS.mp4', 4096, 4096, tb360), 'tb360');
  const mono360 = { stereoMode: 'mono', projection: 'equirect', equirectBounds: { top: 0, bottom: 0, left: 0, right: 0 } };
  assert.equal(detect('whatever.mp4', 4096, 2048, mono360), 'mono360');
  assert.equal(detectLayout({ name: 'x.mp4', width: 4096, height: 2048, spatial: vr180 }).confidence, 'high');
});

test('메타데이터가 있어도 알 수 없는 값이면 이름·비율로 돌아간다', () => {
  assert.equal(detect('a_VR180_SBS.mp4', 4096, 2048, { projection: null, stereoMode: null }), 'sbs180');
});

test('parseNameHints는 확장자와 경로 구분자를 무시한다', () => {
  assert.deepEqual(parseNameHints('x_VR180_SBS.mp4').projection, '180');
  assert.equal(parseNameHints('180p_video.mp4').projection, null); // 해상도 표기 180p는 VR180이 아니다
  assert.equal(parseNameHints('C:\\clips\\sbs\\plain.mp4').stereo, null); // 경로가 아니라 파일 이름의 토큰만 본다
  assert.equal(parseNameHints('video.mp4').stereo, null);
});

test('눈 영역(UV)', () => {
  assert.deepEqual(eyeRegion('sbs180', 'left'), { u0: 0, u1: 0.5, v0: 0, v1: 1 });
  assert.deepEqual(eyeRegion('sbs180', 'right'), { u0: 0.5, u1: 1, v0: 0, v1: 1 });
  // TB: 왼눈이 위쪽(v가 큰 쪽)
  assert.deepEqual(eyeRegion('tb360', 'left'), { u0: 0, u1: 1, v0: 0.5, v1: 1 });
  assert.deepEqual(eyeRegion('tb360', 'right'), { u0: 0, u1: 1, v0: 0, v1: 0.5 });
  assert.deepEqual(eyeRegion('mono360', 'left'), { u0: 0, u1: 1, v0: 0, v1: 1 });
});

test('스크린 한쪽 눈 비율: Full SBS는 (w/2):h, Half SBS와 2D는 w:h', () => {
  assert.equal(eyeAspect('sbsScreenFull', 3840, 1080), 16 / 9);
  assert.equal(eyeAspect('sbsScreenFull', 8192, 2730), 8192 / 2 / 2730);
  assert.equal(eyeAspect('sbsScreenHalf', 1920, 1080), 16 / 9);
  assert.equal(eyeAspect('mono2d', 1280, 720), 16 / 9);
  assert.equal(eyeAspect('tbScreen', 1920, 2160), 1920 / 1080); // Full TB
  assert.equal(eyeAspect('tbScreen', 1920, 1080), 16 / 9); // Half TB
});
