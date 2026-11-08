// @ts-check
// The person's key, in the core's worker (docs/REWRITE.md, О1). Loaded
// only there: the page asks for signatures and never holds the key.
//
// Where the browser can, the key is handed to it as a WebCrypto Ed25519
// key that cannot be exported, and its secret is forgotten: it signs, and
// nothing — not this app, not code that ever gets into the page — can
// copy it. The core then signs in two steps (what to sign, then the result
// from the signature), and the bytes are the same as before. A browser
// without Ed25519 in WebCrypto keeps the secret as the old app did, and
// the app says so (state "open"); once the browser can hide it, it is
// hidden the next time it is read.
//
// The kept key is read again for every job: another tab may have switched
// it, and a job signs with the key the person has now.
//
// Words come out once, when a key is made; nothing is stored until the
// person has checked that they wrote them down (keep()). A key restored
// from its words waits the same way, so the page can check it against a
// backup first. That waiting key lives only in this worker's memory: a
// restarted worker has forgotten it (key_lost).

import * as core from '../../pkg/pips_wasm.js';

/**
 * The codes the key's jobs refuse with, beside the core's: no key kept
 * (a mistake of the app, which asks only once one is); a key that was
 * waiting to be kept lost with a restarted worker; and another key kept
 * meanwhile (in another tab), which only switching replaces.
 */
export const KEY_CODES = ['no_key', 'key_lost', 'key_exists'];

/** The key's own database, apart from the app's: only this worker opens it. */
const DB = 'pips-next-key';
const STORE = 'key';
/** The one record. */
const ID = 'identity';

/**
 * What is kept.
 * @typedef {{
 *   publicKey: Uint8Array,
 *   sign: CryptoKey | null,
 *   seed: Uint8Array | null,
 *   backup: Uint8Array,
 * }} Kept
 */

/** A key's public half, as the page shows it. @typedef {{ hex: string, short: string }} KeyData */

/** The PKCS #8 wrapping of an Ed25519 seed (RFC 8410): this prefix, then the 32 bytes. */
const PKCS8 = [0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20];

/** A key the person has not kept yet: made, or restored. @type {core.Identity | null} */
let waiting = null;

/** @returns {Promise<IDBDatabase>} */
function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** @template T @param {IDBTransactionMode} mode @param {(s: IDBObjectStore) => IDBRequest} op @returns {Promise<T>} */
async function run(mode, op) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = op(t.objectStore(STORE));
      t.oncomplete = () => resolve(req.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error ?? new DOMException('aborted', 'AbortError'));
    });
  } finally {
    db.close();
  }
}

/** The kept key; one kept in the open is hidden now if the browser can. @returns {Promise<Kept | null>} */
async function read() {
  /** @type {Kept | undefined} */
  const k = await run('readonly', (s) => s.get(ID));
  if (!k?.seed) return k ?? null;
  const sign = await hide(k.seed);
  if (!sign) return k;
  k.seed.fill(0);
  /** @type {Kept} */
  const hidden = { ...k, sign, seed: null };
  await run('readwrite', (s) => s.put(hidden, ID));
  return hidden;
}

/**
 * The seed as a WebCrypto key that signs and cannot be exported, or null
 * where the browser has no Ed25519.
 * @param {Uint8Array} seed
 */
async function hide(seed) {
  try {
    return await crypto.subtle.importKey('pkcs8', new Uint8Array([...PKCS8, ...seed]), { name: 'Ed25519' }, false, ['sign']);
  } catch (e) {
    if (/** @type {any} */ (e)?.name === 'NotSupportedError') return null;
    throw e;
  }
}

/** @param {Uint8Array} bytes */
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
/** @param {string} text */
const fromHex = (text) => Uint8Array.from(text.match(/../g) ?? [], (b) => parseInt(b, 16));

/** The kept key, or a refusal: no job signs without one. */
async function need() {
  const k = await read();
  if (!k) throw { code: 'no_key', message: 'no key is kept' };
  return k;
}

/** @param {string} what */
function waitingKey(what) {
  if (!waiting) throw { code: 'key_lost', message: `nothing waits to be ${what}` };
  return waiting;
}

/**
 * Signs `message` with the kept key: in the browser, or (state "open") in
 * the core from the kept secret, through `held`.
 * @template T
 * @param {Kept} k
 * @param {Uint8Array} message what the core says to sign
 * @param {(signature: Uint8Array) => T} done the result from the signature
 * @param {(identity: core.Identity) => T} held the same, signed by the core
 */
async function signed(k, message, done, held) {
  if (k.sign) return done(new Uint8Array(await crypto.subtle.sign('Ed25519', k.sign, /** @type {BufferSource} */ (message))));
  const id = core.Identity.fromSeed(/** @type {Uint8Array} */ (k.seed));
  try {
    return held(id);
  } finally {
    id.free();
  }
}

