import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeVideoError, isBlockableHttpSource } from '../src/viewers/media/video-error.js';

test('https 앱에서 http 주소는 차단 가능한 주소로 본다', () => {
  assert.equal(isBlockableHttpSource('http://192.168.0.5:8787/files/a.mp4', 'https:'), true);
  assert.equal(isBlockableHttpSource('https://pc.example/files/a.mp4', 'https:'), false);
  assert.equal(isBlockableHttpSource('/app/__src/pc/a.mp4', 'https:'), false);
  assert.equal(isBlockableHttpSource('blob:https://x/1', 'https:'), false);
  assert.equal(isBlockableHttpSource('http://192.168.0.5/a.mp4', 'http:'), false);
});

test('코드 4: http 주소면 연결 차단 가능성을, 아니면 코덱 미지원을 안내한다', () => {
  const blocked = describeVideoError({ code: 4, url: 'http://192.168.0.5:8787/files/a.mp4', pageProtocol: 'https:' });
  assert.match(blocked, /연결이 막힌/);
  assert.doesNotMatch(blocked, /^이 영상은 재생할 수 없습니다/);
  const codec = describeVideoError({ code: 4, url: '/app/__src/pc/a.mp4', pageProtocol: 'https:', hint: 'HEVC로 변환하세요' });
  assert.match(codec, /코덱·형식 미지원/);
  assert.match(codec, /HEVC로 변환하세요/);
});

test('연결 차단 안내에도 코덱 경고 힌트를 덧붙인다', () => {
  const text = describeVideoError({ code: 4, url: 'http://10.0.0.2/a.mp4', pageProtocol: 'https:', hint: 'H.264 6000x2000은 한계 초과' });
  assert.match(text, /한계 초과/);
});

test('코드 2·3과 알 수 없는 코드', () => {
  assert.match(describeVideoError({ code: 2 }), /네트워크/);
  assert.match(describeVideoError({ code: 3, family: 'h264' }), /디코딩/);
  assert.match(describeVideoError({}), /오류 \?/);
});
