// @ts-check
// The core's client (web-next/src/core/client.js) in a real browser: a job
// that hangs or crashes the core is stopped, and the next job is done by a
// fresh worker — the page never reloads, never waits forever.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, engineName } from './helpers.mjs';

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
 * Runs `op` in the core from the page: its value, or the code it failed with.
 * @param {string} op @param {...unknown} args
 */
const run = (op, ...args) => page.evaluate(([op, args]) => /** @type {any} */ (window).core.call(op, ...args).then(
  (/** @type {unknown} */ value) => ({ value }),
  (/** @type {any} */ e) => ({ code: e.code, name: e.name }),
), /** @type {const} */ ([op, args]));

const restarts = () => page.evaluate(() => /** @type {any} */ (window).core.restarts);

test('a job is done by the core, and its refusal comes back with the core’s code', async () => {
  const { value } = await run('classify', 'hello');
  assert.ok(value, 'classify answered');
  assert.deepEqual(await run('parseLink', 'https://example.com/'), { code: 'bad_link', name: 'CoreError' });
  assert.equal(await restarts(), 0, 'a refusal is an answer, not a crash');
});

test('a job past its limit is stopped, and the next job runs in a fresh worker', async () => {
  const before = await restarts();
  const hung = run('hang');
  const after = run('errorCodes'); // queued behind the hung job
  assert.deepEqual(await hung, { code: 'core_timeout', name: 'CoreError' });
  const codes = await after;
  assert.ok(Array.isArray(codes.value) && codes.value.includes('bad_signature'), 'the job behind it was done');
  assert.equal(await restarts(), before + 1);
});

test('a panic in the core stops its worker, and the next job runs in a fresh one', async () => {
  const before = await restarts();
  assert.deepEqual(await run('trap'), { code: 'core_crashed', name: 'CoreError' });
  assert.ok((await run('palettes')).value.length > 0, 'the core answers again');
  assert.equal(await restarts(), before + 1);
});

test('a job’s limit counts its own time, not its wait behind another', async () => {
  // Each takes 400 ms; their limit is 2000. Five in a row take 2000 ms
  // together, which would stop the last if the wait counted.
  const all = await Promise.all([1, 2, 3, 4, 5].map(() => run('slow', 400)));
  assert.deepEqual(all, Array(5).fill({ value: 400 }));
});

test('a limit can grow with the job: worked out from its arguments', async () => {
  // A backup's jobs take time in proportion to its size (core/limits.js).
  assert.deepEqual(await run('sized', 600, 3000), { value: 600 });
  assert.deepEqual(await run('sized', 600, 300), { code: 'core_timeout', name: 'CoreError' });
});

test('what is not a job of the core is refused, and the worker stays', async () => {
  const before = await restarts();
  assert.equal((await run('__proto__')).code, 'unknown_op');
  assert.equal((await run('constructor')).code, 'unknown_op');
  assert.equal((await run('mistake')).code, 'internal');
  assert.equal(await restarts(), before);
});

test('arguments that cannot reach the worker fail their job at once, and the next job runs in the same worker', async () => {
  const before = await restarts();
  const [bad, next] = await page.evaluate(() => {
    const core = /** @type {any} */ (window).core;
    const t = performance.now();
    const bad = core.call('palettes', () => 1).then(() => 'done', (/** @type {any} */ e) => e.code);
    const next = core.call('errorCodes').then(() => performance.now() - t);
    return Promise.all([bad, next]);
  });
  assert.equal(bad, 'internal');
  // Well inside the general limit (5000 ms here): it did not wait it out.
  assert.ok(next < 2500, `the next job took ${next} ms`);
  assert.equal(await restarts(), before, 'the worker was not stopped');
});

test('an error in the worker after it started stops it, and the next job runs in a fresh one', async () => {
  const before = await restarts();
  assert.deepEqual(await run('throwLater'), { value: 'thrown later' });
  await page.waitForFunction((n) => /** @type {any} */ (window).core.restarts === n, before + 1);
  assert.ok((await run('palettes')).value.length > 0);
});

test('a core that does not load fails each job with core_unavailable, and is tried again', async () => {
  // How many errors the browser writes for each try: a missing script is
  // said by Firefox and WebKit, not by Chromium.
  const missing = engineName === 'chromium' ? 0 : 1;
  const cases = [
    ['no-core-worker.js', 0],
    ['missing-worker.js', missing],
    // Never says it is ready: given up on after the boot limit.
    ['silent-worker.js', 0],
  ];
  for (const [worker, said] of /** @type {[string, number][]} */ (cases)) {
    const p = await env.page(`__test__/core.html?worker=${worker}`);
    await p.waitForFunction(() => /** @type {any} */ (window).harness);
    const code = () => env.expecting(/missing-worker|Failed to load resource: .*404/, said,
      () => p.evaluate(() => /** @type {any} */ (window).core.call('palettes').then(() => 'done', (/** @type {any} */ e) => e.code)));
    assert.equal(await code(), 'core_unavailable', worker);
    assert.equal(await code(), 'core_unavailable', `${worker}, again`);
    await p.context().close();
  }
});
