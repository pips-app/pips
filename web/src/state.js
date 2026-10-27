// @ts-check
// Application state: the core, the identity, the profile and the cards.
// Views read from here and call these functions; nothing else touches the
// store, so every change goes through one place and every view hears of it.

import * as store from './store.js';
import { fitBytes } from './dom.js';
import { joinLogs, nextNumber } from './editions.js';

/** @typedef {import('./store.js').CardRecord} CardRecord */
/** @typedef {{nick: string, handle: {network: string, text: string}|null, link: string}} Profile */
/** @typedef {{rec: CardRecord, card: any, author: {hex: string, short: string}|null}} Entry */

const TRASH_DAYS = 30;
/** Longest note, in bytes of UTF-8: pips-store's MAX_NOTE. */
export const NOTE_BYTES = 4000;
const DAY = 86_400_000;

export const app = {
  /** @type {any} */ core: null,
  stub: false,
  /** @type {any} */ identity: null,
  /** @type {Profile} */ profile: { nick: '', handle: null, link: '' },
  /** @type {Map<string, Entry>} */ cards: new Map(),
  /** What changed since the last backup. @type {Pending} */ pending: { cards: [], profile: false, issued: 0 },
};

/** @typedef {{cards: string[], profile: boolean, issued: number}} Pending
 * cards: digests changed (added, moved, noted, removed); issued: numbered copies handed out */

/** @type {Set<() => void>} */
const listeners = new Set();
/** @param {() => void} fn */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function changed() {
  for (const fn of listeners) fn();
}

/** @param {any} core @param {boolean} stub */
export async function load(core, stub) {
  app.core = core;
  app.stub = stub;
  await store.open(stub ? 'pips-dev-stub' : 'pips');
  const seed = await store.getMeta('seed');
  if (seed) app.identity = core.Identity.fromSeed(seed);
  app.profile = (await store.getMeta('profile')) ?? app.profile;
  app.pending = (await store.getMeta('pending')) ?? app.pending;

  const now = Date.now();
  for (const rec of await store.allCards()) {
    if (rec.state === 'trash' && rec.trashedAt && now - rec.trashedAt > TRASH_DAYS * DAY) {
      await store.deleteCard(rec.digest);
      continue;
    }
    try {
      const i = core.inspectCard(rec.payload);
      app.cards.set(rec.digest, { rec, card: i.card, author: i.author ?? null });
    } catch (e) {
      // A stored card that no longer checks out is kept on disk but not shown.
      console.warn('pips: stored card failed inspection', rec.digest, e);
    }
  }
  if (app.identity) await reown();
}

/** Whether a card is the person's own: signed by their key. @param {{hex: string}|null} author */
const isMine = (author) => !!author && author.hex === app.identity?.publicKey().hex;

/**
 * Marks as their own exactly the cards their key signed — after the key
 * changes, the old key's cards are someone else's (a former self's) and
 * can no longer be issued from here.
 */
async function reown() {
  for (const e of app.cards.values()) {
    const mine = isMine(e.author);
    if (e.rec.mine === mine) continue;
    e.rec = { ...e.rec, mine };
    await store.putCard(e.rec);
  }
}

/**
 * Notes a change the last backup does not have. Typing a note is many
 * calls for one card, so cards are counted, not calls.
 * @param {{card?: string, profile?: boolean, issued?: number}} what
 */
async function touch(what) {
  const p = app.pending;
  const fresh = (what.card && !p.cards.includes(what.card)) || (what.profile && !p.profile) || what.issued;
  if (!fresh) return;
  app.pending = {
    cards: what.card && !p.cards.includes(what.card) ? [...p.cards, what.card] : p.cards,
    profile: p.profile || !!what.profile,
    issued: p.issued + (what.issued ?? 0),
  };
  await store.setMeta('pending', app.pending);
}

export const hasIdentity = () => app.identity != null;

/** @param {any} identity */
export async function setIdentity(identity) {
  const before = app.identity?.publicKey().hex;
  await store.setMeta('seed', identity.seed());
  app.identity = identity;
  if (before && before !== identity.publicKey().hex) {
    // Another key: its cards are now the own ones, and the last backup —
    // of the old key — no longer opens here.
    await reown();
    await store.setMeta('lastBackup', null);
    app.pending = { cards: [], profile: false, issued: 0 };
    await store.setMeta('pending', app.pending);
  }
  // Asked, not awaited: Firefox answers only after the person replies to its
  // prompt, and the app must not wait on that to start.
  store.persist().catch(() => {});
  changed();
}

/** @param {Profile} profile */
export async function setProfile(profile) {
  app.profile = profile;
  await store.setMeta('profile', profile);
  await touch({ profile: true });
  changed();
}

/** Received cards in the collection, newest first. */
export function collection() {
  return [...app.cards.values()].filter((e) => !e.rec.mine && e.rec.state === 'collection').sort((a, b) => b.rec.received - a.rec.received);
}