/** The key's jobs, by name (ops.js lists them with the core's). */
export const keyOps = {
  /**
   * Whether a key is kept, and how: "hidden" in the browser, "open" where
   * the browser cannot hide it, or "none".
   * @returns {Promise<{ state: 'none' } | { state: 'hidden' | 'open', key: KeyData }>}
   */
  async keyState() {
    const k = await read();
    if (!k) return { state: 'none' };
    return { state: k.sign ? 'hidden' : 'open', key: core.keyData(k.publicKey) };
  },

  /** A new key, waiting to be kept: its words and paper key, shown now or never. */
  keyNew() {
    waiting?.free();
    waiting = core.Identity.fromSeed(crypto.getRandomValues(new Uint8Array(32)));
    return { words: waiting.words(), paper: waiting.paper(), key: waiting.publicKey() };
  },

  /**
   * The key from its 24 words or its paper key, waiting to be kept (the
   * page checks it against a backup first).
   * @param {{ words?: string, paper?: string }} from
   */
  keyRestore(from) {
    const id = from.paper !== undefined ? core.Identity.fromPaper(from.paper) : core.Identity.fromWords(from.words ?? '');
    waiting?.free();
    waiting = id;
    return { key: id.publicKey() };
  },

  /**
   * Keeps the waiting key, hidden where the browser can. In place of
   * another key only when switching: otherwise that key was kept meanwhile,
   * in another tab, and is not thrown away unasked.
   * @param {{ switching?: boolean }} [o]
   */
  async keyKeep({ switching = false } = {}) {
    const id = waitingKey('kept');
    const before = await read();
    if (before && !switching && hex(before.publicKey) !== id.publicKey().hex) {
      throw { code: 'key_exists', message: 'another key was kept meanwhile' };
    }
    const seed = id.seed();
    try {
      const sign = await hide(seed);
      /** @type {Kept} */
      const k = {
        publicKey: fromHex(id.publicKey().hex),
        sign,
        seed: sign ? null : seed.slice(),
        backup: id.backupKey(),
      };
      await run('readwrite', (s) => s.put(k, ID));
      waiting = null;
      id.free();
      return { state: sign ? 'hidden' : 'open', key: core.keyData(k.publicKey) };
    } finally {
      seed.fill(0);
    }
  },

  /** Forgets a key that waits, kept or not. */
  keyDrop() {
    waiting?.free();
    waiting = null;
  },

  /**
   * Whether 24 words are the kept key's: checked, never shown.
   * @param {string} words
   */
  async keyVerify(words) {
    const k = await need();
    const id = core.Identity.fromWords(words);
    try {
      return id.publicKey().hex === hex(k.publicKey);
    } finally {
      id.free();
    }
  },

  /** @param {any} card a card from the editor */
  async signCard(card) {
    const k = await need();
    return signed(k, core.cardToSign(card), (sig) => core.signedCard(card, k.publicKey, sig), (id) => id.signCard(card));
  },

  /** @param {string} nick */
  async recipientCode(nick) {
    return core.recipientCodeOf((await need()).publicKey, nick);
  },

  /**
   * Copy `edition` of `of` of an own card, to a scanned recipient code.
   * @param {Uint8Array} payload @param {number} edition @param {number} of @param {Uint8Array} recipient @param {number} day
   */
  async issue(payload, edition, of, recipient, day) {
    const k = await need();
    return signed(k, core.editionToSign(payload, edition, of, recipient, day, k.publicKey),
      (sig) => core.edition(payload, edition, of, recipient, day, k.publicKey, sig),
      (id) => id.issue(payload, edition, of, recipient, day));
  },

  /** Someone else's card, passed on as `nick`. @param {Uint8Array} payload @param {string} nick */
  async sealAsSender(payload, nick) {
    const k = await need();
    return signed(k, core.senderToSign(payload, nick),
      (sig) => core.sealedBy(payload, nick, k.publicKey, sig),
      (id) => id.sealAsSender(payload, nick));
  },

  /** @param {any} data `{ created, profile, cards }` */
  async sealBackup(data) {
    const k = await need();
    return core.sealBackupWith(data, k.publicKey, k.backup, crypto.getRandomValues(new Uint8Array(24)));
  },

  /** @param {Uint8Array} bytes */
  async openBackup(bytes) {
    const k = await need();
    return core.openBackupWith(bytes, k.publicKey, k.backup);
  },

  /**
   * A backup opened with the waiting key, before it is kept: what restoring
   * shows. @param {Uint8Array} bytes
   */
  openBackupWaiting(bytes) {
    return waitingKey('used').openBackup(bytes);
  },
};
