// @ts-check
// The layout of the new app's database (pips-next), and how it changes from
// one version to the next. Its version is the database's own version
// number, so the browser keeps every tab honest: a newer app opening the
// data upgrades it in one transaction (all of it or none), older tabs are
// told to step aside, and an older app can no longer open data it does not
// know. From web/src/schema.js.
//
// A step is never edited once released: a new layout is a new step at the
// end, with its test. The old app's data comes over once, at the switch
// (docs/REWRITE.md, stage 6), not through these steps.

/** The layout this app writes. */
export const SCHEMA = 1;

/**
 * @typedef {{
 *   stores?: (db: IDBDatabase) => void,
 *   card?: (rec: any) => any,
 *   meta?: (key: string, value: any) => any,
 * }} Step
 * stores: object stores to create or remove; card and meta: each record,
 * old in, new out (the same object back means "unchanged").
 */

/** STEPS[v] takes stored data from version v to v + 1. @type {Step[]} */
export const STEPS = [
  // 0 → 1: a new device. The key is not here: it has a database of its own
  // that only the core's worker opens (core/keys.js).
  {
    stores(db) {
      db.createObjectStore('meta');
      db.createObjectStore('cards', { keyPath: 'digest' });
    },
  },
];

/**
 * The steps from one version to another, in order.
 * @param {number} from @param {number} [to]
 */
export function stepsFrom(from, to = SCHEMA) {
  if (!Number.isInteger(from) || from < 0 || from > to) throw new RangeError(`no way from layout ${from} to ${to}`);
  return STEPS.slice(from, to);
}
