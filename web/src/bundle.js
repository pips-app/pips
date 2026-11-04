// @ts-check
// Several cards in one .pips file: the same envelopes a code carries, one
// after another, each with its length. A file of one card stays what it
// was (the signature, then the envelope); a file of several says so in the
// byte after the signature:
//
//   P P 0x1a 0x0a | 'B' | layout 1 | count (u16) | count × (length (u32) | envelope)
//
// Reading is for files from anywhere: every count and length is checked
// before it is used, and the envelopes must fill the file exactly — no
// bytes before, between or after them. What comes out is only bytes: the
// core checks every signature in every envelope. No DOM: runs under node.

import { MAGIC } from './links.js';

/** The byte after the signature: a bundle. */
const BUNDLE = 0x42; // 'B'
/** The first byte of an envelope (pips-wasm). */
const ENVELOPE = 0x45; // 'E'
const LAYOUT = 1;
/** More than any collection shares at once, few enough to check in moments. */
export const MAX_CARDS = 1000;
/** No envelope is larger (pips-wasm MAX_LINK is far below this). */
const MAX_ENVELOPE = 256 * 1024;

/** One .pips file holding all of these envelopes. @param {Uint8Array[]} envelopes @returns {Uint8Array<ArrayBuffer>} */
export function packBundle(envelopes) {
  if (!envelopes.length || envelopes.length > MAX_CARDS) throw new Error(`a bundle holds 1 to ${MAX_CARDS} cards`);
  const size = MAGIC.length + 4 + envelopes.reduce((n, e) => n + 4 + e.length, 0);
  const out = new Uint8Array(size), view = new DataView(out.buffer);
  out.set(MAGIC, 0);
  let at = MAGIC.length;
  out[at++] = BUNDLE;
  out[at++] = LAYOUT;
  view.setUint16(at, envelopes.length);
  at += 2;
  for (const e of envelopes) {
    if (!e.length || e.length > MAX_ENVELOPE || e[0] !== ENVELOPE) throw new Error('not an envelope');
    view.setUint32(at, e.length);
    out.set(e, at + 4);
    at += 4 + e.length;
  }
  return out;
}

/** Whether the bytes are a bundle (by its first bytes; whole or not). @param {Uint8Array} b */
export const isBundle = (b) => b.length > MAGIC.length && MAGIC.every((v, i) => b[i] === v) && b[MAGIC.length] === BUNDLE;

/** Whether a bundle was laid out by a newer app than this one: to be said, not called damaged. @param {Uint8Array} b */
export const bundleIsNewer = (b) => isBundle(b) && b.length > MAGIC.length + 1 && b[MAGIC.length + 1] > LAYOUT;

/**
 * The envelopes in a bundle, or null if it is not one, or does not hold
 * together. @param {Uint8Array} b @returns {Uint8Array[] | null}
 */
export function unpackBundle(b) {
  if (!isBundle(b) || b.length < MAGIC.length + 4) return null;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let at = MAGIC.length + 1;
  if (b[at++] !== LAYOUT) return null;
  const count = view.getUint16(at);
  at += 2;
  if (count < 1 || count > MAX_CARDS) return null;
  /** @type {Uint8Array[]} */
  const out = [];
  for (let k = 0; k < count; k++) {
    if (at + 4 > b.length) return null;
    const n = view.getUint32(at);
    at += 4;
    if (n < 1 || n > MAX_ENVELOPE || at + n > b.length || b[at] !== ENVELOPE) return null;
    out.push(b.slice(at, at + n));
    at += n;
  }
  return at === b.length ? out : null;
}
