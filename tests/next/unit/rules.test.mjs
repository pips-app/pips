// @ts-check
// The rules of web-next/src/rules/ — cards arriving, numbered copies,
// backups restored — checked on examples and on random inputs. Each random
// test runs ROUNDS cases from a seed; a failure names its seed, and
// RULES_SEED=<seed> runs that one case again.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const rules = new URL('../../../web-next/src/rules/', import.meta.url);
const { joinLogs, nextNumber, nextIssue, issued, EMPTY_LOG } = await import(new URL('editions.js', rules).href);
const { arrive, moved, expired, daysLeft, fitBytes, noted, tagged, ownCopyOf, TRASH_DAYS, NOTE_BYTES, MAX_TAGS } = await import(new URL('cards.js', rules).href);
const { mergeCards, mergeProfile } = await import(new URL('backup.js', rules).href);

/** @typedef {import('../../../web-next/src/rules/cards.js').CardRecord} CardRecord */

const ROUNDS = Number(process.env.RULES_ROUNDS ?? 400);
const DAY = 86_400_000;

/** A seeded source of small random choices (an LCG's high bits). @param {number} seed */
function random(seed) {
  let s = seed >>> 0;
  const next = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s >>> 8; };
  return {
    /** 0 ≤ n < max @param {number} max */ int: (max) => next() % max,
    /** @param {number} p */ chance: (p) => next() % 1000 < p * 1000,
    /** @template T @param {T[]} xs @returns {T} */ pick: (xs) => xs[next() % xs.length],
  };
}

/** Runs `check` on ROUNDS seeds, or the one in RULES_SEED; a failure says its seed. @param {(r: ReturnType<typeof random>, seed: number) => void} check */
function forAll(check) {
  const seeds = process.env.RULES_SEED ? [Number(process.env.RULES_SEED)] : Array.from({ length: ROUNDS }, (_, i) => i + 1);
  for (const seed of seeds) {
    try {
      check(random(seed), seed);
    } catch (e) {
      /** @type {Error} */ (e).message = `RULES_SEED=${seed}: ${/** @type {Error} */ (e).message}`;
      throw e;
    }
  }
}

const KEYS = ['me', 'ann', 'bo', 'cy'];

/** A log of copies, numbers 1..9 to a few holders. @param {ReturnType<typeof random>} r */
function log(r) {
  const n = r.int(6);
  return {
    of: r.pick([0, 5, 9]),
    issued: Array.from({ length: n }, () => ({ edition: r.int(9) + 1, nick: r.pick(['a', 'b']), holder: r.pick(KEYS), day: r.int(3) })),
  };
}

/** The copies of a log, by what makes one copy: its number and its holder. @param {{ issued: any[] }} l */
const copies = (l) => new Set(l.issued.map((i) => `${i.edition}:${i.holder}`));

/** A record for one of a few digests, plain or a numbered copy for someone. @param {ReturnType<typeof random>} r @param {string} [digest] @returns {CardRecord} */
function record(r, digest = r.pick(['d1', 'd2', 'd3'])) {
  const numbered = r.chance(0.5);
  const state = r.pick(['collection', 'archive', 'trash']);
  return {
    digest,
    payload: new Uint8Array([r.int(256)]),
    cert: numbered ? new Uint8Array([1]) : null,
    edition: numbered ? { edition: r.int(5) + 1, of: 5, holder: r.pick(KEYS), day: r.int(3) } : null,
    mine: r.chance(0.3),
    state,
    received: r.int(1000),
    // Only a binned card has a time it went in (moved() keeps it so; a backup drops a stray one).
    trashedAt: state === 'trash' ? r.int(1000) : null,
    from: r.chance(0.3) ? { nick: 'x', key: r.pick(KEYS) } : null,
    note: r.chance(0.5) ? r.pick(['', 'заметка', 'note']) : '',
    tags: r.chance(0.5) ? [r.pick(['a', 'b'])] : [],
    ...(r.chance(0.3) ? { editions: log(r) } : {}),
  };
}

// ------------------------------------------------------------ editions --

test('numbered copies: one past the highest, the run fixed by the first, none past its end', () => {
  let l = EMPTY_LOG;
  const got = [];
  for (let i = 0; i < 4; i++) {
    const next = nextIssue(l, 3);
    if ('code' in next) { got.push(next.code); break; }
    got.push(next.edition);
    l = issued(l, next, { nick: 'n', holder: `k${i}`, day: 1 });
  }
  assert.deepEqual(got, [1, 2, 3, 'run_out']);
  // The run asked for later does not change the one fixed.
  assert.deepEqual(nextIssue({ of: 3, issued: [{ edition: 1, nick: '', holder: 'k', day: 1 }] }, 10), { edition: 2, of: 3 });
  // An open run never runs out.
  assert.deepEqual(nextIssue({ of: 0, issued: [{ edition: 900, nick: '', holder: 'k', day: 1 }] }, 0), { edition: 901, of: 0 });
});

