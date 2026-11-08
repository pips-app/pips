// @ts-check
// The new app's storage: IndexedDB, nothing leaves the device. From
// web/src/store.js, whose handling of a browser that closes or replaces the
// connection is proven; what changed is said where it did.
//
// `meta`  — key/value: profile, settings, what changed since the backup.
// `cards` — one record per card, keyed by digest (rules/cards.js,
//           CardRecord): payload bytes exactly as received, so a card passed
//           on later carries everything it arrived with.
// The key is not here: only the core's worker holds it (core/keys.js).

/** @typedef {import('./rules/cards.js').CardRecord} CardRecord */

/**
 * The codes storage refuses with: data from a newer app; an upgrade that
 * failed (nothing changed); storage that would not open this once; data
 * handed to a newer app in another tab; no room left on the device (also
 * for the key's storage, core/serve.js).
 */
export const STORE_CODES = ['newer_data', 'upgrade_failed', 'store_unavailable', 'store_replaced', 'storage_full'];

import { SCHEMA, stepsFrom } from './schema.js';

/** The open connection; null when the browser closed it (it may, on its own). @type {IDBDatabase | null} */
let db = null;
let dbName = '';
/** Handed over to a newer app in another tab: never opened again here. */
let gone = false;
/** A reopening under way, shared by everyone who needs the data meanwhile. @type {Promise<void> | null} */
let reopening = null;
/** Connections the browser closed: what was under way on them failed for that reason alone. @type {WeakSet<IDBDatabase>} */
const closed = new WeakSet();
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
 * @param {string} [name] another database, for tests
 */
export async function open(name = 'pips-next') {
  dbName = name;
  try {
    await openDb(name);
  } catch (e) {
    // Data that is there but cannot be used as it is must not be hidden
    // behind an empty app; only a browser without storage falls back: none
    // at all, or one that refuses it on purpose (a private window, storage
    // turned off). Anything else — the browser's storage failing this once
    // — may stand in front of a whole collection: the app stops and says so,
    // rather than start empty over it.
    if (['newer_data', 'upgrade_failed'].includes(/** @type {any} */ (e)?.code)) throw e;
    const refused = !globalThis.indexedDB || ['SecurityError', 'InvalidStateError'].includes(/** @type {any} */ (e)?.name);
    if (!refused) throw Object.assign(new Error('storage would not open', { cause: e }), { code: 'store_unavailable' });
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
      const d = (db = req.result);
      d.onversionchange = () => {
        gone = true;
        d.close();
        db = null;
        replaced();
      };
      // The browser can close a connection by itself (Firefox does, on
      // Android, after a while in the background): the next use reopens it.
      d.onclose = () => {
        closed.add(d);
        if (db === d) db = null;
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

/**
 * A transaction on the open connection, opened again first if the browser
 * closed it. A connection can be closed without its close event having come
 * yet: then the attempt fails with InvalidStateError and is made once more.
 * @param {string} store @param {IDBTransactionMode} mode @returns {Promise<IDBTransaction>}
 */
async function begin(store, mode) {
  for (let attempt = 0; ; attempt++) {
    if (gone) throw Object.assign(new Error('the data is now used by a newer version of the app'), { code: 'store_replaced' });
    if (!db) await (reopening ??= openDb(dbName).finally(() => { reopening = null; }));
    try {
      return /** @type {IDBDatabase} */ (db).transaction(store, mode);
    } catch (e) {
      if (attempt || /** @type {any} */ (e)?.name !== 'InvalidStateError') throw e;
      db?.close();
      db = null;
    }
  }
}

/**
 * Runs `run` on a transaction, once more if the browser closed the
 * connection under it (its requests fail then, through no fault of theirs).
 * Reads are safe to repeat, and so are these writes: each puts or deletes
 * one whole record.
 * @template T @param {string} store @param {IDBTransactionMode} mode @param {(t: IDBTransaction) => Promise<T>} run @returns {Promise<T>}
 */
async function retried(store, mode, run) {
  const t = await begin(store, mode);
  try {
    return await run(t);
  } catch (e) {
    // The close event comes after the aborts it causes, so an abort with no
    // error of its own (this code never aborts) counts as one too.
    if (!closed.has(t.db) && /** @type {any} */ (e)?.name !== 'AbortError') throw e;
    if (db === t.db) {
      db = null;
      t.db.close(); // if it was still open: one connection at a time, never two
    }
    return run(await begin(store, mode));
  }
}

/** @param {string} store @param {(s: IDBObjectStore) => IDBRequest} op */
const read = (store, op) => retried(store, 'readonly', (t) => done(op(t.objectStore(store))));

/**
 * A write, done once it is on disk: a request succeeds before its
 * transaction commits, and a commit can still fail (the disk is full), so
 * waiting for the request alone would report a save that never happened.
 * @param {string} store @param {(s: IDBObjectStore) => IDBRequest} op
 */
function write(store, op) {
  return retried(store, 'readwrite', (t) => new Promise((resolve, reject) => {
    op(t.objectStore(store));
    t.oncomplete = () => resolve(undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new DOMException('transaction aborted', 'AbortError'));
  })).catch((e) => {
    // The person can make room: said so, not taken for a mistake of the app.
    if (/** @type {any} */ (e)?.name === 'QuotaExceededError') throw Object.assign(new Error('no room left on the device', { cause: e }), { code: 'storage_full' });
    throw e;
  });
}

/** @param {string} key */
export const getMeta = async (key) => (memoryOnly ? mem.meta.get(key) : read('meta', (m) => m.get(key)));
/** @param {string} key @param {any} value */
export const setMeta = async (key, value) => (memoryOnly ? void mem.meta.set(key, value) : write('meta', (m) => m.put(value, key)));

/** @param {string} digest @returns {Promise<CardRecord | undefined>} */
export const getCard = async (digest) => (memoryOnly ? mem.cards.get(digest) : read('cards', (c) => c.get(digest)));
/** @returns {Promise<CardRecord[]>} */
export const allCards = async () => (memoryOnly ? [...mem.cards.values()] : read('cards', (c) => c.getAll()));
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
