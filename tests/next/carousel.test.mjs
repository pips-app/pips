// @ts-check
// A carousel put back together in the core's worker
// (web-next/src/core/joiner.js): frames in any order come to the message;
// a frame of another carousel starts over with that one; a worker
// restarted meanwhile starts over too, and says so by its progress.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.mjs';

/** @type {Awaited<ReturnType<typeof setup>>} */
let env;
/** @type {import('playwright').Page} */
let page;
before(async () => {
  env = await setup();
  page = await env.page('__test__/core.html');
  await page.waitForFunction(() => /** @type {any} */ (window).harness);
});
after(() => env.close());

/**
 * Runs `f` in the page with the core at hand, and a carousel of `size`
 * seeded bytes: `frame(seq)` its frame `seq`, as classify reads it.
 * @template T @param {string} f @param {number} size @param {number} [seed] @returns {Promise<T>}
 */
const withCarousel = (f, size, seed = 1) => page.evaluate(async ([src, size, seed]) => {
  const core = /** @type {any} */ (window).core;
  let s = seed;
  const bytes = Uint8Array.from({ length: size }, () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s >>> 24; });
  const frame = async (/** @type {number} */ seq) => (await core.call('classify', await core.call('carouselFrame', bytes, seq))).bytes;
  return (0, eval)(src)(core, bytes, frame);
}, /** @type {const} */ ([f, size, seed]));

test('frames in any order come together to the message, and the joiner is then empty', async () => {
  const r = await withCarousel(`async (core, bytes, frame) => {
    await core.call('joinReset');
    const seen = [];
    for (let seq = 40; ; seq += 3) {
      const p = await core.call('joinFrame', await frame(seq));
      seen.push(p.kind);
      if (p.kind === 'done') return { same: p.bytes.length === bytes.length && p.bytes.every((b, i) => b === bytes[i]), seen: seen.length, first: seen[0], after: (await core.call('joinFrame', await frame(1))).kind };
    }
  }`, 6000);
  assert.equal(r.same, true);
  assert.ok(r.seen > 1, 'more than one frame');
  assert.equal(r.first, 'partial');
  assert.equal(r.after, 'partial', 'a frame after the message starts a new carousel');
});

test('a frame of another carousel starts over with that one', async () => {
  const r = await withCarousel(`async (core, bytes, frame) => {
    await core.call('joinReset');
    await core.call('joinFrame', await frame(0));
    const second = await core.call('joinFrame', await frame(1));
    return second.have;
  }`, 6000);
  assert.equal(r, 2, 'two frames of one carousel');
  const other = await withCarousel(`async (core, bytes, frame) => (await core.call('joinFrame', await frame(5))).have`, 6000, 2);
  assert.equal(other, 1, 'another carousel’s frame: one frame of it, the first carousel let go');
});

test('a worker restarted while a carousel comes together starts it over, and the next frame says so', async () => {
  const r = await withCarousel(`async (core, bytes, frame) => {
    await core.call('joinReset');
    await core.call('joinFrame', await frame(0));
    const before = (await core.call('joinFrame', await frame(1))).have;
    await core.call('hang').catch((e) => e.code);
    const after = await core.call('joinFrame', await frame(2));
    return { before, after: after.have, need: after.need };
  }`, 6000);
  assert.deepEqual([r.before, r.after], [2, 1]);
  assert.ok(r.need > 1);
});
