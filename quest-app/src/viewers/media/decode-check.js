// 영상 디코딩 가능 여부를 MediaCapabilities와 Quest Browser 한계 규칙으로 미리 검사한다.
// 설계 6.3: H.264는 4K까지, 8K는 H.265/AV1만, 하드웨어 한계는 8192x4096@60 또는 5760x5760@60.

const H264_MAX_PIXELS = 4096 * 2304; // 4K UHD(3840x2160)와 DCI 4K(4096x2160)까지
const H264_MAX_DIM = 4096;
const HW_MAX_PIXELS = 8192 * 4096;
const HW_MAX_DIM = 8192;

/**
 * 코덱 정보를 모를 때(MP4 이외 컨테이너 등) 시험해 볼 후보.
 * 가장 흔한 것부터 둔다.
 */
const FALLBACK_CODECS = [
  { family: 'h264', codec: 'avc1.640033' },
  { family: 'h265', codec: 'hvc1.1.6.L153.B0' },
  { family: 'vp9', codec: 'vp09.00.51.08' },
  { family: 'av1', codec: 'av01.0.13M.08' },
];
// webm 컨테이너는 VP9·AV1만 시험한다(VP8은 Quest에서 어차피 하드웨어 디코드가 안 된다).

function containerFor(name, mime) {
  const lower = String(name || '').toLowerCase();
  if (/\.webm$/.test(lower) || /webm/.test(mime || '')) return 'video/webm';
  if (/\.(mkv)$/.test(lower)) return 'video/x-matroska';
  if (/\.(mov)$/.test(lower)) return 'video/quicktime';
  return 'video/mp4';
}

const FAMILY_LABEL = { h264: 'H.264', h265: 'HEVC(H.265)', av1: 'AV1', vp9: 'VP9', vp8: 'VP8' };

/** Quest 한계 규칙만 따진 경고. 실제 기기가 아니어도 같은 결과가 나온다. */
export function questLimitWarnings({ family, width, height, frameRate, known = true }) {
  const warnings = [];
  const pixels = (width || 0) * (height || 0);
  const maxDim = Math.max(width || 0, height || 0);
  const label = FAMILY_LABEL[family] ?? '이 코덱';

  // 코덱을 파일에서 읽지 못해 짐작한 값(known=false)이면 H.264 한도를 단정하지 않는다(HEVC mkv를 H.264로 오인하는 거짓 경고 방지).
  if (known && family === 'h264' && (pixels > H264_MAX_PIXELS || maxDim > H264_MAX_DIM)) {
    warnings.push({
      level: 'error',
      code: 'h264-over-4k',
      text: `${width}x${height} H.264는 Quest 한계(4K)를 넘어 재생이 안 되거나 끊깁니다. PC에서 HEVC로 변환하세요(make_quest_app_video.bat).`,
    });
  } else if (family === 'vp8' || (family === 'vp9' && pixels > H264_MAX_PIXELS)) {
    warnings.push({
      level: 'warn',
      code: 'sw-decode',
      text: `${label} 고해상도는 Quest에서 하드웨어 디코딩이 안 되어 끊길 수 있습니다. HEVC 또는 AV1을 권장합니다.`,
    });
  }
  if (pixels > HW_MAX_PIXELS || maxDim > HW_MAX_DIM) {
    warnings.push({
      level: 'error',
      code: 'over-hw-limit',
      text: `${width}x${height}는 Quest 하드웨어 디코더 한계(8192x4096)를 넘습니다. 해상도를 줄여 다시 인코딩하세요.`,
    });
  } else if (frameRate > 61 && pixels > 3840 * 2160) {
    warnings.push({
      level: 'warn',
      code: 'high-fps',
      text: `${Math.round(frameRate)}fps 고해상도는 디코더 한계(60fps)를 넘어 끊길 수 있습니다.`,
    });
  }
  return warnings;
}

