// @ts-check
// Names on cards and envelopes are chosen by whoever signs them; only the
// key is proof. A name that reads the same as one already in the
// collection, signed with another key, is said: it may be another person
// with the same name, the artist with a new key — or someone passing as
// them. Kept apart from state.js so that it can be tested on its own.

/**
 * Lower-case letters of Cyrillic and Greek mapped to the Latin letter
 * either of their cases is drawn like: «М» looks like «M», so «м» counts as
 * «m», and «Мария» and «мария» still read as one name. One twin a letter
 * (Greek «ν» goes with «Ν», as n). Only these three scripts, where names
 * here are written: the whole Unicode list of look-alikes is thousands of
 * entries.
 */
const LOOKALIKE = new Map(Object.entries({
  // Cyrillic
  а: 'a', в: 'b', е: 'e', ё: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c', т: 't', у: 'y', х: 'x',
  і: 'i', ј: 'j', ѕ: 's', ԛ: 'q', ԝ: 'w', һ: 'h',
  // Greek
  α: 'a', β: 'b', ε: 'e', ζ: 'z', η: 'h', ι: 'i', κ: 'k', μ: 'm', ν: 'n', ο: 'o', ρ: 'p', τ: 't', υ: 'y', χ: 'x',
}));

/**
 * The form two names are compared in: compatibility forms folded (NFKC:
 * full-width letters, ligatures), case ignored, look-alike letters taken as
 * their Latin twin.
 * @param {string} name
 */
export function nameKey(name) {
  return [...name.normalize('NFKC').toLowerCase()].map((c) => LOOKALIKE.get(c) ?? c).join('');
}

/** The short form of a key, as the core writes it: its first four bytes. @param {string} hex */
export const shortKey = (hex) => hex.slice(0, 8).match(/../g)?.join('·') ?? hex;

/** @typedef {{name: string, hex: string}} Signer a name, and the key it came with */

/**
 * Every name seen in the collection with the keys it came with: artists of
 * the cards, and the people who sent them.
 * @param {Iterable<{card: {author: string}, rec: {from: {nick: string, key: string}|null}, author: {hex: string}|null}>} entries
 * @returns {Map<string, Set<string>>} nameKey → key hexes
 */
export function knownNames(entries) {
  /** @type {Map<string, Set<string>>} */
  const known = new Map();
  /** @param {string} name @param {string} hex */
  const add = (name, hex) => {
    if (!name) return;
    const k = nameKey(name);
    if (!known.has(k)) known.set(k, new Set());
    known.get(k)?.add(hex);
  };
  for (const e of entries) {
    if (e.author) add(e.card.author, e.author.hex);
    if (e.rec.from) add(e.rec.from.nick, e.rec.from.key);
  }
  return known;
}

/**
 * Whether a name is known here with a key other than the one it came with:
 * the person's own name with another key than theirs, or a name in the
 * collection seen with another key too. Two artists who share a name keep
 * being told apart this way on both their cards: a plain fact, not a
 * verdict. Null when nothing is to be said.
 * @param {Signer} signer @param {Map<string, Set<string>>} known @param {Signer} own the person's nick and key
 * @returns {{own: true} | {own: false, other: string} | null} other: the short form of another key the name is known by
 */
export function clash(signer, known, own) {
  if (!signer.name) return null;
  const k = nameKey(signer.name);
  if (own.name && nameKey(own.name) === k) return signer.hex === own.hex ? null : { own: true };
  const other = [...(known.get(k) ?? [])].find((hex) => hex !== signer.hex);
  return other ? { own: false, other: shortKey(other) } : null;
}