test('logs joined: every copy of either kept once, whichever comes first, and no number handed out again', () => {
  forAll((r) => {
    const [a, b, c] = [log(r), log(r), log(r)];
    const ab = joinLogs(a, b);
    assert.deepEqual(copies(ab), new Set([...copies(a), ...copies(b)]), 'all of both');
    assert.deepEqual(copies(joinLogs(b, a)), copies(ab), 'either order');
    assert.deepEqual(copies(joinLogs(joinLogs(a, b), c)), copies(joinLogs(a, joinLogs(b, c))), 'in any grouping');
    assert.deepEqual(copies(joinLogs(ab, ab)), copies(ab), 'joining again adds nothing');
    assert.equal(ab.issued.length, copies(ab).size, 'each copy once');
    assert.ok(ab.issued.every((x, i) => i === 0 || ab.issued[i - 1].edition <= x.edition), 'by number');
    const next = nextNumber(ab);
    assert.ok([...a.issued, ...b.issued].every((x) => x.edition < next), 'the next number is new to both');
    assert.equal(ab.of, a.issued.length ? a.of : b.issued.length ? b.of : 0, 'the run fixed first stays');
  });
});

// --------------------------------------------------------------- cards --

test('a card that arrives is added if new, brought back if put away, and otherwise left as it is', () => {
  forAll((r) => {
    const here = r.chance(0.2) ? null : record(r, 'd');
    const got = record(r, 'd');
    const me = r.pick(['me', null]);
    const { status, rec, changed } = arrive(here, got, me);
    if (!here) return assert.deepEqual([status, rec, changed], ['added', got, true]);
    assert.equal(rec.state, 'collection', 'back in the collection');
    assert.equal(rec.trashedAt, null);
    for (const k of /** @type {const} */ (['note', 'tags', 'received', 'editions', 'digest'])) assert.deepEqual(rec[k], here[k], `keeps its ${k}`);
    if (status === 'numbered') {
      assert.equal(rec.edition?.holder, me, 'the person’s own copy');
      assert.equal(rec.payload, got.payload, 'with the payload its certificate holds for');
    } else {
      assert.equal(status, 'duplicate');
      assert.equal(rec.payload, here.payload, 'the kept card stays');
      assert.equal(rec.edition, here.edition);
    }
    assert.equal(changed, status === 'numbered' || here.state !== 'collection');
  });
});

test('once the person holds their own numbered copy, no later arrival takes its place, in any order', () => {
  forAll((r) => {
    const arrivals = Array.from({ length: 2 + r.int(4) }, () => record(r, 'd'));
    let rec = /** @type {CardRecord | null} */ (null);
    let own = false;
    for (const got of arrivals) {
      const before = rec;
      rec = arrive(rec, got, 'me').rec;
      if (own) assert.equal(rec.edition, /** @type {CardRecord} */ (before).edition, 'it stays');
      own ||= rec.edition?.holder === 'me';
    }
    const anyOwn = arrivals.some((a) => !!a.cert && a.edition?.holder === 'me');
    assert.equal(/** @type {CardRecord} */ (rec).edition?.holder === 'me', anyOwn, 'the own copy is kept if one came');
  });
});

test('a binned card goes after thirty days and counts down from them; nothing else expires', () => {
  const rec = /** @type {CardRecord} */ (record(random(1), 'd'));
  const binned = moved(rec, 'trash', 1000);
  assert.equal(binned.trashedAt, 1000);
  assert.equal(moved(binned, 'archive', 5000).trashedAt, null, 'taken out, it forgets when it went in');
  assert.equal(daysLeft(binned, 1000), TRASH_DAYS);
  assert.equal(daysLeft(binned, 1000 + 29.9 * DAY), 1);
  assert.equal(daysLeft(binned, 1000 + 40 * DAY), 1, 'never fewer than one while it is there');
  assert.equal(expired(binned, 1000 + TRASH_DAYS * DAY), false);
  assert.equal(expired(binned, 1000 + TRASH_DAYS * DAY + 1), true);
  assert.equal(expired(moved(rec, 'archive', 0), 1e15), false);
});