/**
 * @param {{ name?: string, mime?: string, family?: string|null, codec?: string|null, width: number, height: number, frameRate?: number, bitrate?: number }} info
 * @returns {Promise<{ supported: boolean|null, smooth: boolean|null, powerEfficient: boolean|null, codec: string|null, family: string|null, warnings: Array<{level:'error'|'warn'|'info', code:string, text:string}>, ok: boolean }>}
 *   ok는 경고 없이 재생이 기대되는지 여부.
 */
export async function checkVideoDecode(info) {
  const width = info.width || 0;
  const height = info.height || 0;
  const frameRate = info.frameRate && info.frameRate > 0 ? Math.min(Math.round(info.frameRate * 100) / 100, 240) : 30;
  const bitrate = info.bitrate && info.bitrate > 0 ? info.bitrate : Math.max(2_000_000, Math.round(width * height * frameRate * 0.08));
  const container = containerFor(info.name, info.mime);

  const webm = container === 'video/webm';
  const candidates = info.codec
    ? [{ family: info.family, codec: info.codec }]
    : FALLBACK_CODECS.filter((c) => (!info.family || c.family === info.family) && (!webm || c.family === 'vp9' || c.family === 'av1'));

  const warnings = [];
  let best = null;
  const mc = typeof navigator !== 'undefined' ? navigator.mediaCapabilities : null;
  if (mc?.decodingInfo && width && height) {
    for (const candidate of candidates) {
      try {
        const res = await mc.decodingInfo({
          type: 'file',
          video: { contentType: `${container}; codecs="${candidate.codec}"`, width, height, bitrate, framerate: frameRate },
        });
        const entry = { ...candidate, supported: !!res.supported, smooth: !!res.smooth, powerEfficient: !!res.powerEfficient };
        if (!best || (entry.supported && !best.supported)) best = entry;
        if (entry.supported) break;
      } catch {
        // 이 코덱 문자열은 해당 환경에서 검사할 수 없다. 다음 후보로 넘어간다.
      }
    }
  }

  const family = info.family ?? best?.family ?? null;
  const known = !!info.codec;
  if (!best) {
    warnings.push({
      level: 'info',
      code: 'no-capabilities',
      text: 'MediaCapabilities를 쓸 수 없어 디코딩 가능 여부를 미리 확인하지 못했습니다.',
    });
  } else if (!best.supported) {
    warnings.push({
      level: 'error',
      code: 'unsupported',
      text: known
        ? `이 기기 브라우저가 ${FAMILY_LABEL[family] ?? '이 코덱'} ${width}x${height}${frameRate ? ` ${Math.round(frameRate)}fps` : ''} 영상을 디코딩할 수 없다고 보고합니다.`
        : `코덱을 알 수 없고, 흔한 코덱(H.264/HEVC/AV1/VP9) 어느 것으로도 ${width}x${height}를 디코딩할 수 없다고 보고합니다.`,
    });
  } else if (!best.smooth) {
    warnings.push({
      level: 'warn',
      code: 'not-smooth',
      text: `${FAMILY_LABEL[family] ?? '이'} ${width}x${height} 영상은 재생이 끊길 수 있습니다.`,
    });
  } else if (!best.powerEfficient) {
    warnings.push({
      level: 'info',
      code: 'sw-decode',
      text: '소프트웨어 디코딩일 수 있어 발열·배터리 소모가 클 수 있습니다.',
    });
  }

  if (family) warnings.push(...questLimitWarnings({ family, width, height, frameRate, known }));

  const ok = !warnings.some((w) => w.level === 'error' || w.level === 'warn');
  return {
    supported: best ? best.supported : null,
    smooth: best ? best.smooth : null,
    powerEfficient: best ? best.powerEfficient : null,
    codec: info.codec ?? best?.codec ?? null,
    family,
    warnings,
    ok,
  };
}

/** 사용자에게 보여 줄 한 줄 요약. 가장 심각한 경고를 우선한다. */
export function summarizeWarnings(result) {
  if (!result || !result.warnings.length) return '';
  const order = { error: 0, warn: 1, info: 2 };
  return [...result.warnings].sort((a, b) => order[a.level] - order[b.level])[0].text;
}
