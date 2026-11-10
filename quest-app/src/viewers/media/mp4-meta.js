// MP4/MOV에서 코덱 문자열, 해상도, 프레임레이트, 공간 메타데이터(st3d/sv3d)를 읽는다.
// url은 blob: 또는 서비스 워커 프록시 URL이고, Range 요청으로 필요한 박스만 읽는다.

const MAX_MOOV_BYTES = 24 * 1024 * 1024;
const MAX_HOPS = 64;

/**
 * url의 [start, end] 바이트를 읽는다. Range를 무시하는 서버(200 응답)면 앞부분만 읽고 끊는다.
 * @returns {Promise<Uint8Array>}
 */
export async function readRange(url, start, end, signal) {
  const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` }, signal });
  if (res.status === 206) return new Uint8Array(await res.arrayBuffer());
  if (!res.ok) throw new Error(`Range 요청 실패(${res.status})`);
  // 200: 전체 본문이 오므로 start..end만 모으고 끊는다.
  const reader = res.body.getReader();
  const out = new Uint8Array(end - start + 1);
  let pos = 0;
  let filled = 0;
  while (filled < out.length) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunkEnd = pos + value.length;
    if (chunkEnd > start) {
      const from = Math.max(0, start - pos);
      const to = Math.min(value.length, end + 1 - pos);
      out.set(value.subarray(from, to), filled);
      filled += to - from;
    }
    pos = chunkEnd;
  }
  reader.cancel().catch(() => {});
  return out.subarray(0, filled);
}

function u32(view, o) {
  return view.getUint32(o);
}
function fourcc(view, o) {
  return String.fromCharCode(view.getUint8(o), view.getUint8(o + 1), view.getUint8(o + 2), view.getUint8(o + 3));
}

/** buf 안의 [from, to) 범위에서 박스 헤더를 차례로 돌려준다. */
function* boxes(view, from, to) {
  let o = from;
  while (o + 8 <= to) {
    let size = u32(view, o);
    const type = fourcc(view, o + 4);
    let header = 8;
    if (size === 1) {
      if (o + 16 > to) return;
      size = Number(view.getBigUint64(o + 8));
      header = 16;
    } else if (size === 0) {
      size = to - o;
    }
    if (size < header) return;
    const end = Math.min(o + size, to);
    yield { type, start: o, bodyStart: o + header, end, size };
    o += size;
  }
}

function findBox(view, from, to, type) {
  for (const b of boxes(view, from, to)) if (b.type === type) return b;
  return null;
}

/** 'moov'를 찾아 바이트를 읽어 온다. */
async function loadMoov(url, size, signal) {
  let offset = 0;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    if (size && offset >= size) return null;
    const head = await readRange(url, offset, offset + 15, signal);
    if (head.length < 8) return null;
    const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
    let boxSize = view.getUint32(0);
    const type = fourcc(view, 4);
    if (boxSize === 1 && head.length >= 16) boxSize = Number(view.getBigUint64(8));
    else if (boxSize === 0) boxSize = size ? size - offset : 0;
    if (type === 'moov') {
      if (!boxSize || boxSize > MAX_MOOV_BYTES) return null;
      const bytes = await readRange(url, offset, offset + boxSize - 1, signal);
      return bytes;
    }
    if (!boxSize) return null;
    offset += boxSize;
  }
  return null;
}

function parseAvcC(view, o) {
  // configurationVersion, profile, compat, level
  const profile = view.getUint8(o + 1);
  const compat = view.getUint8(o + 2);
  const level = view.getUint8(o + 3);
  const hex = (n) => n.toString(16).padStart(2, '0');
  return { codec: `avc1.${hex(profile)}${hex(compat)}${hex(level)}`, family: 'h264', profile, level };
}

function parseHvcC(view, o, sampleType) {
  const b1 = view.getUint8(o + 1);
  const profileSpace = b1 >> 6;
  const tier = (b1 >> 5) & 1;
  const profileIdc = b1 & 0x1f;
  const compat = u32(view, o + 2);
  // 호환 플래그는 비트 순서를 뒤집어 16진수로 적는다.
  let rev = 0;
  for (let i = 0; i < 32; i++) if (compat & (1 << i)) rev |= 1 << (31 - i);
  const level = view.getUint8(o + 12);
  const constraint = [];
  for (let i = 0; i < 6; i++) constraint.push(view.getUint8(o + 6 + i));
  while (constraint.length > 1 && constraint[constraint.length - 1] === 0) constraint.pop();
  const space = ['', 'A', 'B', 'C'][profileSpace];
  const codec = `${sampleType}.${space}${profileIdc}.${(rev >>> 0).toString(16)}.${tier ? 'H' : 'L'}${level}${constraint
    .map((c) => `.${c.toString(16).toUpperCase()}`)
    .join('')}`;
  return { codec, family: 'h265', profile: profileIdc, level };
}

function parseAv1C(view, o) {
  const b1 = view.getUint8(o + 1);
  const b2 = view.getUint8(o + 2);
  const profile = b1 >> 5;
  const level = b1 & 0x1f;
  const tier = b2 >> 7;
  const highBitdepth = (b2 >> 6) & 1;
  const twelve = (b2 >> 5) & 1;
  const bitDepth = highBitdepth ? (twelve ? 12 : 10) : 8;
  const codec = `av01.${profile}.${String(level).padStart(2, '0')}${tier ? 'H' : 'M'}.${String(bitDepth).padStart(2, '0')}`;
  return { codec, family: 'av1', profile, level };
}

function parseVpcC(view, o, sampleType) {
  // version(1) flags(3) profile(1) level(1) bitDepth<<4 ...
  const profile = view.getUint8(o + 4);
  const level = view.getUint8(o + 5);
  const bitDepth = view.getUint8(o + 6) >> 4;
  const codec = `vp09.${String(profile).padStart(2, '0')}.${String(level).padStart(2, '0')}.${String(bitDepth).padStart(2, '0')}`;
  return { codec, family: 'vp9', profile, level };
}

function parseSv3d(view, from, to) {
  const out = { projection: null, equirectBounds: null };
  const proj = findBox(view, from, to, 'proj');
  if (!proj) return out;
  for (const child of boxes(view, proj.bodyStart, proj.end)) {
    if (child.type === 'equi') {
      out.projection = 'equirect';
      // version/flags(4) + top, bottom, left, right (uint32 16.16 고정소수)
      if (child.bodyStart + 20 <= child.end) {
        const f = (n) => n / 4294967296; // 0.32 고정소수로 해석
        out.equirectBounds = {
          top: f(u32(view, child.bodyStart + 4)),
          bottom: f(u32(view, child.bodyStart + 8)),
          left: f(u32(view, child.bodyStart + 12)),
          right: f(u32(view, child.bodyStart + 16)),
        };
      }
    } else if (child.type === 'cbmp') out.projection = 'cubemap';
    else if (child.type === 'mshp') out.projection = 'mesh';
  }
  return out;
}

function parseVideoTrak(view, trak) {
  const mdia = findBox(view, trak.bodyStart, trak.end, 'mdia');
  if (!mdia) return null;
  const hdlr = findBox(view, mdia.bodyStart, mdia.end, 'hdlr');
  if (!hdlr || fourcc(view, hdlr.bodyStart + 8) !== 'vide') return null;

  const mdhd = findBox(view, mdia.bodyStart, mdia.end, 'mdhd');
  let timescale = 0;
  let duration = 0;
  if (mdhd) {
    const v = view.getUint8(mdhd.bodyStart);
    if (v === 1) {
      timescale = u32(view, mdhd.bodyStart + 20);
      duration = Number(view.getBigUint64(mdhd.bodyStart + 24));
    } else {
      timescale = u32(view, mdhd.bodyStart + 12);
      duration = u32(view, mdhd.bodyStart + 16);
    }
  }
  const minf = findBox(view, mdia.bodyStart, mdia.end, 'minf');
  const stbl = minf && findBox(view, minf.bodyStart, minf.end, 'stbl');
  if (!stbl) return null;

  const result = { codec: null, family: null, width: 0, height: 0, frameRate: 0, durationSec: 0, sampleCount: 0 };
  if (timescale && duration) result.durationSec = duration / timescale;

  const stsz = findBox(view, stbl.bodyStart, stbl.end, 'stsz');
  if (stsz) result.sampleCount = u32(view, stsz.bodyStart + 8);
  if (result.sampleCount && result.durationSec) result.frameRate = result.sampleCount / result.durationSec;

  const stsd = findBox(view, stbl.bodyStart, stbl.end, 'stsd');
  if (stsd) {
    // version/flags(4) + entry_count(4) 다음에 샘플 엔트리
    for (const entry of boxes(view, stsd.bodyStart + 8, stsd.end)) {
      const sampleType = entry.type;
      // VisualSampleEntry: 6 reserved + 2 dataRefIndex + 16 predefined/reserved + width(2) height(2) ... = 78바이트 뒤에 자식 박스
      if (entry.bodyStart + 78 > entry.end) continue;
      result.width = view.getUint16(entry.bodyStart + 24);
      result.height = view.getUint16(entry.bodyStart + 26);
      const childStart = entry.bodyStart + 78;
      for (const child of boxes(view, childStart, entry.end)) {
        let parsed = null;
        if (child.type === 'avcC') parsed = parseAvcC(view, child.bodyStart);
        else if (child.type === 'hvcC') parsed = parseHvcC(view, child.bodyStart, sampleType === 'hev1' ? 'hev1' : 'hvc1');
        else if (child.type === 'av1C') parsed = parseAv1C(view, child.bodyStart);
        else if (child.type === 'vpcC') parsed = parseVpcC(view, child.bodyStart, sampleType);
        if (parsed) Object.assign(result, parsed);
        else if (child.type === 'st3d') {
          const mode = view.getUint8(child.bodyStart + 4);
          result.stereoMode = mode === 1 ? 'top-bottom' : mode === 2 ? 'left-right' : 'mono';
        } else if (child.type === 'sv3d') {
          Object.assign(result, parseSv3d(view, child.bodyStart, child.end));
        }
      }
      if (!result.codec) result.family = { avc1: 'h264', avc3: 'h264', hvc1: 'h265', hev1: 'h265', av01: 'av1', vp09: 'vp9' }[sampleType] ?? null;
      break;
    }
  }
  return result;
}

/** UUID 박스(구형 Google spherical v1 XML)에서 360/입체 정보를 찾는다. */
function parseSphericalV1(view, bytes, from, to) {
  const text = new TextDecoder('utf-8').decode(bytes.subarray(from, Math.min(to, from + 8192)));
  if (!/<rdf:SphericalVideo/i.test(text)) return null;
  const spherical = /<GSpherical:Spherical>\s*true/i.test(text);
  const stereo = /<GSpherical:StereoMode>\s*(left-right|top-bottom)/i.exec(text);
  const out = {};
  if (spherical) out.projection = 'equirect';
  if (stereo) out.stereoMode = stereo[1].toLowerCase();
  return out;
}

/**
 * @param {string} url
 * @param {number} [size] 알면 파일 끝을 넘어서 읽지 않는다
 * @returns {Promise<{ codec: string|null, family: string|null, width: number, height: number, frameRate: number, durationSec: number, bitrate: number, stereoMode?: string, projection?: string|null, equirectBounds?: object|null }|null>}
 *   MP4가 아니거나 못 읽으면 null.
 */
export async function readMp4Meta(url, size, signal) {
  try {
    const bytes = await loadMoov(url, size, signal);
    if (!bytes) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const moov = findBox(view, 0, bytes.length, 'moov');
    if (!moov) return null;
    let best = null;
    let spherical = null;
    for (const child of boxes(view, moov.bodyStart, moov.end)) {
      if (child.type === 'trak') {
        const info = parseVideoTrak(view, child);
        if (info && !best) best = info;
      } else if (child.type === 'uuid') {
        spherical = spherical ?? parseSphericalV1(view, bytes, child.bodyStart + 16, child.end);
      }
      // trak 안의 uuid도 확인
      if (child.type === 'trak') {
        for (const inner of boxes(view, child.bodyStart, child.end)) {
          if (inner.type === 'uuid') spherical = spherical ?? parseSphericalV1(view, bytes, inner.bodyStart + 16, inner.end);
        }
      }
    }
    if (!best) return null;
    if (spherical) {
      if (!best.projection && spherical.projection) best.projection = spherical.projection;
      if (!best.stereoMode && spherical.stereoMode) best.stereoMode = spherical.stereoMode;
    }
    best.bitrate = size && best.durationSec ? Math.round((size * 8) / best.durationSec) : 0;
    return best;
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    return null;
  }
}