test('a note is cut to whole characters within its bytes; tags are each once, sixteen at most', () => {
  forAll((r) => {
    const chars = ['a', 'ж', '€', '😀', 'é'];
    const s = Array.from({ length: r.int(2000) }, () => r.pick(chars)).join('');
    const max = r.int(60);
    const cut = fitBytes(s, max);
    const bytes = (/** @type {string} */ x) => new TextEncoder().encode(x).length;
    assert.ok(s.startsWith(cut) && bytes(cut) <= max, 'a start that fits');
    const rest = Array.from(s.slice(cut.length));
    if (rest.length) assert.ok(bytes(cut + rest[0]) > max, 'the longest one');
  });
  const rec = record(random(2), 'd');
  assert.ok(new TextEncoder().encode(noted(rec, 'ж'.repeat(3000)).note).length <= NOTE_BYTES);
  const many = Array.from({ length: 40 }, (_, i) => `t${i % 20}`);
  assert.deepEqual(tagged(rec, many).tags, Array.from({ length: MAX_TAGS }, (_, i) => `t${i}`));
});

// -------------------------------------------------------------- backup --

test('a backup restored loses nothing on the device, and restoring it again changes nothing', () => {
  forAll((r) => {
    const here = new Map();
    for (let i = 0; i < r.int(4); i++) { const c = record(r); here.set(c.digest, c); }
    const cards = Array.from({ length: r.int(5) }, () => record(r));
    const me = r.pick(['me', null]);
    const { put, added, known } = mergeCards(here, cards, me);
    const after = new Map(here);
    for (const c of put) after.set(c.digest, c);

    const digests = new Set(cards.map((c) => c.digest));
    assert.equal(added + known, digests.size, 'each card of the backup counted once');
    assert.equal(added, [...digests].filter((d) => !here.has(d)).length);
    for (const [d, was] of here) {
      const now = after.get(d);
      assert.equal(now.state, was.state, 'its place stays');
      if (was.note) assert.equal(now.note, was.note, 'a note stays');
      if (was.tags.length) assert.deepEqual(now.tags, was.tags, 'tags stay');
      for (const c of copies(was.editions ?? EMPTY_LOG)) assert.ok(copies(now.editions ?? EMPTY_LOG).has(c), 'no copy forgotten');
      if (was.edition?.holder === me && me) assert.deepEqual(now.edition, was.edition, 'an own numbered copy stays');
    }
    for (const c of cards) if (ownCopyOf({ edition: null }, c, me)) assert.equal(after.get(c.digest).edition?.holder, me, 'an own numbered copy is taken');
    assert.deepEqual(mergeCards(after, cards, me).put, [], 'again: nothing to change');
  });
});

test('a backup’s profile fills only what is empty', () => {
  const file = { nick: 'kitsu', handle: { network: 'x', text: 'k' }, link: 'k.art' };
  assert.deepEqual(mergeProfile({ nick: '', handle: null, link: '' }, file), { profile: file, took: true });
  const mine = { nick: 'me', handle: null, link: 'me.art' };
  assert.deepEqual(mergeProfile(mine, file), { profile: { ...mine, handle: file.handle }, took: true });
  const full = { nick: 'me', handle: { network: 'y', text: 'm' }, link: 'me.art' };
  assert.deepEqual(mergeProfile(full, file), { profile: full, took: false });
});

test('found by the random tests: a card held twice in a backup counts once; a log listing a copy twice hides no new one', () => {
  const card = (/** @type {Partial<CardRecord>} */ more) => /** @type {CardRecord} */ ({
    digest: 'd', payload: new Uint8Array([1]), cert: null, edition: null, mine: true, state: 'collection',
    received: 1, trashedAt: null, from: null, note: '', tags: [], ...more,
  });
  const issue = (/** @type {number} */ edition, /** @type {string} */ holder, day = 1) => ({ edition, nick: '', holder, day });
  assert.deepEqual([mergeCards(new Map([['d', card({})]]), [card({}), card({})], 'me')].map((m) => [m.added, m.known]), [[0, 1]]);
  assert.deepEqual([mergeCards(new Map(), [card({}), card({})], 'me')].map((m) => [m.added, m.known]), [[1, 0]]);

  const twice = card({ editions: { of: 0, issued: [issue(8, 'me', 1), issue(8, 'me', 2), issue(9, 'bo')] } });
  const { put } = mergeCards(new Map([['d', twice]]), [card({ editions: { of: 0, issued: [issue(1, 'cy')] } })], 'me');
  assert.ok(put[0]?.editions?.issued.some((i) => i.edition === 1 && i.holder === 'cy'), 'the new copy is kept');
});

test('changes since the last backup: each card counted once, the profile once, every copy issued', async () => {
  const { touched, NOTHING } = await import(new URL('pending.js', rules).href);
  let p = NOTHING;
  for (const w of [{ card: 'a' }, { card: 'a' }, { card: 'b' }, { profile: true }, { profile: true }, { issued: 1 }, { card: 'a', issued: 1 }]) p = touched(p, w);
  assert.deepEqual(p, { cards: ['a', 'b'], profile: true, issued: 2 });
  assert.equal(touched(p, { card: 'b' }), p, 'nothing new: the same object, nothing to write');
  assert.equal(touched(p, {}), p);
});
