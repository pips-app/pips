// @ts-check
// The person's key in the core's worker (web-next/src/core/keys.js): made,
// checked, kept hidden from the page, restored, used to sign — and the
// same bytes where the browser cannot hide it. Each test is a fresh
// browser profile, so a key kept in one is not in another.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.mjs';

/** @type {Awaited<ReturnType<typeof setup>>} */
let env;
before(async () => { env = await setup(); });
after(() => env.close());

/** A small card as the editor makes one. */
const CARD = {
  width: 8, height: 8, opaque: true, frame: 0, frames: 1, delay_ms: 100, palette: { builtin: 0 },
  title: 'Ключ', author: 'kitsu', handle: null, link: '', pixels: Array.from({ length: 64 }, (_, i) => i % 4),
};

/** A page with the core's worker (`worker`: another from the harness), and a way to call it. @param {string} [worker] */
async function core(worker) {
  const p = await env.page(`__test__/core.html${worker ? `?worker=${worker}` : ''}`);
  await p.waitForFunction(() => /** @type {any} */ (window).harness);
  /** Its value, or the code it failed with. @param {string} op @param {...unknown} args */
  const run = (op, ...args) => p.evaluate(([op, args]) => /** @type {any} */ (window).core.call(op, ...args).then(
    (/** @type {unknown} */ value) => ({ value }), (/** @type {any} */ e) => ({ code: e.code })), /** @type {const} */ ([op, args]));
  /** Its value; fails the test if it fails. @param {string} op @param {...unknown} args */
  const value = async (op, ...args) => {
    const r = /** @type {any} */ (await run(op, ...args));
    assert.ok(!('code' in r), `${op} failed: ${r.code}`);
    return r.value;
  };
  return { p, run, value };
}

test('a new key: its words checked, then kept hidden; it signs, and the page cannot copy it', async () => {
  const { p, run, value } = await core();
  assert.deepEqual(await value('keyState'), { state: 'none' });
  const made = await value('keyNew');
  const words = made.words.split(' ');
  assert.equal(words.length, 24);
  assert.match(made.paper, /^PIPS:KEY:1:/);
  assert.deepEqual(await value('keyCheckWords', [{ n: 4, word: words[3] }, { n: 13, word: ` ${words[12].toUpperCase()} ` }, { n: 21, word: words[21] }]),
    [true, true, words[20] === words[21]], 'a word from the wrong place is wrong');
  assert.equal((await run('signCard', CARD)).code, 'no_key', 'nothing is kept before keep');
  assert.deepEqual(await value('keyKeep'), { state: 'hidden', key: made.key });

  const payload = await value('signCard', CARD);
  assert.equal((await value('inspectCard', payload)).author.hex, made.key.hex, 'signed by the key');
  const backup = await value('sealBackup', { created: 1, profile: { nick: 'kitsu', handle: null, link: '' }, cards: [] });
  assert.equal((await value('openBackup', backup)).profile.nick, 'kitsu');

  // What the browser stores is a key that signs and cannot be exported, and no secret beside it.
  const stored = await p.evaluate(async () => {
    const db = await new Promise((ok, no) => { const r = indexedDB.open('pips-next-key'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
    const rec = await new Promise((ok) => { const r = /** @type {IDBDatabase} */ (db).transaction('key').objectStore('key').get('identity'); r.onsuccess = () => ok(r.result); });
    let exported = 'refused';
    try { await crypto.subtle.exportKey('pkcs8', rec.sign); exported = 'EXPORTED'; } catch { /* the point */ }
    return { extractable: rec.sign.extractable, seed: rec.seed, exported };
  });
  assert.deepEqual(stored, { extractable: false, seed: null, exported: 'refused' });

  // After a reload, the same key, signing the same bytes.
  await p.reload();
  await p.waitForFunction(() => /** @type {any} */ (window).harness);
  assert.deepEqual(await value('keyState'), { state: 'hidden', key: made.key });
  assert.deepEqual(await value('signCard', CARD), payload, 'Ed25519 signs the same bytes each time');
  assert.equal(await value('keyVerify', made.words), true, 'its words');
  const other = (await value('keyNew')).words;
  await value('keyDrop');
  assert.equal(await value('keyVerify', other), false, 'another key’s words');
  assert.equal((await run('keyCheckWords', [{ n: 1, word: words[0] }])).code, 'key_lost', 'nothing waits once kept or dropped');
  await p.context().close();
});

test('a key restored from its words or its paper key is the same key, and signs the same', async () => {
  const first = await core();
  const made = await first.value('keyNew');
  await first.value('keyKeep');
  const payload = await first.value('signCard', CARD);
  await first.p.context().close();

  for (const from of [{ words: made.words }, { paper: made.paper }]) {
    const again = await core();
    assert.deepEqual(await again.value('keyRestore', from), { key: made.key });
    assert.deepEqual(await again.value('keyKeep'), { state: 'hidden', key: made.key });
    assert.deepEqual(await again.value('signCard', CARD), payload);
    await again.p.context().close();
  }
  const wrong = await core();
  assert.equal((await wrong.run('keyRestore', { words: made.words.split(' ').reverse().join(' ') })).code, 'bad_words');
  await wrong.p.context().close();
});

test('where the browser cannot hide a key, it is kept as before, and every signature is the same', async () => {
  const hidden = await core();
  const made = await hidden.value('keyNew');
  await hidden.value('keyKeep');
  const sign = async (/** @type {(op: string, ...a: unknown[]) => Promise<any>} */ value) => {
    const payload = await value('signCard', CARD);
    const theirs = await value('recipientCode', 'dapple');
    return { payload, theirs, passed: await value('sealAsSender', payload, 'kitsu') };
  };
  const want = await sign(hidden.value);
  await hidden.p.context().close();

  const open = await core('no-ed25519-worker.js');
  await open.value('keyRestore', { words: made.words });
  assert.deepEqual(await open.value('keyKeep'), { state: 'open', key: made.key });
  assert.deepEqual(await open.value('keyState'), { state: 'open', key: made.key });
  assert.deepEqual(await sign(open.value), want);
  await open.p.context().close();
});

test('a key waiting to be kept is lost with a restarted worker, and the page is told', async () => {
  const { p, run, value } = await core();
  await value('keyNew');
  assert.equal((await run('hang')).code, 'core_timeout');
  assert.equal((await run('keyKeep')).code, 'key_lost');
  assert.deepEqual(await value('keyState'), { state: 'none' });
  await p.context().close();
});
