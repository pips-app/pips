// @ts-check
// The new app's storage (web-next/src/store.js) in real browsers: cards and
// settings kept and read back; a connection the browser closes underneath
// is opened again with nothing failing; data from a newer app refused, not
// hidden behind an empty app; a newer tab taking the data over is said; a
// browser without storage keeps the session in memory.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.mjs';

/** @type {Awaited<ReturnType<typeof setup>>} */
let env;
before(async () => { env = await setup(); });
after(() => env.close());

/** A page with the storage module. @param {string} [query] */
async function page(query = '') {
  const p = await env.page(`__test__/store.html${query}`);
  await p.waitForFunction(() => /** @type {any} */ (window).harness);
  return p;
}

const CARD = { digest: 'd1', payload: [1, 2, 3], cert: null, edition: null, mine: true, state: 'collection', received: 5, trashedAt: null, from: null, note: 'с ярмарки', tags: ['свои'] };

test('cards and settings are kept, read back after a reload, and deleted', async () => {
  const p = await page();
  await p.evaluate(async (c) => {
    const s = /** @type {any} */ (window).store;
    await s.putCard({ ...c, payload: Uint8Array.from(c.payload) });
    await s.putCard({ ...c, digest: 'd2', note: '' });
    await s.setMeta('profile', { nick: 'kitsu', handle: null, link: '' });
  }, CARD);
  await p.reload();
  await p.waitForFunction(() => /** @type {any} */ (window).harness);
  const back = await p.evaluate(async () => {
    const s = /** @type {any} */ (window).store;
    const cards = await s.allCards();
    await s.deleteCard('d2');
    return { cards: cards.map((/** @type {any} */ c) => ({ ...c, payload: [...c.payload] })), profile: await s.getMeta('profile'), left: (await s.allCards()).length, memory: s.memoryOnly };
  });
  assert.deepEqual(back.cards.find((/** @type {any} */ c) => c.digest === 'd1'), CARD, 'the bytes and every field as they were');
  assert.deepEqual(back.profile, { nick: 'kitsu', handle: null, link: '' });
  assert.equal(back.left, 1);
  assert.equal(back.memory, false);
  await p.context().close();
});

test('a connection the browser closes underneath is opened again, and nothing fails', async () => {
  const p = await page();
  const r = await p.evaluate(async () => {
    const s = /** @type {any} */ (window).store;
    await s.setMeta('n', 1);
    // Found as the store next starts a transaction, then closed as a browser
    // closes one on its own (Firefox on Android does): with its close event.
    const proto = IDBDatabase.prototype, open = proto.transaction;
    /** @type {IDBDatabase | null} */
    let found = null;
    proto.transaction = function (...a) { found ??= this; return open.apply(this, a); };
    await s.getMeta('n');
    proto.transaction = open;
    found?.close();
    found?.dispatchEvent(new Event('close'));
    await s.setMeta('n', 2);
    return s.getMeta('n');
  });
  assert.equal(r, 2);
  await p.context().close();
});

test('data from a newer app is refused with newer_data, not shown as an empty app', async () => {
  const p = await page('?wait');
  const code = await p.evaluate(async () => {
    await new Promise((ok) => { const r = indexedDB.open('pips-next-newer', 99); r.onsuccess = () => { r.result.close(); ok(undefined); }; });
    try { await /** @type {any} */ (window).store.open('pips-next-newer'); return 'opened'; } catch (e) { return /** @type {any} */ (e).code; }
  });
  assert.equal(code, 'newer_data');
  await p.context().close();
});

test('a newer app opening the data in another tab is told, and this one stops using it', async () => {
  const p = await page();
  const r = await p.evaluate(async () => {
    const w = /** @type {any} */ (window);
    await w.store.setMeta('n', 1);
    // Another tab, with a newer layout, opens the same data.
    await new Promise((ok) => { const r = indexedDB.open('pips-next-test', 2); r.onsuccess = () => { r.result.close(); ok(undefined); }; });
    try { await w.store.getMeta('n'); return { replaced: w.replaced, code: 'none' }; } catch (e) { return { replaced: w.replaced, code: /** @type {any} */ (e).code }; }
  });
  assert.deepEqual(r, { replaced: 1, code: 'store_replaced' });
  await p.context().close();
});

test('a browser without storage keeps this session in memory, and says so', async () => {
  const p = await page('?wait');
  const r = await p.evaluate(async () => {
    const w = /** @type {any} */ (window);
    Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true });
    await w.store.open('pips-next-nowhere');
    await w.store.setMeta('n', 3);
    return { memory: w.store.memoryOnly, n: await w.store.getMeta('n') };
  });
  assert.deepEqual(r, { memory: true, n: 3 });
  await p.context().close();
});
