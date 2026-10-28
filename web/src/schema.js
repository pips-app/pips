// @ts-check
// The layout of what is stored, and how it changes from one version of the
// app to the next. Its version is the database's own version number, so
// the browser keeps every tab honest: a newer app opening the data upgrades
// it in one transaction (all of it or none), the older tabs are told to
// step aside, and an older app can no longer open data it does not know.
//
// A step is never edited once released: a new layout is a new step at the
// end. Steps change records with plain functions, here, so that each one
// is tested apart from the browser; store.js walks the records through them.

/** The layout this app writes. */
export const SCHEMA = 2;

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
  // 0 → 1: a new device.
  {
    stores(db) {
      db.createObjectStore('meta');
      db.createObjectStore('cards', { keyPath: 'digest' });
    },
  },
  // 1 → 2: the first change of layout. Before it, fields that came later
  // were simply missing from older records; now every record has them all.
  { card: fillCard },
];

/** Every field of a card record, with what an older record lacked filled in. @param {any} rec */
export function fillCard(rec) {
  const full = { cert: null, edition: null, trashedAt: null, from: null, note: '', ...rec, tags: Array.isArray(rec.tags) ? rec.tags : [] };
  return Object.keys(full).length === Object.keys(rec).length && Array.isArray(rec.tags) ? rec : full;
}

/**
 * The steps from one version to another, in order.
 * @param {number} from @param {number} [to]
 */
export function stepsFrom(from, to = SCHEMA) {
  if (!Number.isInteger(from) || from < 0 || from > to) throw new RangeError(`no way from layout ${from} to ${to}`);
  return STEPS.slice(from, to);
}
