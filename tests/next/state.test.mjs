// @ts-check
// The new app's state (web-next/src/state.js) in real browsers, on the real
// core: own cards and other people's, numbered copies handed from one
// person to another, backups restored on a new device, the bin emptied in
// time, and a stored card this version cannot read set aside. Each person
// is a browser profile of their own, with their own key.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.mjs';

/** @type {Awaited<ReturnType<typeof setup>>} */
let env;
before(async () => { env = await setup(); });
after(() => env.close());

/** A card as the editor makes one; `title` tells two apart. @param {string} title */
const card = (title) => ({
  width: 8, height: 8, opaque: true, frame: 0, frames: 1, delay_ms: 100, palette: { builtin: 0 },
  title, author: 'kitsu', handle: null, link: '', pixels: Array.from({ length: 64 }, (_, i) => (i + title.length) % 4),
});

/**
 * A person: a browser profile with the state harness and a key of their
 * own (from `words`, or new). `run` evaluates in their page with app,
 * core and store at hand.
 * @param {string} [words]
 */
async function person(words) {
  const p = await env.page('__test__/state.html');
  await p.waitForFunction(() => /** @type {any} */ (window).harness);
  /** @template T @param {(w: any, arg: any) => Promise<T>} f @param {any} [arg] @returns {Promise<T>} */
  const run = (f, arg) => p.evaluate(([src, a]) => (0, eval)(src)(window, a), /** @type {const} */ ([`(${f})`, arg]));
  const made = await run(async (w, words) => {
    const made = words ? await w.core.call('keyRestore', { words }) : await w.core.call('keyNew');
    await w.core.call('keyKeep');
    await w.app.keyChanged();
    return made;
  }, words);
  return { p, run, words: made.words ?? words, hex: made.key.hex };
}

/** Bytes across the page boundary. @param {Uint8Array} b */
const bytes = (b) => [...b];

test('own cards are the person’s; one kept again is a duplicate, and comes back out of the bin', async () => {
  const a = await person();
  const r = await a.run(async (w, c) => {
    const payload = await w.core.call('signCard', c);
    const first = await w.app.addPayload(payload);
    await w.app.move(first.digest, 'trash');
    const again = await w.app.addPayload(payload);
    const e = w.app.cards.get(first.digest);
    return { first: first.status, again: again.status, mine: e.rec.mine, place: e.rec.state, count: w.app.cards.size, pending: w.app.pending.cards.length };
  }, card('Моя'));
  assert.deepEqual(r, { first: 'added', again: 'duplicate', mine: true, place: 'collection', count: 1, pending: 1 });
  await a.p.context().close();
});

test('a numbered copy goes from its author to a holder of the plain card, and takes its place; the run runs out', async () => {
  const author = await person();
  const holder = await person();
  // The author makes a card, and passes the plain one to the holder.
  const plain = await author.run(async (w, c) => {
    const payload = await w.core.call('signCard', c);
    const { digest } = await w.app.addPayload(payload);
    return { digest, envelope: [...await w.core.call('sealOwn', payload, undefined)] };
  }, card('Тираж'));
  const code = await holder.run(async (w, env) => {
    const r = await w.app.receive(await w.core.call('openEnvelope', Uint8Array.from(env)));
    await w.app.setNote(r.digest, 'с ярмарки');
    const c = await w.core.call('classify', await w.core.call('recipientCode', 'mira'));
    return { status: r.status, mine: w.app.cards.get(r.digest).rec.mine, bytes: [...c.bytes], nick: c.nick, key: c.key };
  }, plain.envelope);
  assert.equal(code.status, 'added');
  assert.equal(code.mine, false, 'someone else’s card');

  // The author issues copies of a run of two.
  const issued = await author.run(async (w, { digest, code }) => {
    const to = { bytes: Uint8Array.from(code.bytes), nick: code.nick, key: code.key };
    const one = await w.app.issueEdition(digest, 2, to);
    const two = await w.app.issueEdition(digest, 99, to);
    const three = await w.app.issueEdition(digest, 2, to);
    return { one: [one.edition, one.of], two: [two.edition, two.of], three, envelope: [...one.envelope], log: w.app.cards.get(digest).rec.editions.issued.length, pending: w.app.pending.issued };
  }, { digest: plain.digest, code });
  assert.deepEqual([issued.one, issued.two, issued.three, issued.log, issued.pending], [[1, 2], [2, 2], { code: 'run_out' }, 2, 2]);

  // The holder's plain card becomes the numbered copy, keeping its note.
  const got = await holder.run(async (w, env) => {
    const r = await w.app.receive(await w.core.call('openEnvelope', Uint8Array.from(env)));
    const rec = w.app.cards.get(r.digest).rec;
    return { status: r.status, edition: rec.edition.edition, holder: rec.edition.holder, note: rec.note };
  }, issued.envelope);
  assert.deepEqual(got, { status: 'numbered', edition: 1, holder: holder.hex, note: 'с ярмарки' });
  await author.p.context().close();
  await holder.p.context().close();
});

test('a backup restored on a new device brings every card, the profile and the log, as good as just made', async () => {
  const a = await person();
  const file = await a.run(async (w, c) => {
    await w.app.setProfile({ nick: 'kitsu', handle: null, link: 'kitsu.art' });
    const { digest } = await w.app.addPayload(await w.core.call('signCard', c));
    await w.app.setTags(digest, ['свои', 'свои', 'ярмарка']);
    return [...(await w.app.makeBackup()).bytes];
  }, card('Копия'));
  const b = await person(a.words);
  const r = await b.run(async (w, file) => {
    const opened = await w.core.call('openBackup', Uint8Array.from(file));
    const result = await w.app.applyBackup(opened);
    const again = await w.app.applyBackup(opened);
    const [e] = w.app.cards.values();
    return { result, again, profile: w.app.profile, tags: e.rec.tags, mine: e.rec.mine, pending: w.app.pending };
  }, file);
  assert.deepEqual(r.result, { added: 1, known: 0, profile: true });
  assert.deepEqual(r.again, { added: 0, known: 1, profile: false }, 'restoring again changes nothing');
  assert.deepEqual(r.profile, { nick: 'kitsu', handle: null, link: 'kitsu.art' });
  assert.deepEqual(r.tags, ['свои', 'ярмарка']);
  assert.equal(r.mine, true, 'the same key: still the person’s own');
  assert.deepEqual(r.pending, { cards: [], profile: false, issued: 0 }, 'nothing to back up yet');
  await a.p.context().close();
  await b.p.context().close();
});

test('the bin is emptied in time at the next start; a stored card this version cannot read is set aside and counted', async () => {
  const a = await person();
  const r = await a.run(async (w, c) => {
    const { digest } = await w.app.addPayload(await w.core.call('signCard', c));
    await w.app.move(digest, 'trash');
    await w.store.putCard({ ...w.app.cards.get(digest).rec, digest: 'not a card', payload: new Uint8Array([1, 2, 3]), state: 'collection', trashedAt: null });
    await w.restart(29 * 86_400_000);
    const kept = w.app.cards.size;
    const unreadable = w.app.unreadable;
    await w.restart(31 * 86_400_000);
    return { kept, unreadable, after: w.app.cards.size, stored: (await w.store.allCards()).map((/** @type {any} */ c) => c.digest) };
  }, card('Корзина'));
  assert.deepEqual(r, { kept: 1, unreadable: 1, after: 0, stored: ['not a card'] }, 'the unreadable one stays on disk');
  await a.p.context().close();
});
