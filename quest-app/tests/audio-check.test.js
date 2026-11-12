import assert from 'node:assert/strict';
import { test } from 'node:test';
import { audioCodecString, audioDiagText, checkAudioTrack, judgeAudioRuntime } from '../src/viewers/media/audio-check.js';
import { readMp4Meta } from '../src/viewers/media/mp4-meta.js';
import { AVCC_HIGH_40, buildMp4, esds, installFakeFetch } from './helpers/mp4-builder.js';

async function metaOf(audio) {
  const data = buildMp4({ sample: 'avc1', width: 1920, height: 1080, frames: 60, seconds: 2, codecBox: AVCC_HIGH_40, audio });
  const fake = installFakeFetch({ 'x.mp4': data });
  try {
    return await readMp4Meta('x.mp4', data.length);
  } finally {
    fake.restore();
  }
}

// 이 Chrome/Quest 브라우저처럼 AAC·MP3·Opus·FLAC만 재생한다고 가정한 canPlayType
const canPlay = (type) => (/codecs="(mp4a\.40\.\d+|mp3|opus|flac)"/.test(type) ? 'probably' : '');

test('mp4-meta: 소리 트랙이 없으면 audio는 null', async () => {
  assert.equal((await metaOf(undefined)).audio, null);
});

test('mp4-meta: AAC-LC(esds)와 채널 수', async () => {
  const meta = await metaOf({ sample: 'mp4a', channels: 2, esds: esds(0x40, 2) });
  assert.deepEqual({ family: meta.audio.family, codec: meta.audio.codec, channels: meta.audio.channels }, { family: 'aac', codec: 'mp4a.40.2', channels: 2 });
  assert.equal(meta.family, 'h264', '영상 정보는 그대로');
});

test('mp4-meta: HE-AAC는 mp4a.40.5, mp4a 안의 MP3(0x6B)는 mp3', async () => {
  assert.equal((await metaOf({ sample: 'mp4a', esds: esds(0x40, 5) })).audio.codec, 'mp4a.40.5');
  assert.equal((await metaOf({ sample: 'mp4a', esds: esds(0x6b, 0) })).audio.family, 'mp3');
});

test('mp4-meta: AC-3·E-AC-3·Opus·DTS는 샘플 이름으로 구분', async () => {
  assert.equal((await metaOf({ sample: 'ac-3' })).audio.family, 'ac3');
  assert.equal((await metaOf({ sample: 'ec-3' })).audio.family, 'eac3');
  assert.equal((await metaOf({ sample: 'Opus' })).audio.family, 'opus');
  assert.equal((await metaOf({ sample: 'dtsc' })).audio.family, 'dts');
});

test('checkAudioTrack: 소리 트랙 없음은 안내(info), AAC는 문제 없음, 브라우저가 못 읽는 형식은 경고', async () => {
  assert.equal(checkAudioTrack(null, canPlay), null, '메타를 못 읽으면 모른다');
  const none = checkAudioTrack(await metaOf(undefined), canPlay);
  assert.equal(none.code, 'no-audio');
  assert.equal(none.level, 'info');
  assert.match(none.text, /소리 트랙이 없습니다/);
  assert.equal(checkAudioTrack(await metaOf({ sample: 'mp4a', esds: esds() }), canPlay), null);
  assert.equal(checkAudioTrack(await metaOf({ sample: 'Opus' }), canPlay), null);
  const ac3 = checkAudioTrack(await metaOf({ sample: 'ac-3' }), canPlay);
  assert.equal(ac3.code, 'audio-codec');
  assert.equal(ac3.level, 'warn');
  assert.match(ac3.text, /AC-3/);
  assert.match(ac3.text, /make_quest_app_video\.bat/);
});

test('audioCodecString: PCM처럼 물어볼 수 없는 형식은 null', () => {
  assert.equal(audioCodecString({ family: 'pcm' }), null);
  assert.equal(audioCodecString({ family: 'eac3' }), 'ec-3');
  assert.equal(audioCodecString(null), null);
});

test('judgeAudioRuntime: 디코딩된 소리가 있으면 ok, 1.5초 재생에도 0이면 경고, 음소거·일시정지·값 없음은 판단 보류', () => {
  const base = { decodedBytes: 0, currentTime: 2, playing: true, muted: false };
  assert.equal(judgeAudioRuntime({ ...base, decodedBytes: 4096 }), 'ok');
  assert.equal(judgeAudioRuntime(base).code, 'audio-silent');
  assert.equal(judgeAudioRuntime({ ...base, currentTime: 0.5 }), null);
  assert.equal(judgeAudioRuntime({ ...base, playing: false }), null);
  assert.equal(judgeAudioRuntime({ ...base, muted: true }), null);
  assert.equal(judgeAudioRuntime({ ...base, decodedBytes: undefined }), null);
});

test('audioDiagText: 켜짐/꺼짐·볼륨·트랙·디코딩 KB를 한 줄로', async () => {
  const meta = await metaOf({ sample: 'mp4a', channels: 2, esds: esds() });
  assert.equal(audioDiagText({ muted: false, volume: 1, decodedBytes: 312 * 1024, meta }), '소리 켜짐 · 볼륨 100% · 소리 트랙 AAC 2ch · 디코딩된 소리 312KB');
  assert.equal(audioDiagText({ muted: true, volume: 0.5, decodedBytes: undefined, meta: await metaOf(undefined) }), '소리 꺼짐(음소거) · 볼륨 50% · 소리 트랙 없음 · 디코딩된 소리 ?');
  assert.match(audioDiagText({ muted: false, volume: 1, decodedBytes: 0, meta: null }), /소리 트랙 \? · 디코딩된 소리 0KB/);
});