/** The user's own cards that are not archived, newest first. */
export function mine() {
  return [...app.cards.values()].filter((e) => e.rec.mine && e.rec.state === 'collection').sort((a, b) => b.rec.received - a.rec.received);
}

/** Cards in the archive or bin, own and received alike. @param {'archive'|'trash'} state */
export function pile(state) {
  return [...app.cards.values()].filter((e) => e.rec.state === state).sort((a, b) => (b.rec.trashedAt ?? b.rec.received) - (a.rec.trashedAt ?? a.rec.received));
}

/** Days left before a binned card goes for good. @param {CardRecord} rec */
export const daysLeft = (rec) => Math.max(1, TRASH_DAYS - Math.floor((Date.now() - (rec.trashedAt ?? Date.now())) / DAY));

/** @param {Omit<CardRecord, 'digest'>} partial @returns {Promise<{status: 'added'|'duplicate', digest: string}>} */
async function add(partial) {
  const i = app.core.inspectCard(partial.payload);
  const existing = app.cards.get(i.digest);
  if (existing) {
    if (existing.rec.state !== 'collection') await move(i.digest, 'collection');
    return { status: 'duplicate', digest: i.digest };
  }
  const rec = { ...partial, digest: i.digest };
  await store.putCard(rec);
  app.cards.set(i.digest, { rec, card: i.card, author: i.author ?? null });
  await touch({ card: i.digest });
  changed();
  return { status: 'added', digest: i.digest };
}

/** Saves a card received in an envelope (already verified by openEnvelope). @param {any} opened */
export function receive(opened) {
  return add({
    payload: opened.payload,
    cert: opened.certificate?.bytes ?? null,
    edition: opened.certificate
      ? { edition: opened.certificate.edition, of: opened.certificate.of, holder: opened.certificate.holder.hex, day: opened.certificate.issued_day }
      : null,
    mine: isMine(opened.author),
    state: 'collection',
    received: Date.now(),
    trashedAt: null,
    from: opened.sender ? { nick: opened.sender.nick, key: opened.sender.key.hex } : null,
    note: '',
  });
}

/** Saves a card the user signed. @param {Uint8Array} payload */
export function addOwn(payload) {
  return add({ payload, cert: null, edition: null, mine: true, state: 'collection', received: Date.now(), trashedAt: null, from: null, note: '' });
}

/** @param {string} digest @param {'collection'|'archive'|'trash'} state */
export async function move(digest, state) {
  const e = app.cards.get(digest);
  if (!e) return;
  e.rec = { ...e.rec, state, trashedAt: state === 'trash' ? Date.now() : null };
  await store.putCard(e.rec);
  await touch({ card: digest });
  changed();
}

/** @param {string} digest */
export async function purge(digest) {
  await store.deleteCard(digest);
  app.cards.delete(digest);
  await touch({ card: digest });
  changed();
}

/** The person's tags on a card, already normal (see collection/query.js).
 * @param {string} digest @param {string[]} tags */
export async function setTags(digest, tags) {
  const e = app.cards.get(digest);
  if (!e) return;
  e.rec = { ...e.rec, tags: [...new Set(tags)].slice(0, 16) };
  await store.putCard(e.rec);
  await touch({ card: digest });
  changed();
}

/** @param {string} digest @param {string} note */
export async function setNote(digest, note) {
  const e = app.cards.get(digest);
  if (!e) return;
  e.rec = { ...e.rec, note: fitBytes(note, NOTE_BYTES) };
  await store.putCard(e.rec);
  await touch({ card: digest });
}

// -------------------------------------------------------------- editions --

/** @typedef {import('./editions.js').EditionLog} EditionLog */

/** What the author has issued of a card. Kept beside the card, since only
 * the author's own device can count. @param {string} digest @returns {EditionLog} */
export function editionLog(digest) {
  return app.cards.get(digest)?.rec.editions ?? { of: 0, issued: [] };
}

/**
 * Issues the next copy of an own card to a scanned recipient code and
 * records it. The number and the run size are fixed here, from the log, so
 * a copy number is never handed out twice from this device; a backup keeps
 * the log for the next one (see editions.js).
 * @param {string} digest @param {number} of run size, 0 for open; fixed by the first copy
 * @param {{bytes: Uint8Array, nick: string, key: {hex: string}}} recipient
 * @returns {Promise<{envelope: Uint8Array, edition: number, of: number}>}
 */
