// @ts-check
// The app's journal (see journal.js), wired in: it hears every error the
// page does not catch from the first moment, keeps its entries in storage
// once storage is open, and writes the report a person can send.

import { createJournal, report } from './journal.js';
import { VERSION } from './version.js';
import * as store from './store.js';

const KEY = 'journal';
const SAVE_MS = 800;

let ready = false;
let timer = 0;
/** Where in the app things happen: the shell says, once it is up. */
let whereNow = () => '';

export const journal = createJournal({
  where: () => whereNow(),
  origin: location.origin,
  save: (entries) => {
    if (!ready) return; // before storage opens: kept in memory, saved once it does
    clearTimeout(timer);
    timer = window.setTimeout(() => store.setMeta(KEY, entries).catch(() => {}), SAVE_MS);
  },
});

/** @type {Set<(e: unknown) => void>} */
const uncaught = new Set();

/** Listens from now on: errors and rejections nobody caught. Call first. */
export function install() {
  addEventListener('error', (e) => {
    // A resource that failed to load has no error object and no message worth keeping.
    if (!(e instanceof ErrorEvent)) return;
    const err = e.error ?? Object.assign(new Error(e.message), { stack: `${e.filename}:${e.lineno}:${e.colno}` });
    journal.error(err);
    for (const fn of uncaught) fn(err);
  });
  addEventListener('unhandledrejection', (e) => {
    journal.error(e.reason);
    for (const fn of uncaught) fn(e.reason);
  });
}

/** Storage is open: what earlier starts wrote comes back, and this start's entries are kept. */
export async function attach() {
  try {
    journal.restore(await store.getMeta(KEY));
  } catch { /* an unreadable journal is no reason not to start */ }
  ready = true;
  if (journal.entries.length) store.setMeta(KEY, journal.entries).catch(() => {});
}

/** @param {() => string} fn the part of the app on screen */
export function locate(fn) { whereNow = fn; }

/** @param {(e: unknown) => void} fn called for each error nobody caught */
export function onUncaught(fn) { uncaught.add(fn); }

/**
 * The report: the app, the device, then the entries. Counts of cards, not
 * the cards. @param {{cards: number, own: number, stub: boolean, language: string}} app
 */
export async function fullReport(app) {
  const persisted = store.memoryOnly ? 'memory only' : (await store.isPersisted()) ? 'persisted' : 'may be cleared';
  const pointer = matchMedia('(pointer: coarse)').matches ? 'touch' : 'mouse';
  return report(journal.entries, [
    ['version', VERSION],
    ['made', new Date().toISOString()],
    ['browser', navigator.userAgent],
    ['screen', `${innerWidth}×${innerHeight} @${devicePixelRatio}, ${pointer}`],
    ['language', app.language],
    ['storage', persisted],
    ['core', app.stub ? 'dev stub' : 'wasm'],
    ['cards', `${app.cards} (own ${app.own})`],
  ]);
}

/**
 * A failure the app caught. The core's errors carry a `code` and are
 * outcomes the screen explains (a damaged code, a wrong file); anything
 * else is a fault in the app, and goes in the journal.
 * @param {unknown} e @param {string} [where]
 */
export function caught(e, where) {
  if (typeof (/** @type {any} */ (e))?.code !== 'string') journal.error(e, where);
}
