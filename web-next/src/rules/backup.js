// @ts-check
// Restoring a backup onto the cards already on the device. Nothing kept is
// overwritten: a card already here keeps its place, its note and its tags,
// gaining the backup's only where it has none; logs of numbered copies are
// joined, so no number is lost; the person's own numbered copy wins over a
// plain one. The profile fills only the fields this device has empty.
// From web/src/state.js (applyBackup), as plain functions.

import { joinLogs, copyOf } from './editions.js';
import { ownCopyOf } from './cards.js';

/** @typedef {import('./cards.js').CardRecord} CardRecord */
/** @typedef {{ nick: string, handle: { network: string, text: string } | null, link: string }} Profile */

/**
 * A backup's card as the core opens it, with what the app learnt of it from
 * the core: its digest, and whether the person's key signed it.
 * @typedef {{
 *   digest: string, mine: boolean,
 *   payload: Uint8Array, cert: Uint8Array | null, edition: CardRecord['edition'],
 *   state: CardRecord['state'], received: number, trashedAt: number | null,
 *   from: CardRecord['from'], note: string, tags?: string[], editions?: CardRecord['editions'],
 * }} BackupCard
 */

/**
 * What restoring a backup's cards changes.
 * @param {Map<string, CardRecord>} here the cards on the device, by digest
 * @param {BackupCard[]} cards the backup's
 * @param {string | null} me the person's key, hex
 * @returns {{ put: CardRecord[], added: number, known: number }}
 */
export function mergeCards(here, cards, me) {
  /** @type {Map<string, CardRecord>} */
  const put = new Map();
  /** Cards of the backup counted already: one it holds twice counts once. */
  const counted = new Set();
  let added = 0, known = 0;
  for (const c of cards) {
    // A card held twice: its later entry adds to what the first left.
    const kept = put.get(c.digest) ?? here.get(c.digest);
    const first = !counted.has(c.digest);
    counted.add(c.digest);
    if (!kept) {
      put.set(c.digest, {
        digest: c.digest, payload: c.payload, cert: c.cert ?? null, edition: c.edition ?? null, mine: c.mine,
        state: c.state, received: c.received, trashedAt: c.trashedAt ?? null, from: c.from ?? null,
        note: c.note, tags: c.tags ?? [], ...(c.editions ? { editions: c.editions } : {}),
      });
      added++;
      continue;
    }
    if (first) known++;
    let r = kept;
    if (ownCopyOf(r, c, me)) r = { ...r, payload: c.payload, cert: c.cert, edition: c.edition, from: c.from ?? null, mine: c.mine };
    const takeNote = !r.note && !!c.note;
    const takeTags = !r.tags?.length && !!c.tags?.length;
    const editions = r.editions || c.editions ? joinLogs(r.editions, c.editions) : undefined;
    // A copy this log has not got — by the copies themselves, not by how
    // many there are: a log that lists one twice would hide a new one.
    const had = new Set((r.editions?.issued ?? []).map(copyOf));
    const more = !!editions?.issued.some((i) => !had.has(copyOf(i)));
    if (r !== kept || takeNote || takeTags || more) {
      put.set(c.digest, { ...r, ...(takeNote ? { note: c.note } : {}), ...(takeTags ? { tags: /** @type {string[]} */ (c.tags) } : {}), ...(editions ? { editions } : {}) });
    }
  }
  return { put: [...put.values()], added, known };
}

/**
 * The profile once a backup's fills what this device has empty, and
 * whether anything was taken.
 * @param {Profile} here @param {Profile} file
 * @returns {{ profile: Profile, took: boolean }}
 */
export function mergeProfile(here, file) {
  const profile = { nick: here.nick || file.nick || '', handle: here.handle ?? file.handle ?? null, link: here.link || file.link || '' };
  return { profile, took: profile.nick !== here.nick || profile.handle !== here.handle || profile.link !== here.link };
}
