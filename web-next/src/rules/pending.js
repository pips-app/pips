// @ts-check
// What changed since the last backup, so that the app can say a backup is
// due — and how much it would bring. Typing a note is many changes to one
// card, so cards are counted, not changes. From web/src/state.js (touch).

/** @typedef {{ cards: string[], profile: boolean, issued: number }} Pending */

/** Nothing changed since the last backup. @type {Pending} */
export const NOTHING = Object.freeze({ cards: [], profile: false, issued: 0 });

/**
 * The pending changes once one more is made; the same object when it adds
 * nothing (a card already counted), so the caller can skip writing.
 * @param {Pending} p @param {{ card?: string, profile?: boolean, issued?: number }} what
 * @returns {Pending}
 */
export function touched(p, what) {
  const card = !!what.card && !p.cards.includes(what.card);
  const profile = !!what.profile && !p.profile;
  if (!card && !profile && !what.issued) return p;
  return {
    cards: card ? [...p.cards, /** @type {string} */ (what.card)] : p.cards,
    profile: p.profile || !!what.profile,
    issued: p.issued + (what.issued ?? 0),
  };
}
