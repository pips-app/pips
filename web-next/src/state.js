// @ts-check
// The app's state: the key's state, the profile and the cards. Views read
// it and call its functions; nothing else writes storage, so every change
// goes through one place and every view hears of it. It asks the core (in
// its worker) what a card is, the rules (rules/) what follows, and stores
// that. From web/src/state.js, which did all three in one.

import * as store from './store.js';
import { arrive, expired, isMine, moved, noted, tagged } from './rules/cards.js';
import { EMPTY_LOG, issued, nextIssue } from './rules/editions.js';
import { mergeCards, mergeProfile } from './rules/backup.js';
import { NOTHING, touched } from './rules/pending.js';
import { CLIENT_CODES } from './core/client.js';

/** @typedef {import('./rules/cards.js').CardRecord} CardRecord */
/** @typedef {import('./rules/cards.js').Place} Place */
/** @typedef {import('./rules/backup.js').Profile} Profile */
/** @typedef {import('./rules/pending.js').Pending} Pending */
/** @typedef {{ hex: string, short: string }} KeyData */
/** A card on the device: its record, what the core read of it, its author. @typedef {{ rec: CardRecord, card: any, author: KeyData | null }} Entry */
/** @typedef {{ state: 'none' } | { state: 'hidden' | 'open', key: KeyData }} KeyState */
/** @typedef {{ call(op: string, ...args: unknown[]): Promise<any> }} Core */

const DAY = 86_400_000;
/** Where tabs of the app tell each other that the key changed. */
const CHANNEL = 'pips-next';
/** Issuing copies, one at a time across every tab (issueEdition). */
const ISSUE_LOCK = 'pips-next-issue';
/** A profile no one has filled in. @type {Profile} */
const NO_PROFILE = Object.freeze({ nick: '', handle: null, link: '' });

/**
 * The state of one app, on the core's client and storage already open.
 * `now` is the clock, so that tests can move it.
 * @param {Core} core @param {{ now?: () => number }} [o]
 */
