// @ts-check
// The new app's page: it starts, its core answers from the worker, and the
// page's policies hold — only the app's own scripts run, and only the
// policy in src/trust.js can name a script.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.mjs';

/** @type {Awaited<ReturnType<typeof setup>>} */
let env;
/** @type {import('playwright').Page} */
let page;

before(async () => {
  env = await setup();
  page = await env.page();
});
after(() => env.close());

test('the app starts, and its core answers from the worker: the first run asks for a key', async () => {
  // The first run is shown once the core in its worker has said there is no key.
  await page.getByRole('button', { name: 'Создать ключ' }).waitFor();
  assert.equal(await page.getByRole('heading', { name: 'Pips' }).count(), 1);
});

test('a script URL not made by the app’s policy is refused', async () => {
  /** @param {string} what */
  const tried = (what) => page.evaluate((what) => {
    try {
      if (what === 'plain') new Worker('/src/core/worker.js', { type: 'module' });
      // The policy names the app's workers only; a second one cannot be made.
      else /** @type {any} */ (window).trustedTypes.createPolicy('other', { createScriptURL: (/** @type {string} */ s) => s });
      return 'allowed';
    } catch (e) { return /** @type {Error} */ (e).name; }
  }, what);
  // Each browser says so once, in its own words.
  assert.equal(await env.expecting(/TrustedScriptURL|injection sink/, 1, () => tried('plain')), 'TypeError');
  assert.equal(await env.expecting(/TrustedTypePolicy|Trusted Types policy/, 1, () => tried('policy')), 'TypeError');
});

test('a script written into the page does not run', async () => {
  const ran = await env.expecting(/TrustedScript\b|injection sink/, 1, () => page.evaluate(() => {
    const w = /** @type {any} */ (window);
    w.ran = false;
    const s = document.createElement('script');
    // Through the DOM's text, which Trusted Types guards; an inline script
    // runs as it is appended, or never.
    try { s.textContent = 'window.ran = true'; document.head.append(s); } catch { /* refused: good */ }
    return w.ran;
  }));
  assert.equal(ran, false);
});
