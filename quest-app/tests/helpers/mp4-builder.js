// 테스트용 최소 MP4 조립기. 박스 구조만 맞추면 되므로 샘플 데이터는 없다.

const enc = new TextEncoder();

function concat(parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function u32(n) {
  return new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
}

export function u16(n) {
  return new Uint8Array([(n >>> 8) & 255, n & 255]);
}

export function box(type, ...payload) {
  const body = concat(payload);
  return concat([u32(8 + body.length), enc.encode(type), body]);
}

/** FullBox: version(1)+flags(3)=0 을 앞에 붙인다. */
export function fullBox(type, ...payload) {
  return box(type, new Uint8Array(4), ...payload);
}

const zeros = (n) => new Uint8Array(n);

/**
 * @param {{ sample: 'avc1'|'hvc1'|'av01', width: number, height: number, frames: number, seconds: number,
 *   codecBox: Uint8Array, stereoMode?: 0|1|2, equi?: [number, number, number, number], moovFirst?: boolean, mdatBytes?: number,
 *   audio?: { sample: string, channels?: number, esds?: Uint8Array } }} o  audio가 없으면 소리 트랙 없는 파일
 */
export function buildMp4(o) {
  const extra = [];
  if (o.stereoMode !== undefined) extra.push(fullBox('st3d', new Uint8Array([o.stereoMode])));
  if (o.equi) {
    const bounds = concat(o.equi.map((f) => u32(Math.round(f * 4294967296) >>> 0)));
    extra.push(box('sv3d', fullBox('svhd', zeros(1)), box('proj', fullBox('prhd', zeros(12)), fullBox('equi', bounds))));
  }
  const entry = box(
    o.sample,
    zeros(6), // reserved
    u16(1), // data reference index
    zeros(16), // predefined/reserved
    u16(o.width),
    u16(o.height),
    zeros(78 - 28), // 해상도 이후 고정 필드
    o.codecBox,
    ...extra,
  );
  const stsd = fullBox('stsd', u32(1), entry);
  const stsz = fullBox('stsz', u32(0), u32(o.frames));
  const stbl = box('stbl', stsd, stsz);
  const minf = box('minf', stbl);
  const timescale = 1000;
  const mdhd = fullBox('mdhd', u32(0), u32(0), u32(timescale), u32(Math.round(o.seconds * timescale)), zeros(4));
  const hdlr = fullBox('hdlr', u32(0), enc.encode('vide'), zeros(12), zeros(1));
  const mdia = box('mdia', mdhd, hdlr, minf);
  const trak = box('trak', mdia);
  const moov = box('moov', trak, ...(o.audio ? [audioTrak(o.audio)] : []));
  const ftyp = box('ftyp', enc.encode('isom'), u32(512), enc.encode('isomiso2mp41'));
  const mdat = box('mdat', zeros(o.mdatBytes ?? 64));
  return o.moovFirst ? concat([ftyp, moov, mdat]) : concat([ftyp, mdat, moov]);
}

/** 소리 트랙: hdlr 'soun' + AudioSampleEntry(28바이트 고정부) + 선택 자식 박스(esds 등) */
function audioTrak(a) {
  const entry = box(a.sample, zeros(6), u16(1), zeros(8), u16(a.channels ?? 2), u16(16), zeros(2), zeros(2), u32(48000 * 65536), ...(a.esds ? [a.esds] : []));
  const stbl = box('stbl', fullBox('stsd', u32(1), entry));
  const hdlr = fullBox('hdlr', u32(0), enc.encode('soun'), zeros(12), zeros(1));
  return box('trak', box('mdia', fullBox('mdhd', u32(0), u32(0), u32(48000), u32(48000), zeros(4)), hdlr, box('minf', stbl)));
}

/** esds: objectTypeIndication(oti)와 AAC audioObjectType(aot). 길이는 모두 1바이트 형식. */
export function esds(oti = 0x40, aot = 2) {
  const dsi = new Uint8Array([0x05, 2, (aot << 3) | 4, 0x10]);
  const dcd = new Uint8Array([0x04, 13 + dsi.length, oti, 0x15, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...dsi]);
  const es = new Uint8Array([0x03, 3 + dcd.length, 0, 1, 0, ...dcd]);
  return fullBox('esds', es);
}

/** avcC: profile 100(High), compat 0, level 40(4.0) */
export const AVCC_HIGH_40 = box('avcC', new Uint8Array([1, 100, 0, 40, 0xff, 0xe0, 0]));

/** hvcC: Main profile(1), 호환 플래그 0x60000000, level 153(5.1) */
export function hvcC() {
  const b = new Uint8Array(23);
  b[0] = 1;
  b[1] = 1; // space 0, tier 0, profile 1
  b.set([0x60, 0, 0, 0], 2);
  b.set([0x90, 0, 0, 0, 0, 0], 6);
  b[12] = 153;
  return box('hvcC', b);
}

/** fetch 대역: Range 요청을 지원하는 메모리 서버 */
export function installFakeFetch(files) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const data = files[url];
    calls.push({ url, range: init.headers?.Range });
    if (!data) return new Response('nope', { status: 404 });
    const range = /bytes=(\d+)-(\d+)/.exec(init.headers?.Range ?? '');
    if (range) {
      const start = Number(range[1]);
      const end = Math.min(Number(range[2]), data.length - 1);
      return new Response(data.slice(start, end + 1), { status: 206 });
    }
    return new Response(data, { status: 200 });
  };
  return { calls, restore: () => (globalThis.fetch = original) };
}
