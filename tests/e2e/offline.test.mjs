// The published site as people get it: installed by its service worker,
// working with no network — every screen, and the modules loaded only when
// first needed — and a new release offered, taken, and working offline in
// its turn. Only here does the worker run: the other tests use a dev host,
// where the app does not register it (main.js).
//
// Two releases are built by scripts/build-site.sh, as CI publishes them,
// and served one after the other at pips.localhost: not a dev host to the
// app, yet a secure origin to the browser, as a service worker needs — any
// name under .localhost is the machine itself.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { serve, photo, fromPicture, ownCard, act, tab, until } from './helpers.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;
const firefox = process.env.BROWSER === 'firefox';

/** @type {{dir: string, releases: string[], site: Awaited<ReturnType<typeof serve>>, browser: import('playwright').Browser, origin: string, serving: number|null}} */
const env = /** @type {any} */ ({ serving: 0 });

before(async () => {
  if (firefox) return;
  env.dir = await mkdtemp(join(tmpdir(), 'pips-site-'));
  // Two releases of the same code, told apart by their version, as two pushes to main would be.
  env.releases = [];
  for (const v of ['one', 'two']) {
    await promisify(execFile)('scripts/build-site.sh', [`test-${v}`], { cwd: ROOT });
    const to = join(env.dir, v, '/');
    await cp(join(ROOT, '_site'), to, { recursive: true });
    env.releases.push(to);
  }
  await rm(join(ROOT, '_site'), { recursive: true });
  // `serving`: which release is published; null, no network at all — every
  // connection dropped, for the page and its service worker alike (the
  // browser's own offline switch does not reach a service worker).
  env.site = await serve(() => (env.serving === null ? null : env.releases[env.serving]));
  env.origin = `http://pips.localhost:${env.site.port}`;
  env.browser = await chromium.launch();
});

after(async () => {
  if (firefox) return;
  await env.browser?.close();
  env.site?.close();
  if (env.dir) await rm(env.dir, { recursive: true });
});

test('the published app installs, works with no network, and takes a new release when asked', { skip: firefox && 'Chromium only: a service worker needs a secure origin' }, async () => {
  const ctx = await env.browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ru-RU' });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const version = () => p.evaluate(async () => (await import('/src/version.js')).VERSION);

  await p.goto(`${env.origin}/`);
  await p.click('text=Создать ключ');
  await p.check('.check input');
  await p.click('text=Дальше');
  await p.fill('.field input', 'offlinefox');
  await p.click('text=Готово');
  await p.locator('nav.tabs').waitFor();
  assert.equal(await version(), 'pips-test-one');
  // Installed: the page is in the worker's hands, every published file cached.
  await until(() => p.evaluate(() => !!navigator.serviceWorker.controller), 'the page controlled by the service worker', 10_000);

  // No network: the app starts, and every screen opens.
  env.serving = null;
  await p.reload();
  await p.locator('nav.tabs').waitFor();
  await ownCard(p, 'Без сети', env.dir); // the editor and its picture import
  await act(p, 'share');
  const code = await photo(p, '.top-sheet .qr-box', env.dir, 'offline-code');
  await p.keyboard.press('Escape');
  await tab(p, 'receive');
  // The QR reader is loaded only when first needed: it is there offline too.
  await fromPicture(p, 'section.view:visible', code);
  await p.locator('.toast >> text=Такая карточка уже есть').waitFor();
  await tab(p, 'give');
  await tab(p, 'me');
  await p.locator('section.view:visible >> text=Резервная копия').waitFor();

  // The next release is published. Back online, the app finds it, offers it,
  // and takes it when asked: the page starts again on the new version.
  env.serving = 1;
  await p.reload();
  await p.locator('.toast button').waitFor({ timeout: 15_000 });
  await Promise.all([p.waitForEvent('load'), p.click('.toast button')]);
  await p.locator('nav.tabs').waitFor();
  assert.equal(await version(), 'pips-test-two');
  // And the new release works offline in its turn, the old cache gone.
  env.serving = null;
  await p.reload();
  await p.locator('nav.tabs').waitFor();
  assert.equal(await version(), 'pips-test-two');
  assert.deepEqual(await p.evaluate(() => caches.keys()), ['pips-test-two'], 'only the new release kept');
  assert.deepEqual(errors, [], 'no errors in the page');
  await ctx.close();
});