export async function issueEdition(digest, of, recipient) {
  const e = app.cards.get(digest);
  if (!e?.rec.mine) throw new Error('not an own card');
  const log = editionLog(digest);
  const run = log.issued.length ? log.of : of;
  const edition = nextNumber(log);
  if (run && edition > run) throw { code: 'run_out' };
  const day = Math.floor(Date.now() / DAY);
  const cert = app.identity.issue(e.rec.payload, edition, run, recipient.bytes, day);
  const envelope = app.identity.sealAsAuthor(e.rec.payload, cert);
  e.rec = { ...e.rec, editions: { of: run, issued: [...log.issued, { edition, nick: recipient.nick, holder: recipient.key.hex, day }] } };
  await store.putCard(e.rec);
  await touch({ card: digest, issued: 1 });
  changed();
  return { envelope, edition, of: run };
}

// ---------------------------------------------------------------- backup --

/** A file with every card and the profile, encrypted to this identity.
 * @returns {Promise<{bytes: Uint8Array, count: number}>} */
export async function makeBackup() {
  const cards = [...app.cards.values()].map(({ rec }) => rec);
  const data = { created: Date.now(), profile: app.profile, cards };
  const bytes = app.identity.sealBackup(data, crypto.getRandomValues(new Uint8Array(24)));
  await store.setMeta('lastBackup', { at: data.created, count: cards.length });
  app.pending = { cards: [], profile: false, issued: 0 };
  await store.setMeta('pending', app.pending);
  return { bytes, count: cards.length };
}

/** When the last backup was made and how many cards it held. @returns {Promise<{at: number, count: number}|null>} */
export const lastBackup = async () => (await store.getMeta('lastBackup')) ?? null;

/**
 * Adds a backup's cards to this device; see `applyBackup`.
 * @param {Uint8Array} bytes
 */
export const restoreBackup = (bytes) => applyBackup(app.identity.openBackup(bytes)); // throws unless every card and certificate checks out

/**
 * Adds an opened backup's cards to this device. Nothing here is
 * overwritten: a card already on the device keeps its place, its note and
 * its tags, gaining the backup's only where it has none; issue logs are
 * joined, so no copy number is lost. The profile fills only the fields
 * this device has empty. Opened apart, so that a first run can check the
 * file before it stores the key.
 * @param {any} b what `Identity.openBackup` gives
 * @returns {Promise<{added: number, known: number, profile: boolean}>}
 */
export async function applyBackup(b) {
  // Restored onto nothing, the device now holds exactly the file: it is
  // as good as a backup just made. Onto other cards, it is a change.
  const fresh = app.cards.size === 0;
  let added = 0, known = 0;
  for (const c of b.cards) {
    const i = app.core.inspectCard(c.payload);
    const here = app.cards.get(i.digest);
    if (here) {
      known++;
      const r = here.rec;
      const note = r.note || c.note || '';
      const tags = r.tags?.length ? r.tags : c.tags ?? [];
      const editions = r.editions || c.editions ? joinLogs(r.editions, c.editions) : undefined;
      const more = (editions?.issued.length ?? 0) > (r.editions?.issued.length ?? 0);
      if (note !== r.note || tags !== r.tags || more) {
        here.rec = { ...r, note, tags, ...(editions ? { editions } : {}) };
        await store.putCard(here.rec);
        await touch({ card: i.digest });
      }
      continue;
    }
    const rec = {
      digest: i.digest, payload: c.payload, cert: c.cert ?? null, edition: c.edition ?? null, mine: isMine(i.author ?? null),
      state: c.state, received: c.received, trashedAt: c.trashedAt ?? null, from: c.from ?? null, note: c.note, tags: c.tags ?? [],
      ...(c.editions ? { editions: c.editions } : {}),
    };
    await store.putCard(rec);
    app.cards.set(i.digest, { rec, card: i.card, author: i.author ?? null });
    await touch({ card: i.digest });
    added++;
  }
  const p = app.profile, f = b.profile;
  const profile = {
    nick: p.nick || f.nick || '',
    handle: p.handle ?? f.handle ?? null,
    link: p.link || f.link || '',
  };
  const took = profile.nick !== p.nick || profile.handle !== p.handle || profile.link !== p.link;
  if (took) await setProfile(profile);
  if (fresh) {
    await store.setMeta('lastBackup', { at: b.created, count: b.cards.length });
    app.pending = { cards: [], profile: false, issued: 0 };
    await store.setMeta('pending', app.pending);
  }
  changed();
  return { added, known, profile: took };
}

/** Saves a card from a `.pips` file (no envelope, so no sender or certificate). @param {Uint8Array} payload */
export function receivePayload(payload) {
  const i = app.core.inspectCard(payload);
  return add({
    payload, cert: null, edition: null, mine: isMine(i.author ?? null),
    state: 'collection', received: Date.now(), trashedAt: null, from: null, note: '',
  });
}

/** Development only: pretend a card arrived earlier. @param {string} digest @param {number} ms */
export async function backdate(digest, ms) {
  const e = app.cards.get(digest);
  if (!e) return;
  e.rec = { ...e.rec, received: ms };
  await store.putCard(e.rec);
}
