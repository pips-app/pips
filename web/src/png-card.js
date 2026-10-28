// @ts-check
// A card inside a PNG picture of it: the same envelope a code carries, in a
// chunk of its own, so a picture shared as a file opens in Pips as the card
// itself — its author, its signatures — not as a drawing. Other programs
// skip the chunk: it is ancillary ('p'), private ('i') and safe to copy
// ('s'). A messenger that re-encodes the picture drops it; the code drawn
// on the picture is there for that.
//
// Reading is for files from anywhere: every length is checked before it
// is used, every chunk's CRC must hold, and the size has limits. The
// envelope found is only bytes: the core checks every signature in it.
// No DOM: runs under node for tests.

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const TYPE = 'piPs';
/** The first byte of the chunk's data: its layout, should it ever change. */
const LAYOUT = 1;
/** No envelope is larger (pips-wasm MAX_LINK is far below this). */
const MAX_DATA = 256 * 1024;
const MAX_CHUNKS = 10_000;

/** @type {Uint32Array|null} */
let table = null;
/** CRC-32 as PNG defines it. @param {Uint8Array} bytes */
export function crc32(bytes) {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const ascii = (/** @type {string} */ s) => Uint8Array.from(s, (c) => c.charCodeAt(0));
/** @param {Uint8Array} b @param {number} at */
const u32 = (b, at) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;

/** Whether the bytes begin as a PNG. @param {Uint8Array} b */
export const isPng = (b) => b.length >= 8 && SIGNATURE.every((v, i) => b[i] === v);

/**
 * The PNG with the envelope in it, just before its end. A chunk of ours
 * already there is replaced. @param {Uint8Array} png @param {Uint8Array} envelope
 */
export function withEnvelope(png, envelope) {
  const chunks = walk(png);
  if (!chunks) throw new Error('not a PNG');
  const end = chunks.find((c) => c.type === 'IEND');
  if (!end) throw new Error('a PNG without its end');
  const data = new Uint8Array(1 + envelope.length);
  data[0] = LAYOUT;
  data.set(envelope, 1);
  const body = new Uint8Array(4 + data.length);
  body.set(ascii(TYPE), 0);
  body.set(data, 4);
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(body, 4);
  view.setUint32(8 + data.length, crc32(body));
  // Everything but an old chunk of ours, ours, then the end.
  const parts = [png.subarray(0, 8), ...chunks.filter((c) => c.type !== TYPE && c.type !== 'IEND').map((c) => png.subarray(c.at, c.end)), chunk, png.subarray(end.at, end.end)];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/**
 * The envelope a PNG carries, or null: not a PNG, none in it, or one
 * that does not hold together. @param {Uint8Array} bytes
 */
export function envelopeIn(bytes) {
  const chunks = walk(bytes);
  const c = chunks?.find((x) => x.type === TYPE);
  if (!c || c.length < 2 || c.length > MAX_DATA) return null;
  const data = bytes.subarray(c.at + 8, c.at + 8 + c.length);
  if (data[0] !== LAYOUT) return null;
  return data.slice(1);
}

/**
 * The chunks of a PNG — where each starts and ends, its type and length —
 * or null if the file is not one, or breaks off, or a CRC is wrong.
 * @param {Uint8Array} b
 * @returns {{type: string, at: number, end: number, length: number}[] | null}
 */
function walk(b) {
  if (!isPng(b)) return null;
  const out = [];
  let at = 8;
  while (at < b.length) {
    if (at + 12 > b.length || out.length >= MAX_CHUNKS) return null;
    const length = u32(b, at);
    const end = at + 12 + length;
    if (length > 0x7fffffff || end > b.length) return null;
    const type = String.fromCharCode(b[at + 4], b[at + 5], b[at + 6], b[at + 7]);
    if (!/^[A-Za-z]{4}$/.test(type)) return null;
    if (crc32(b.subarray(at + 4, at + 8 + length)) !== u32(b, at + 8 + length)) return null;
    out.push({ type, at, end, length });
    at = end;
    if (type === 'IEND') break;
  }
  return out.some((c) => c.type === 'IEND') ? out : null;
}
