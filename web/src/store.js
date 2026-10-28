// @ts-check
// Local storage: IndexedDB, nothing leaves the device.
//
// `meta`  — key/value: identity seed, profile, settings.
// `cards` — one record per card, keyed by digest:
//   { digest, payload: Uint8Array, cert: Uint8Array|null, edition: {…}|null, mine: boolean,
//     state: 'collection'|'archive'|'trash', received: ms, trashedAt: ms|null,
//     from: {nick, key}|null, note: string, tags?: string[] }
// Payload bytes are stored exactly as received, so a card passed on later
// carries everything it arrived with.

/** @typedef {{digest: string, payload: Uint8Array, cert: Uint8Array|null,
 *   edition: {edition: number, of: number, holder: string, day: number}|null, mine: boolean,
 *   state: 'collection'|'archive'|'trash', received: number, trashedAt: number|null,
 *   from: {nick: string, key: string}|null, note: string, tags?: string[],
 *   editions?: import('./state.js').EditionLog}} CardRecord */

import { SCHEMA, stepsFrom } from './schema.js';

/** @type {IDBDatabase} */
let db;
/** When IndexedDB is unavailable (some private modes, blocked site data),
 * everything lives in memory for this session; `memoryOnly` says so. */
export let memoryOnly = false;
const mem = { meta: new Map(), cards: new Map() };

/** Called when another tab, with a newer app, needs the data: this one must stop using it. */
let replaced = () => {};
/** @param {() => void} fn */
export function onReplaced(fn) { replaced = fn; }
/** Called while an older tab still holds the data this one needs to upgrade. */
let blocked = () => {};
/** @param {() => void} fn */
export function onBlocked(fn) { blocked = fn; }

/**
 * Opens the data, upgrading its layout first if it is older (see schema.js).
 * Data from a newer app is refused with the code `newer_data` — falling
 * back to memory then would show an empty app over a full collection.
 * @param {string} name
 */
export async function open(name) {
  try {
    await openDb(name);
  } catch (e) {
    // Data that is there but cannot be used as it is must not be hidden
    // behind an empty app; only a browser without storage falls back.
    if (['newer_data', 'upgrade_failed'].includes(/** @type {any} */ (e)?.code)) throw e;
    console.warn('pips: IndexedDB unavailable, keeping data in memory', e);
    memoryOnly = true;
  }
}

/** @param {string} name */
function openDb(name) {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) throw new Error('no IndexedDB');
    const req = indexedDB.open(name, SCHEMA);
    let upgrading = false;
    req.onupgradeneeded = (e) => {
      upgrading = e.oldVersion > 0;
      upgrade(req.result, /** @type {IDBTransaction} */ (req.transaction), e.oldVersion);
    };
    // Tabs of an app from before onversionchange cannot be asked to let go:
    // the person is, and the upgrade goes on by itself once they have.
    req.onblocked = () => blocked();
    req.onsuccess = () => {
      db = req.result;
      db.onversionchange = () => {
        db.close();
        replaced();
      };
      resolve(undefined);
    };
    req.onerror = () => {
      const err = req.error;
      if (err?.name === 'VersionError') reject(Object.assign(new Error('the data was stored by a newer version of the app'), { code: 'newer_data' }));
      // A failed upgrade changed nothing (its transaction is undone), but the
      // data is not usable by this version as it is.
      else if (upgrading) reject(Object.assign(new Error(`could not upgrade the stored data: ${err?.message ?? err}`), { code: 'upgrade_failed' }));
      else reject(err);
    };
  });
}

/**
 * Walks the data through every step from its version to this app's, inside
 * the upgrade's own transaction: if anything fails, nothing has changed.
 * @param {IDBDatabase} d @param {IDBTransaction} t @param {number} from
 */
function upgrade(d, t, from) {
  const steps = stepsFrom(from);
  // Stores first, all of them: a later step's records may live in them.
  for (const s of steps) s.stores?.(d);
  const card = (/** @type {any} */ rec) => steps.reduce((r, s) => (s.card ? s.card(r) : r), rec);
  const meta = (/** @type {string} */ key, /** @type {any} */ value) => steps.reduce((v, s) => (s.meta ? s.meta(key, v) : v), value);
  /** @param {string} store @param {(cur: IDBCursorWithValue) => any} next */
  const walk = (store, next) => {
    t.objectStore(store).openCursor().onsuccess = (e) => {
      const cur = /** @type {IDBCursorWithValue|null} */ (/** @type {IDBRequest} */ (e.target).result);
      if (!cur) return;
      const v = next(cur);
      if (v !== cur.value) cur.update(v);
      cur.continue();
    };
  };
  if (steps.some((s) => s.card)) walk('cards', (cur) => card(cur.value));
  if (steps.some((s) => s.meta)) walk('meta', (cur) => meta(String(cur.key), cur.value));
}

/** @param {IDBRequest} req */
function done(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** @param {string} store @param {IDBTransactionMode} mode */
function tx(store, mode) {
  return db.transaction(store, mode).objectStore(store);
}

/**
 * A write, done once it is on disk: a request succeeds before its
 * transaction commits, and a commit can still fail (the disk is full), so
 * waiting for the request alone would report a save that never happened.
 * @param {string} store @param {(s: IDBObjectStore) => IDBRequest} op
 */
function write(store, op) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, 'readwrite');
    op(t.objectStore(store));
    t.oncomplete = () => resolve(undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new DOMException('transaction aborted', 'AbortError'));
  });
}

/** @param {string} key */
export const getMeta = async (key) => (memoryOnly ? mem.meta.get(key) : done(tx('meta', 'readonly').get(key)));
/** @param {string} key @param {any} value */
export const setMeta = async (key, value) => (memoryOnly ? void mem.meta.set(key, value) : write('meta', (m) => m.put(value, key)));

/** @returns {Promise<CardRecord[]>} */
export const allCards = async () => (memoryOnly ? [...mem.cards.values()] : done(tx('cards', 'readonly').getAll()));
/** @param {string} digest @returns {Promise<CardRecord|undefined>} */
export const getCard = async (digest) => (memoryOnly ? mem.cards.get(digest) : done(tx('cards', 'readonly').get(digest)));
/** @param {CardRecord} rec */
export const putCard = async (rec) => (memoryOnly ? void mem.cards.set(rec.digest, rec) : write('cards', (c) => c.put(rec)));
/** @param {string} digest */
export const deleteCard = async (digest) => (memoryOnly ? void mem.cards.delete(digest) : write('cards', (c) => c.delete(digest)));

/** Asks the browser not to evict our data under storage pressure. */
export async function persist() {
  if (!navigator.storage?.persist) return false;
  return (await navigator.storage.persisted()) || navigator.storage.persist();
}

export async function isPersisted() {
  return navigator.storage?.persisted ? navigator.storage.persisted() : false;
}
