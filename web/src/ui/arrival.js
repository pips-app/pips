// @ts-check
// One way in for every card that arrives in an envelope — scanned, pasted
// or opened from a link: the core checks every signature, the card is
// stored, and it opens large in the collection. What did not check out is
// said in the same words wherever it came from.

import { t } from '../i18n.js';
import { app, receive } from '../state.js';
import { go, toast, ask } from './shell.js';
import { caught } from '../diagnostics.js';
import { cardTitle } from './card.js';

/** Core error codes meaning "well-formed, but a signature does not check out". */
const FORGED = new Set(['bad_signature', 'bad_key', 'not_author', 'bad_edition', 'unsigned']);

/**
 * Why a card was not taken, in the same words wherever it came from: made
 * by a newer app (update, do not ask again), forged, the device full — or
 * else what the way it came calls damage (`otherwise`, an i18n key).
 * @param {unknown} e what was thrown @param {string} otherwise
 */
export function refusal(e, otherwise) {
  const { code, name } = /** @type {any} */ (e) ?? {};
  if (name === 'QuotaExceededError') return t('err.storage-full'); // the card checked out; the device could not keep it
  return t(code === 'newer_version' ? 'receive.newer' : FORGED.has(code) ? 'receive.forged' : otherwise);
}

/** @param {{status: string, digest: string}} r */
export function arrived(r) {
  go('collection', { open: r.digest });
  const e = app.cards.get(r.digest)?.rec.edition;
  // A numbered copy of a card already here took its place: said, with its number.
  if (r.status === 'numbered' && e) toast(t('receive.numbered', t('back.edition', e.edition, e.of)));
  else toast(t(r.status === 'added' ? 'receive.got' : 'receive.dup'));
}

/** What damage is called, by the way the card came: a code is scanned again, a link was most likely cut short, a file changed on the way. */
const DAMAGED = { code: 'receive.damaged', link: 'link.bad', file: 'receive.file-damaged' };

/**
 * Opens, checks and keeps an envelope.
 * @param {Uint8Array} envelope @param {keyof typeof DAMAGED} [via]
 * @returns {Promise<boolean>} whether it was taken
 */
export async function arrive(envelope, via = 'code') {
  try {
    arrived(await receive(app.core.openEnvelope(envelope))); // throws unless every signature checks out
    return true;
  } catch (e) {
    caught(e, 'arrival');
    toast(refusal(e, DAMAGED[via]));
    return false;
  }
}

/**
 * The card in a link, without keeping it: what it is and who sent it, for
 * a first run to say why it is there. @param {Uint8Array} envelope
 * @returns {{title: string, author: string} | null}
 */
export function peek(envelope) {
  try {
    const o = app.core.openEnvelope(envelope);
    const card = app.core.inspectCard(o.payload).card;
    return { title: cardTitle(card), author: card.author || '' };
  } catch {
    return null;
  }
}

/** Whether a card from a link is waiting for the person's answer. */
let asking = false;

/**
 * A card from a link, kept only when the person says so. A scan or a file
 * is their own doing; a link may not be: a page that opened Pips keeps a
 * handle on its window and can change its address as often as it likes,
 * and each change would bring in another card. One question at a time: a
 * link that comes while one is open is not opened, and that is said.
 * @param {Uint8Array} envelope
 */
export async function arriveByLink(envelope) {
  if (asking) return void toast(t('link.busy'));
  const seen = peek(envelope);
  // What does not open is refused in its own words, as it always was.
  if (!seen) return void (await arrive(envelope, 'link'));
  asking = true;
  try {
    if (await ask(t('link.ask', seen.title, seen.author), { yes: t('link.keep'), no: t('link.skip') })) await arrive(envelope, 'link');
  } finally {
    asking = false;
  }
}

/**
 * Several envelopes at once — a file of many cards, or several files: each
 * checked and kept as one alone would be, and none refused for another's
 * fault. One card opens as it always does; several are said in one line,
 * and the collection shows them where they now lie.
 * @param {Uint8Array[]} envelopes @param {number} [failed] files already found to hold no card, counted with the rest
 */
export async function arriveMany(envelopes, failed = 0) {
  if (envelopes.length === 1 && !failed) return void (await arrive(envelopes[0], 'file'));
  // Damaged or forged, a card not taken is counted the same: one line cannot say which was which.
  let added = 0, had = 0, bad = failed;
  for (const env of envelopes) {
    try {
      const r = await receive(app.core.openEnvelope(env));
      if (r.status === 'duplicate') had++; else added++; // a numbered copy over a plain one is a card gained
    } catch (e) {
      // The device full: no use going on, and said as such.
      if (/** @type {any} */ (e)?.name === 'QuotaExceededError') {
        caught(e, 'arrival');
        go('collection');
        return toast(t('err.storage-full'));
      }
      bad++;
      // The core's refusals carry a code in words; anything else is worth the journal.
      if (typeof (/** @type {any} */ (e)?.code) !== 'string') caught(e, 'arrival');
    }
  }
  go('collection');
  toast(t('receive.many', added, had, bad));
}
