// @ts-check
// What happens to a card: arriving, being moved, binned, noted, tagged.
// Plain functions over records — no storage, no core, no clock of their
// own — so that each rule is tested apart, and under random inputs. The
// app's state (later) reads the core for what it needs to know about a
// card (its digest, its author), asks these what follows, and stores it.
// From web/src/state.js, where the same rules were mixed with storage.

/** @typedef {import('./editions.js').EditionLog} EditionLog */
/** @typedef {'collection' | 'archive' | 'trash'} Place */
/** @typedef {{ edition: number, of: number, holder: string, day: number }} Edition */

/**
 * A stored card, as the old app stores it (web/src/store.js), so that its
 * data moves over unchanged (docs/REWRITE.md, stage 6).
 * @typedef {{
 *   digest: string,
 *   payload: Uint8Array,
 *   cert: Uint8Array | null,
 *   edition: Edition | null,
 *   mine: boolean,
 *   state: Place,
 *   received: number,
 *   trashedAt: number | null,
 *   from: { nick: string, key: string } | null,
 *   note: string,
 *   tags: string[],
 *   editions?: EditionLog,
 * }} CardRecord
 */

/** Days a binned card waits before it goes for good. */
export const TRASH_DAYS = 30;
const DAY = 86_400_000;
/** Longest note, in bytes of UTF-8: pips-store's MAX_NOTE. */
export const NOTE_BYTES = 4000;
/** Most tags on a card: pips-store's MAX_TAGS. */
export const MAX_TAGS = 16;

/**
 * Whether `got` is the person's own numbered copy of a card kept as
 * `here` without one: the same picture (the same digest), with a
 * certificate made out to their key — where the one kept is plain, or
 * someone else's numbered copy seen on its way to them. A numbered copy of
 * their own already kept stays.
 * @param {{ edition: Edition | null }} here @param {{ cert: Uint8Array | null, edition: Edition | null }} got
 * @param {string | null} me the person's key, hex
 */
export function ownCopyOf(here, got, me) {
  return !!me && !!got.cert && got.edition?.holder === me && here.edition?.holder !== me;
}

/**
 * What keeping an arriving card does. A card not kept is added as it came.
 * One already kept comes back to the collection if it was put away, and
 * otherwise stays as it is — unless what came is the person's own numbered
 * copy of it: then that takes its place, payload and certificate together
 * (the certificate holds for the signature it came with), and the note,
 * tags and log stay.
 * @param {CardRecord | null} here the card kept under the same digest
 * @param {CardRecord} got the card that came, as a record
 * @param {string | null} me
 * @returns {{ status: 'added' | 'numbered' | 'duplicate', rec: CardRecord, changed: boolean }}
 */
export function arrive(here, got, me) {
  if (!here) return { status: 'added', rec: got, changed: true };
  const back = here.state === 'collection' ? here : { ...here, state: /** @type {Place} */ ('collection'), trashedAt: null };
  if (!ownCopyOf(here, got, me)) return { status: 'duplicate', rec: back, changed: back !== here };
  const rec = { ...back, payload: got.payload, cert: got.cert, edition: got.edition, from: got.from, mine: got.mine };
  return { status: 'numbered', rec, changed: true };
}

/**
 * A card moved to `place`; a binned card remembers when.
 * @param {CardRecord} rec @param {Place} place @param {number} now
 * @returns {CardRecord}
 */
export const moved = (rec, place, now) => ({ ...rec, state: place, trashedAt: place === 'trash' ? now : null });

/** Whether a binned card's time is up. @param {CardRecord} rec @param {number} now */
export const expired = (rec, now) => rec.state === 'trash' && !!rec.trashedAt && now - rec.trashedAt > TRASH_DAYS * DAY;

/** Days left before a binned card goes for good: at least one while it is there. @param {CardRecord} rec @param {number} now */
export const daysLeft = (rec, now) => Math.max(1, TRASH_DAYS - Math.floor((now - (rec.trashedAt ?? now)) / DAY));

/**
 * The longest start of `s` that fits `max` bytes of UTF-8, whole
 * characters only.
 * @param {string} s @param {number} max
 */
export function fitBytes(s, max) {
  const enc = new TextEncoder();
  if (enc.encode(s).length <= max) return s;
  const chars = Array.from(s);
  let lo = 0, hi = chars.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (enc.encode(chars.slice(0, mid).join('')).length <= max) lo = mid; else hi = mid - 1;
  }
  return chars.slice(0, lo).join('');
}

/** A card with this note, cut to what a backup holds. @param {CardRecord} rec @param {string} note @returns {CardRecord} */
export const noted = (rec, note) => ({ ...rec, note: fitBytes(note, NOTE_BYTES) });

/**
 * A card with these tags (already normal), each once, at most MAX_TAGS.
 * @param {CardRecord} rec @param {string[]} tags @returns {CardRecord}
 */
export const tagged = (rec, tags) => ({ ...rec, tags: [...new Set(tags)].slice(0, MAX_TAGS) });

/**
 * Whether the card is the person's own: signed by their key. After the key
 * changes, the old key's cards are someone else's (a former self's) and
 * can no longer be issued from here.
 * @param {{ hex: string } | null} author @param {string | null} me
 */
export const isMine = (author, me) => !!author && !!me && author.hex === me;
