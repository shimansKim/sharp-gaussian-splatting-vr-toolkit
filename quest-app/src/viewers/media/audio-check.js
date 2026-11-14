// 영상의 소리 상태를 판단한다: 소리 트랙이 있는지, 이 브라우저가 그 소리 형식을 재생하는지, 실제로 소리가 디코딩되는지.
// 순수 함수만 둔다(DOM 없음). media-viewer.js가 HUD 경고 줄과 진단 패널에 연결한다.

export const AUDIO_LABEL = {
  aac: 'AAC',
  mp3: 'MP3',
  opus: 'Opus',
  flac: 'FLAC',
  ac3: 'AC-3(돌비)',
  eac3: 'E-AC-3(돌비 디지털 플러스)',
  ac4: 'AC-4',
  dts: 'DTS',
  alac: 'ALAC',
  pcm: 'PCM',
  other: '알 수 없는 소리 형식',
};

/** canPlayType에 물어볼 코덱 문자열. 물어볼 수 없는 형식(PCM 등)이면 null. */
export function audioCodecString(audio) {
  if (!audio) return null;
  switch (audio.family) {
    case 'aac':
      return audio.codec || 'mp4a.40.2';
    case 'mp3':
      return 'mp3';
    case 'opus':
      return 'opus';
    case 'flac':
      return 'flac';
    case 'ac3':
      return 'ac-3';
    case 'eac3':
      return 'ec-3';
    case 'ac4':
      return 'ac-4';
    case 'dts':
      return 'dtsc';
    default:
      return null;
  }
}

/**
 * 파일 정보(mp4-meta)로 소리가 날지 미리 판단한다.
 * @param {{ audio?: object|null }|null} meta MP4 메타. 못 읽었으면 null(모름)
 * @param {(type: string) => string} canPlay video.canPlayType 대역
 * @returns {{ code: string, level: 'info'|'warn', text: string }|null} 문제 없거나 모르면 null
 */
export function checkAudioTrack(meta, canPlay) {
  if (!meta) return null;
  if (!meta.audio) {
    return { code: 'no-audio', level: 'info', text: '이 영상 파일에는 소리 트랙이 없습니다. (파일에 소리가 들어 있지 않아 소리가 나지 않는 게 정상입니다)' };
  }
  const codec = audioCodecString(meta.audio);
  if (codec && typeof canPlay === 'function' && canPlay(`audio/mp4; codecs="${codec}"`) === '') {
    const label = AUDIO_LABEL[meta.audio.family] ?? AUDIO_LABEL.other;
    return {
      code: 'audio-codec',
      level: 'warn',
      text: `소리 형식 ${label}는 Quest 브라우저가 재생하지 못해 소리가 나지 않습니다. PC에서 bat\\make_quest_app_video.bat으로 변환하면 AAC로 바뀝니다.`,
    };
  }
  return null;
}

export const AUDIO_PROBE_SECONDS = 1.5;

/**
 * 재생 중 실제로 소리가 디코딩되는지 본다(Chromium의 webkitAudioDecodedByteCount).
 * @returns {{ code: string, level: 'warn', text: string }|null|'ok'} 'ok'면 소리 확인됨, null이면 아직 판단 불가
 */
export function judgeAudioRuntime({ decodedBytes, currentTime, playing, muted }) {
  if (typeof decodedBytes !== 'number') return null; // 이 브라우저는 값을 주지 않는다
  if (decodedBytes > 0) return 'ok';
  if (!playing || muted || currentTime < AUDIO_PROBE_SECONDS) return null;
  return {
    code: 'audio-silent',
    level: 'warn',
    text: '재생 중인데 소리가 디코딩되지 않습니다. 소리 트랙이 없거나 이 브라우저가 못 읽는 소리 형식일 수 있습니다.',
  };
}

/** 진단 패널의 소리 한 줄. */
export function audioDiagText({ muted, volume, decodedBytes, meta }) {
  let track = '?';
  if (meta) track = meta.audio ? `${AUDIO_LABEL[meta.audio.family] ?? AUDIO_LABEL.other}${meta.audio.channels ? ` ${meta.audio.channels}ch` : ''}` : '없음';
  const decoded = typeof decodedBytes === 'number' ? `${Math.round(decodedBytes / 1024)}KB` : '?';
  const pct = Number.isFinite(volume) ? Math.round(volume * 100) : '?';
  return `소리 ${muted ? '꺼짐(음소거)' : '켜짐'} · 볼륨 ${pct}% · 소리 트랙 ${track} · 디코딩된 소리 ${decoded}`;
}
