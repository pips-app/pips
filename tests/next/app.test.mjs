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

test('the app starts, and its core answers from the worker', async () => {
  await page.getByRole('status').filter({ hasText: 'Ядро на месте и отвечает.' }).waitFor();
  assert.equal(await page.getByRole('heading', { name: 'Pips' }).count(), 1);
});

test('a script URL not made by the app’s policy is refused', async () => {
  env.expectError(/requires 'TrustedScriptURL'/);
  const refused = await page.evaluate(() => {
    /** @param {() => unknown} f */
    const tried = (f) => { try { f(); return 'allowed'; } catch (e) { return /** @type {Error} */ (e).name; } };
    return {
      plain: tried(() => new Worker('/src/core/worker.js', { type: 'module' })),
      // The policy names the app's workers only; a second policy cannot be made.
      other: tried(() => /** @type {any} */ (window).trustedTypes.createPolicy('other', { createScriptURL: (/** @type {string} */ s) => s })),
    };
  });
  assert.deepEqual(refused, { plain: 'TypeError', other: 'TypeError' });
});

test('a script written into the page does not run', async () => {
  env.expectError(/requires 'TrustedScript'|Content.Security.Policy|script-src|Refused to execute/i);
  const ran = await page.evaluate(() => {
    const w = /** @type {any} */ (window);
    w.ran = false;
    const s = document.createElement('script');
    // Through the DOM's text, which Trusted Types guards too; whichever
    // stops it, it must not run.
    // An inline script runs as it is appended, or never.
    try { s.textContent = 'window.ran = true'; document.head.append(s); } catch { /* refused: good */ }
    return w.ran;
  });
  assert.equal(ran, false);
});
