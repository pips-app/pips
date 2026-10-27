// @ts-check
// One way in for every card that arrives in an envelope — scanned, pasted
// or opened from a link: the core checks every signature, the card is
// stored, and it opens large in the collection. What did not check out is
// said in the same words wherever it came from.

import { t } from '../i18n.js';
import { app, receive } from '../state.js';
import { go, toast } from './shell.js';
import { caught } from '../diagnostics.js';
import { cardTitle } from './card.js';

/** Core error codes meaning "well-formed, but a signature does not check out". */
export const FORGED = new Set(['bad_signature', 'bad_key', 'not_author', 'bad_edition', 'unsigned']);

/** @param {{status: string, digest: string}} r */
export function arrived(r) {
  go('collection', { open: r.digest });
  toast(t(r.status === 'added' ? 'receive.got' : 'receive.dup'));
}

/**
 * Opens, checks and keeps an envelope. A damaged one from a link was most
 * likely cut short on the way, and is called that.
 * @param {Uint8Array} envelope @param {'link'|'code'} [via]
 * @returns {Promise<boolean>} whether it was taken
 */
export async function arrive(envelope, via = 'code') {
  try {
    arrived(await receive(app.core.openEnvelope(envelope))); // throws unless every signature checks out
    return true;
  } catch (e) {
    caught(e, 'arrival');
    const code = /** @type {any} */ (e)?.code;
    toast(t(FORGED.has(code) ? 'receive.forged' : via === 'link' ? 'link.bad' : 'receive.damaged'));
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
