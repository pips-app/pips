// @ts-check
// What came in, before the core looks inside: what a file holds, why a card
// was not taken (in the same words wherever it came from), and whether the
// camera is seeing a code it has just read. Plain functions over bytes and
// codes; the core checks every signature in whatever they find. From
// web/src/ui/receive.js and web/src/ui/arrival.js, which did this beside
// their screens.

import { MAGIC } from '../formats/links.js';
import { bundleIsNewer, isBundle, unpackBundle } from '../formats/bundle.js';
import { envelopeIn, isPng } from '../formats/png-card.js';
import { CLIENT_CODES } from '../core/client.js';
import { APP_MISTAKES } from '../errors.js';

/** The first byte of an envelope (pips-wasm). */
const ENVELOPE = 0x45; // 'E'
/** Larger than any file of cards (a thousand of them at most, formats/bundle.js): not read at all. */
export const MAX_FILE = 16 * 1024 * 1024;
/**
 * Larger than any file of one card: a card is at most 64 KiB
 * (pips_format::MAX_PAYLOAD), and its envelope adds the signatures.
 */
const MAX_ONE = 70 * 1024;
/**
 * The same code seen again by the camera within this is the same look at
 * it; held longer, it is answered again — a message missed is said once
 * more. From web/src/ui/receive.js.
 */
export const REPEAT_MS = 2500;

/**
 * Why a file holds no card: not a Pips file; a picture without a card in
 * it; made by a newer app; a Pips file that does not hold together.
 * @typedef {'not_pips' | 'no_card' | 'newer' | 'damaged'} FileProblem
 */

/**
 * What one file holds: envelopes (a card's picture, a .pips file of one
 * card or of several), a bare signed card from before envelopes, or why
 * nothing. The file's size is checked by whoever reads it (MAX_FILE).
 * @param {Uint8Array} bytes
 * @returns {{ envelopes: Uint8Array[] } | { payload: Uint8Array } | { problem: FileProblem }}
 */
export function fileHolds(bytes) {
  if (bytes.length > MAX_FILE) return { problem: 'not_pips' };
  // A picture of a card from Pips holds the card itself.
  if (isPng(bytes)) {
    const env = envelopeIn(bytes);
    return env ? { envelopes: [env] } : { problem: 'no_card' };
  }
  if (isBundle(bytes)) {
    if (bundleIsNewer(bytes)) return { problem: 'newer' };
    const all = unpackBundle(bytes);
    return all ? { envelopes: all } : { problem: 'damaged' };
  }
  if (bytes.length > MAX_ONE || bytes.length <= MAGIC.length || !MAGIC.every((b, i) => bytes[i] === b)) return { problem: 'not_pips' };
  const body = bytes.slice(MAGIC.length);
  // What a code holds — an envelope, every signature in it checked — or,
  // from before envelopes, a bare signed card.
  return body[0] === ENVELOPE ? { envelopes: [body] } : { payload: body };
}

/** The core's codes for "well formed, but a signature does not check out". */
const FORGED = new Set(['bad_signature', 'bad_key', 'not_author', 'bad_edition', 'unsigned']);

/** How a card came: scanned, from a link, from a file. @typedef {'code' | 'link' | 'file'} Via */
/**
 * Why a card was not taken: made by a newer app (update, do not try
 * again); forged; the device full; or else damage — which each way calls
 * by its likely cause: a code is scanned again, a link was cut short on
 * the way, a file changed. A code that is not about the card at all — the
 * core's worker stopped or did not load, a mistake of the app
 * (core/client.js, errors.js) — is 'other', said by errors.js.
 * @typedef {'newer' | 'forged' | 'full' | 'damaged_code' | 'damaged_link' | 'damaged_file' | 'other'} Refusal
 */

/**
 * Why a card was not taken, the same wherever it came from.
 * @param {unknown} e what opening or keeping it threw @param {Via} via
 * @returns {Refusal}
 */
export function refusal(e, via) {
  const code = /** @type {any} */ (e)?.code;
  if (code === 'newer_version') return 'newer';
  if (FORGED.has(code)) return 'forged';
  if (code === 'storage_full') return 'full';
  // The core refused the bytes for what they are (damaged, cut short): a
  // code of its own, not one of the app's or the client's.
  if (typeof code === 'string' && !CLIENT_CODES.includes(code) && !APP_MISTAKES.has(code)) return via === 'code' ? 'damaged_code' : via === 'link' ? 'damaged_link' : 'damaged_file';
  return 'other';
}

/**
 * Whether the camera is seeing the code it has just read: the same text
 * within REPEAT_MS. A picture or a paste is chosen on purpose, and always
 * answered.
 * @param {{ text: string, at: number } | null} last @param {string} text @param {number} now
 */
export const sameLook = (last, text, now) => !!last && last.text === text && now - last.at < REPEAT_MS;

/**
 * Several cards taken in at once, counted for one line: new (a numbered
 * copy over a plain one is a card gained), already here, not taken.
 * @param {('added' | 'numbered' | 'duplicate' | 'refused')[]} outcomes
 */
export function tally(outcomes) {
  let added = 0, had = 0, bad = 0;
  for (const o of outcomes) {
    if (o === 'duplicate') had++;
    else if (o === 'refused') bad++;
    else added++;
  }
  return { added, had, bad };
}