export function createState(core, { now = Date.now } = {}) {
  /** @type {KeyState} */
  let key = { state: 'none' };
  /** @type {Profile} */
  let profile = NO_PROFILE;
  /** @type {Pending} */
  let pending = NOTHING;
  /** @type {Map<string, Entry>} */
  const cards = new Map();
  /** Stored cards this version could not read: kept on disk, not shown, and said. */
  let unreadable = 0;
  /** @type {Set<() => void>} */
  const listeners = new Set();

  const me = () => (key.state === 'none' ? null : key.key.hex);
  const changed = () => { for (const f of listeners) f(); };
  /** In browsers without BroadcastChannel, a tab hears of another's key at its next start. */
  const tabs = globalThis.BroadcastChannel ? new BroadcastChannel(CHANNEL) : null;
  /** Issuing within this tab where the browser has no locks across tabs. */
  let issuing = Promise.resolve();

  /** Notes a change the last backup does not have. @param {Parameters<typeof touched>[1]} what */
  async function touch(what) {
    const next = touched(pending, what);
    if (next === pending) return;
    pending = next;
    await store.setMeta('pending', pending);
  }

  /** Stores a card and keeps what the core read of it. @param {CardRecord} rec @param {{ card: any, author: KeyData | null }} read */
  async function keep(rec, read) {
    await store.putCard(rec);
    cards.set(rec.digest, { rec, card: read.card, author: read.author });
    await touch({ card: rec.digest });
  }

  /**
   * Marks as the person's own exactly the cards their key signed. After
   * the key changes, the old key's cards are a former self's.
   */
  async function reown() {
    for (const e of cards.values()) {
      const mine = isMine(e.author, me());
      if (e.rec.mine === mine) continue;
      e.rec = { ...e.rec, mine };
      await store.putCard(e.rec);
    }
  }

  /**
   * Makes what is stored agree with the key: the cards re-owned, and the
   * last backup and the changes since it dropped if they were another
   * key's. The key they belong to is stored beside them, so a change cut
   * short (a tab closed, storage failing) is finished at the next start.
   */
  async function settleOwner() {
    await reown();
    const owner = (await store.getMeta('owner')) ?? null;
    if (owner === me()) return;
    await store.setMeta('lastBackup', null);
    pending = NOTHING;
    await store.setMeta('pending', pending);
    await store.setMeta('owner', me());
  }

  /** The key as the core has it now, and what follows from it. */
  async function rereadKey() {
    key = await core.call('keyState');
    await settleOwner();
    changed();
  }
  // Another tab kept or switched the key: this one goes on with that key.
  if (tabs) tabs.onmessage = () => { rereadKey().catch(() => {}); };

  /**
   * Keeps an arriving card (rules/cards.js, arrive).
   * @param {Omit<CardRecord, 'digest' | 'mine'>} partial
   * @returns {Promise<{ status: 'added' | 'numbered' | 'duplicate', digest: string }>}
   */
  async function add(partial) {
    const i = await core.call('inspectCard', partial.payload);
    const author = i.author ?? null;
    const got = { ...partial, digest: i.digest, mine: isMine(author, me()) };
    const here = cards.get(i.digest);
    const { status, rec, changed: did } = arrive(here?.rec ?? null, got, me());
    if (did) await keep(rec, status === 'duplicate' && here ? here : { card: i.card, author });
    changed();
    return { status, digest: i.digest };
  }

  /** Changes one card's record by a rule, stores it, and says so. @param {string} digest @param {(rec: CardRecord) => CardRecord} rule */
  async function change(digest, rule) {
    const e = cards.get(digest);
    if (!e) return;
    e.rec = rule(e.rec);
    await store.putCard(e.rec);
    await touch({ card: digest });
    changed();
  }

  /**
   * Runs `f` once no other tab or call is issuing (Web Locks); in a browser
   * without them, one at a time in this tab.
   * @template T @param {() => Promise<T>} f @returns {Promise<T>}
   */
  function oneAtATime(f) {
    if (navigator.locks) return /** @type {Promise<T>} */ (navigator.locks.request(ISSUE_LOCK, f));
    const run = issuing.then(f);
    issuing = run.then(() => {}, () => {});
    return run;
  }

  /** @param {Profile} p */
  async function setProfile(p) {
    profile = p;
    await store.setMeta('profile', p);
    await touch({ profile: true });
    changed();
  }

  return {
    get key() { return key; },
    get profile() { return profile; },
    get pending() { return pending; },
    get unreadable() { return unreadable; },
    /** The cards on the device, by digest. Read only. */
    get cards() { return /** @type {ReadonlyMap<string, Entry>} */ (cards); },

    /** @param {() => void} f @returns {() => void} to stop listening */
    subscribe(f) {
      listeners.add(f);
      return () => { listeners.delete(f); };
    },

    /**
     * Reads everything once, at the start: the key's state from the core,
     * the profile, the cards — dropping binned ones whose time is up, and
     * setting aside, counted, any this version cannot read.
     */
    async load() {
      key = await core.call('keyState');
      profile = (await store.getMeta('profile')) ?? NO_PROFILE;
      pending = (await store.getMeta('pending')) ?? NOTHING;
      unreadable = 0;
      for (const rec of await store.allCards()) {
        if (expired(rec, now())) {
          await store.deleteCard(rec.digest);
          continue;
        }
        try {
          const i = await core.call('inspectCard', rec.payload);
          cards.set(rec.digest, { rec, card: i.card, author: i.author ?? null });
        } catch (e) {
          // Only a card the core refuses is unreadable; a core that failed
          // this once (stopped, not loaded) says nothing about the card, and
          // the start fails with words rather than hide part of the collection.
          if (CLIENT_CODES.includes(/** @type {any} */ (e)?.code)) throw e;
          unreadable++;
        }
      }
      await settleOwner();
      changed();
    },

    /**
     * The key once it has changed (kept, switched), as keyKeep gave it:
     * taken at once, so that a failure in what follows does not hide a key
     * that is kept. Then the cards are re-owned, and with another key the
     * last backup — of the old one — no longer counts; other tabs are told.
     * @param {KeyState} kept
     */
    async keyChanged(kept) {
      key = kept;
      changed();
      tabs?.postMessage('key');
      // Asked, not awaited: Firefox answers only after the person replies.
      store.persist().catch(() => {});
      await settleOwner();
      changed();
    },

    setProfile,

    /** A card from an envelope, opened by the core. @param {any} opened */
    receive(opened) {
      const c = opened.certificate;
      return add({
        payload: opened.payload,
        cert: c?.bytes ?? null,
        edition: c ? { edition: c.edition, of: c.of, holder: c.holder.hex, day: c.issued_day } : null,
        state: 'collection', received: now(), trashedAt: null,
        from: opened.sender ? { nick: opened.sender.nick, key: opened.sender.key.hex } : null,
        note: '', tags: [],
      });
    },

    /** A card from a file or the editor: no envelope, so no sender or certificate. @param {Uint8Array} payload */
    addPayload(payload) {
      return add({ payload, cert: null, edition: null, state: 'collection', received: now(), trashedAt: null, from: null, note: '', tags: [] });
    },

    /** @param {string} digest @param {Place} place */
    move: (digest, place) => change(digest, (r) => moved(r, place, now())),
    /** @param {string} digest @param {string} note */
    setNote: (digest, note) => change(digest, (r) => noted(r, note)),
    /** @param {string} digest @param {string[]} tags already normal */
    setTags: (digest, tags) => change(digest, (r) => tagged(r, tags)),

    /** Deletes a card for good. @param {string} digest */
    async purge(digest) {
      await store.deleteCard(digest);
      cards.delete(digest);
      await touch({ card: digest });
      changed();
    },

    /**
     * Issues the next numbered copy of an own card to a scanned recipient
     * code, and logs it before handing out its envelope: a number is never
     * handed out twice from this device. One copy at a time, across tabs,
     * and the log read from storage inside that: a second tap, or another
     * tab, works from the log the first one wrote.
     * @param {string} digest @param {number} of run size, fixed by the first copy
     * @param {{ bytes: Uint8Array, nick: string, key: KeyData }} recipient
     * @returns {Promise<{ envelope: Uint8Array, edition: number, of: number } | { code: 'run_out' }>}
     */
    issueEdition(digest, of, recipient) {
      return oneAtATime(async () => {
        const e = cards.get(digest);
        if (!e?.rec.mine) throw { code: 'not_author', message: 'not an own card' };
        e.rec = (await store.getCard(digest)) ?? e.rec;
        const log = e.rec.editions ?? EMPTY_LOG;
        const next = nextIssue(log, of);
        if ('code' in next) return next;
        const day = Math.floor(now() / DAY);
        const cert = await core.call('issue', e.rec.payload, next.edition, next.of, recipient.bytes, day);
        const envelope = await core.call('sealOwn', e.rec.payload, cert);
        e.rec = { ...e.rec, editions: issued(log, next, { nick: recipient.nick, holder: recipient.key.hex, day }) };
        await store.putCard(e.rec);
        await touch({ card: digest, issued: 1 });
        changed();
        return { envelope, ...next };
      });
    },

    /**
     * A backup of every card and the profile, sealed by the key: bytes the
     * core made, in a buffer of their own. Cards this version cannot read
     * cannot go in (the core checks every card it seals): `left` says how
     * many, and while there are any, the backup does not count as whole.
     * @returns {Promise<{ bytes: Uint8Array<ArrayBuffer>, count: number, left: number }>}
     */
    async makeBackup() {
      const recs = [...cards.values()].map(({ rec }) => rec);
      const data = { created: now(), profile, cards: recs };
      const bytes = await core.call('sealBackup', data);
      await store.setMeta('lastBackup', { at: data.created, count: recs.length });
      if (!unreadable) {
        pending = NOTHING;
        await store.setMeta('pending', pending);
      }
      changed();
      return { bytes, count: recs.length, left: unreadable };
    },

    /**
     * Adds an opened backup's cards and profile to the device
     * (rules/backup.js). Onto an empty device it is as good as a backup
     * just made.
     * @param {any} b what the core's openBackup gives
     * @returns {Promise<{ added: number, known: number, profile: boolean }>}
     */
    async applyBackup(b) {
      const fresh = cards.size === 0;
      /** @type {Map<string, { card: any, author: KeyData | null }>} */
      const read = new Map();
      const withDigests = [];
      for (const c of b.cards) {
        const i = await core.call('inspectCard', c.payload);
        read.set(i.digest, { card: i.card, author: i.author ?? null });
        withDigests.push({ ...c, digest: i.digest, mine: isMine(i.author ?? null, me()) });
      }
      const here = new Map([...cards].map(([d, e]) => [d, e.rec]));
      const { put, added, known } = mergeCards(here, withDigests, me());
      for (const rec of put) {
        const e = cards.get(rec.digest);
        const r = /** @type {{ card: any, author: KeyData | null }} */ (rec.payload === e?.rec.payload && e ? e : read.get(rec.digest));
        await keep(rec, r);
      }
      const p = mergeProfile(profile, b.profile);
      if (p.took) await setProfile(p.profile);
      if (fresh && !unreadable) {
        await store.setMeta('lastBackup', { at: b.created, count: b.cards.length });
        pending = NOTHING;
        await store.setMeta('pending', pending);
      }
      changed();
      return { added, known, profile: p.took };
    },

    /** When the last backup was made and how many cards it held. @returns {Promise<{ at: number, count: number } | null>} */
    lastBackup: async () => (await store.getMeta('lastBackup')) ?? null,
  };
}
