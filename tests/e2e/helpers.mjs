// Shared helpers: a static server for web/, phones (browser contexts) and
// the QR round trip — a code shown on one phone is photographed (an element
// screenshot) and opened "from picture" on another, exactly as a person
// without a camera would do. The app's own QR reader does the reading.

import { before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, normalize, extname } from 'node:path';
import { deflateSync, crc32 } from 'node:zlib';
import { chromium, firefox } from 'playwright';

/** BROWSER=firefox runs the same journeys in Firefox. */
const engine = process.env.BROWSER === 'firefox' ? firefox : chromium;
/**
 * A folder to measure into: with it, every page writes which of the app's
 * code ran (Chromium's JS coverage) as it closes; tests/coverage-report.mjs
 * sums it up. Firefox has no such measure.
 */
const COVERAGE = engine === chromium ? process.env.COVERAGE : undefined;
let measured = 0;

const WEB = new URL('../../web/', import.meta.url).pathname;
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain',
};

/**
 * Serves web/ on a free port of 127.0.0.1 (a dev host: samples allowed) —
 * or, given `root`, whatever folder it names at each request (a published
 * site, one release and then the next); none: no network, every connection
 * dropped. @param {() => string|null} [root] a folder ending in /
 */
export async function serve(root = () => WEB) {
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname));
    const base = root();
    if (!base) return req.socket.destroy();
    const file = join(base, path.endsWith('/') ? `${path}index.html` : path);
    if (!file.startsWith(base)) return res.writeHead(403).end();
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(undefined)));
  const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
  return { url: `http://127.0.0.1:${port}/`, port, close: () => server.close() };
}

/**
 * Runs in every page before the app: writes down each toast as the app
 * sets it, in order (window.__toasts). The same words twice are two toasts,
 * and one that came and went before the test looked is still there to read
 * — what a glance at the toast's text cannot tell.
 */
function hearToasts() {
  const w = /** @type {any} */ (window);
  w.__toasts = [];
  /** @param {Element} span */
  const watch = (span) => {
    if (span.textContent) w.__toasts.push(span.textContent); // set before the toast was found
    new MutationObserver(() => w.__toasts.push(span.textContent)).observe(span, { childList: true, characterData: true, subtree: true });
  };
  const find = new MutationObserver(() => {
    const span = document.querySelector('.toast > span');
    if (span) { find.disconnect(); watch(span); }
  });
  find.observe(document, { childList: true, subtree: true });
}

/**
 * Runs in every page before the app: writes down each native drag the
 * browser starts (window.__drags) — a picture or text carried off by the
 * mouse, which the app never means; Firefox then holds the mouse until it
 * is dropped. Read by the monkey when a step hangs.
 */
function hearDrags() {
  const w = /** @type {any} */ (window);
  w.__drags = [];
  addEventListener('dragstart', (e) => {
    const t = /** @type {Element} */ (e.target);
    const path = [];
    for (let a = t instanceof Element ? t : t?.parentElement; a && path.length < 4; a = a.parentElement) path.push(`${a.tagName.toLowerCase()}${typeof a.className === 'string' && a.className ? `.${a.className.trim().split(/\s+/).join('.')}` : ''}`);
    w.__drags.push(`${t?.nodeName}: ${path.join(' < ')}`);
  }, true);
}

/** One browser for a test file, plus a scratch folder for pictures. */
export async function setup() {
  const site = await serve();
  const browser = await engine.launch();
  const dir = await mkdtemp(join(tmpdir(), 'pips-e2e-'));
  const errors = [];
  /** @type {import('playwright').Page[]} */
  const phones = [];
  /** Writes down which of the app's own code ran in `p`, once. @param {import('playwright').Page} p */
  async function keepCoverage(p) {
    if (p.isClosed() || !phones.includes(p)) return;
    phones.splice(phones.indexOf(p), 1);
    const ran = (await p.coverage.stopJSCoverage()).filter((e) => new URL(e.url).pathname.startsWith('/src/'));
    await writeFile(join(/** @type {string} */ (COVERAGE), `${process.pid}-${measured++}.json`), JSON.stringify(ran.map(({ url, functions }) => ({ url, functions }))));
  }
  /** Every error a page writes goes to `errors`: the test fails on it. @param {import('playwright').Page} p @param {string} name */
  function watch(p, name) {
    p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
  }
  /** A fresh phone at its first screen; `desk`: a computer's screen instead; `scale`: device pixels to a CSS pixel. */
  async function blank(name, desk = false, scale = 1) {
    const viewport = desk ? { width: 1440, height: 900 } : { width: 390, height: 844 };
    const ctx = await browser.newContext({ viewport, locale: 'ru-RU', acceptDownloads: true, deviceScaleFactor: scale });
    await ctx.addInitScript(hearToasts);
    await ctx.addInitScript(hearDrags);
    const p = await ctx.newPage();
    if (COVERAGE) {
      // Measured from the first script to the last reload, and written down
      // before the phone goes: the tests close their phones themselves.
      await p.coverage.startJSCoverage({ resetOnNavigation: false });
      const close = ctx.close.bind(ctx);
      ctx.close = async (...a) => { await keepCoverage(p); return close(...a); };
      phones.push(p);
    }
    watch(p, name);
    await p.goto(site.url);
    // Without web/pkg the app falls back to a stub with no cryptography
    // (core.js), and says so with a banner: a run on it would pass while
    // proving nothing. Asked of the app once it has started — not of a
    // warning, which a page left mid-load writes as well.
    await p.locator(':is(.onb, nav.tabs, .halt)').first().waitFor();
    if (await p.locator('.dev-banner').count()) errors.push(`${name}: the core in web/pkg did not load — run scripts/build-wasm.sh`);
    return p;
  }
  /** A fresh phone with a key; with `words`, restored instead of created. */
  async function phone(nick, words, desk = false, scale = 1) {
    const p = await blank(nick, desk, scale);
    if (words) {
      await p.click('text=У меня уже есть ключ');
      await p.fill('.words-entry input >> nth=0', words); // a phrase pasted fills every cell
      await p.click('.onb-go');
    } else {
      await p.click('text=Создать ключ');
      await p.check('.check input');
      await p.click('text=Дальше');
    }
    await p.fill('.field input', nick);
    await p.click('text=Готово');
    await p.locator('nav.tabs').waitFor();
    return p;
  }
  return {
    phone, blank, watch, dir, errors, url: site.url,
    async close() {
      for (const p of [...phones]) await keepCoverage(p); // phones still open as the file ends
      await browser.close();
      site.close();
    },
  };
}

/** Photographs a QR code on screen into a file. */
export async function photo(page, selector, dir, name) {
  const file = join(dir, `${name}.png`);
  await page.locator(selector).first().screenshot({ path: file });
  return file;
}

/** Opens a picture through a scanner's "from picture" button in `scope`. */
export async function fromPicture(page, scope, file) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click(`${scope} >> text=Из картинки`)]);
  await chooser.setFiles(file);
}

/** Picks a file through whatever `click` opens. */
export async function choose(page, click, file) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), click()]);
  await chooser.setFiles(file);
}

/**
 * Waits for `check` to come true — a state, asked from the test: a count in
 * the app, something written to storage, a download in. Throws, naming
 * `what`, if it has not in `timeout` ms.
 * @param {() => Promise<unknown>} check @param {string} what
 */
export async function until(check, what, timeout = 5000) {
  const at = Date.now();
  while (!(await check())) {
    if (Date.now() - at > timeout) throw new Error(`waited ${timeout} ms, still not: ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** The text of `selector` once it matches `re` (waits up to 5 s; then the text as it is, for the assertion to show). */
export async function textMatching(page, selector, re) {
  let text = '';
  await until(async () => re.test(text = (await page.locator(selector).first().textContent()) ?? ''), `${selector} matches ${re}`).catch(() => {});
  return text;
}

/**
 * The toast `action` brings: waits for a toast shown after it began, so one
 * already up is never taken for the answer. If it brings several (a series
 * counting up), the latest.
 * @param {import('playwright').Page} page @param {() => Promise<unknown>} action
 */
export async function toastAfter(page, action) {
  const before = await toastsSoFar(page);
  await action();
  await until(async () => (await toastsSoFar(page)) > before, 'a toast after the action');
  return latestToast(page);
}

/** Taps a tab. The feed, a single card and the archive hide the tab bar,
 * as a person would, Escape steps back until it shows. */
export async function tab(page, name) {
  for (let i = 0; i < 4 && (await page.locator('nav.tabs.away').count()); i++) {
    await page.keyboard.press('Escape');
    await still(page);
  }
  await page.click(`nav.tabs button[data-tab="${name}"]`);
}
/** How many toasts the page has shown. @param {import('playwright').Page} page */
const toastsSoFar = (page) => page.evaluate(() => /** @type {any} */ (window).__toasts.length);
/** The page's latest toast. @param {import('playwright').Page} page @returns {Promise<string>} */
const latestToast = (page) => page.evaluate(() => /** @type {any} */ (window).__toasts.at(-1));

/**
 * The latest toast, waiting for the first if none came yet. For a page just
 * opened; after a tap or a key, use toastAfter, which cannot mistake an
 * earlier toast for the answer.
 * @param {import('playwright').Page} page
 */
export async function toast(page) {
  await until(async () => (await toastsSoFar(page)) > 0, 'a toast');
  return latestToast(page);
}
/** Writes a PNG of RGBA pixels drawn by `f(x, y)`. */
export async function png(dir, name, w, h, f) {
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + 4 * w);
    for (let x = 0; x < w; x++) Buffer.from(f(x, y)).copy(row, 1 + 4 * x);
    rows.push(row);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const file = join(dir, name);
  await writeFile(file, Buffer.concat([
    Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0)),
  ]));
  return file;
}

/** A heart in PICO-8 colours, exported at ×6. */
export const heart = (dir) => png(dir, 'heart-x6.png', 60, 48, (x, y) => {
  const m = ['..##..##..', '.########.', '##########', '##########', '.########.', '..######..', '...####...', '....##....'];
  const [X, Y] = [Math.floor(x / 6), Math.floor(y / 6)];
  return m[Y][X] === '#' ? ((X + Y) % 5 ? [255, 0, 77, 255] : [255, 119, 168, 255]) : [0, 0, 0, 0];
});

/** 512 colours: needs a palette. */
export const gradient = (dir) => png(dir, 'gradient.png', 64, 8, (x, y) => [x * 4, y * 30, 128, 255]);
/** Wider than the app's largest canvas, and not an upscaled export. */
export const wide = (dir) => png(dir, 'wide.png', 80, 8, (x, y) => [x * 3, y * 30, 64, 255]);

/**
 * Adds the sample cards from Profile (already open): developer mode on by
 * its phrase if it is off, then «Add samples», confirmed.
 */
export async function samples(page) {
  // Profile draws itself when shown: wait for the group, in either state.
  await page.locator('section.view:visible .group.developer > *').first().waitFor();
  const gate = page.locator('section.view:visible .dev-gate');
  if (await gate.count()) {
    if (!(await gate.evaluate((d) => d.open))) await gate.locator('summary').click();
    await gate.locator('input').fill('I am a developer');
  }
  await page.click('section.view:visible >> text=Добавить образцы');
  const said = await toastAfter(page, () => page.click('.dialog button:text-is("Да")'));
  if (!/^Добавлено образцов/.test(said)) throw new Error(`samples: ${said}`);
}

// ---------------------------------------------------------------- a suite --

/**
 * One test file's browser and site, opened before its tests and closed after
 * them — and then the check every file makes: no page reported an error
 * (thrown, or written in the app's journal, which tells the console).
 * @returns {Awaited<ReturnType<typeof setup>>} filled in once the file's tests start
 */
export function suite() {
  const env = /** @type {any} */ ({});
  /** @type {Promise<unknown> | undefined} */
  let ready;
  before(async () => { ready = setup().then((made) => Object.assign(env, made)); await ready; });
  // When a name pattern leaves a file no test to run, node:test (22) starts
  // `before` and runs `after` without waiting for it: wait here, or the
  // browser opened meanwhile is never closed and the run never ends.
  // A page's error fails the test it happened in, by name — a test that
  // meets one on purpose takes it out of `errors` before it ends.
  afterEach(() => {
    const met = env.errors?.splice(0) ?? [];
    assert.deepEqual(met, [], 'no errors in any page');
  });
  after(async () => {
    await ready;
    if (!env.close) return;
    await env.close();
    assert.deepEqual(env.errors, [], 'no errors in any page, nor as the browser closed');
  });
  return env;
}

// ------------------------------------------------------- the app's steps --

/** The recovery words of the phone's key. */
export const words = (p) => p.evaluate(async () => (await import('/src/state.js')).app.identity.words());
/** How many cards the phone holds, in all places. */
export const cards = (p) => p.evaluate(async () => (await import('/src/state.js')).app.cards.size);

/** Opens a picture from a file in the editor: Draw → More → From a picture. */
export async function picture(p, file) {
  await tab(p, 'draw');
  await p.locator('.ed-art').waitFor();
  await p.click('[aria-label="Ещё"]');
  await choose(p, () => p.click('.ed-new-tile >> nth=1'), file);
  await p.locator('.overlay .pic-body').waitFor();
}

/** Makes an own card from the heart picture; it opens large in the collection. @param {string} dir where the picture is written */
export async function ownCard(p, title, dir) {
  await picture(p, await heart(dir));
  await p.click('.overlay .btn.key'); // «На холст»
  await p.locator('.overlay').waitFor({ state: 'detached' });
  await p.fill('.ed-title', title);
  await p.click('.ed-sign');
  await p.locator('.turn:not([hidden])').waitFor();
}

/**
 * Waits until nothing moves on screen: the app's frame loop rests, the
 * cards, the turned card, sheets and bars keep their places (and cards
 * their opacity) for three frames running, and no CSS
 * transition is under way. For "the animation has finished" — instead of
 * a pause long enough on this machine, and too short on a slower one.
 * @param {import('playwright').Page} page @param {number} [timeout] ms
 */
export async function still(page, timeout = 5000) {
  const ok = await page.evaluate(async (timeout) => {
    // The app's own animations all run on one frame loop (kit/motion.js): it says when it rests.
    const { loop } = await import('/src/kit/motion.js');
    return new Promise((done) => {
    const MOVING = '.on-stage, .turn, .turn-flip, .stage-label, .strip, .strip .mini, .bottom-sheet, .top-sheet, .action-bar, nav.tabs, .fly-layer > *';
    const where = () => [...document.querySelectorAll(MOVING)].map((e) => {
      const r = e.getBoundingClientRect();
      // Its opacity too: cards fade in and out of a place where they stand still.
      return `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)},${/** @type {HTMLElement} */ (e).style.opacity}`;
    }).join(';') + `|${/** @type {HTMLElement|null} */ (document.querySelector('.turn-flip'))?.style.transform ?? ''}`;
    const sliding = () => document.getAnimations().some((a) => typeof CSSTransition === 'function' && a instanceof CSSTransition && a.playState === 'running');
    const end = performance.now() + timeout;
    let last = where(), calm = 0;
    const frame = () => {
      const now = where();
      calm = now === last && !sliding() && !loop.running ? calm + 1 : 0;
      last = now;
      if (calm >= 3) done(true);
      else if (performance.now() > end) done(false);
      else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    });
  }, timeout);
  if (!ok) throw new Error(`still moving after ${timeout} ms`);
}

/** Presses one of the action bar's buttons under the card in front (share, turn, down…). */
export const act = (p, name) => p.click(`.action-bar.up [data-act="${name}"]`);

/** Turns the card in front over and reads its back, once it has turned. */
export async function backText(p) {
  await act(p, 'turn');
  await still(p);
  return p.textContent('.turn .back-face');
}

/**
 * What of `selector` a person can see, each as { name, label, box, within, spills }:
 * box is [left, top, right, bottom] of the part on screen — cut by the
 * screen and by every container that clips or scrolls it (a button scrolled
 * out of its panel is not there to cover anything); within lists the
 * entries it lies inside; spills, whether its content is larger than it (a
 * label out of its button) — unless it cuts it with an ellipsis on purpose. Hidden, invisible and faded-out elements are left
 * out, as is anything with nothing left of it.
 * @param {import('playwright').Page} p @param {string} selector
 */
export const visible = (p, selector) => p.evaluate((selector) => {
  const els = [...document.querySelectorAll(selector)];
  const kept = [];
  for (const e of els) {
    if (e.closest('[hidden]')) continue;
    const r = e.getBoundingClientRect();
    let [l, t, rt, b] = [Math.max(r.left, 0), Math.max(r.top, 0), Math.min(r.right, innerWidth), Math.min(r.bottom, innerHeight)];
    let seen = getComputedStyle(e).visibility !== 'hidden';
    for (let a = e; a && seen; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (s.opacity === '0') seen = false;
      if (a === e) continue;
      const c = a.getBoundingClientRect();
      if (s.overflowX !== 'visible') { l = Math.max(l, c.left); rt = Math.min(rt, c.right); }
      if (s.overflowY !== 'visible') { t = Math.max(t, c.top); b = Math.min(b, c.bottom); }
    }
    if (seen && rt - l > 0.5 && b - t > 0.5) kept.push({ e, box: [l, t, rt, b] });
  }
  return kept.map(({ e, box }) => ({
    name: `${e.tagName.toLowerCase()}.${[...e.classList].join('.')} «${(e.textContent ?? '').trim().slice(0, 24)}»`,
    label: e.getAttribute('aria-label') || (e.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 32) || e.className || e.tagName,
    box,
    within: kept.flatMap((o, i) => (o.e !== e && o.e.contains(e) ? [i] : [])),
    spills: (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1) && getComputedStyle(e).textOverflow !== 'ellipsis',
  }));
}, selector);

/**
 * Controls on screen that cover one another, or the tab bar's raised scan
 * button: [what, what] pairs. Only what is seen, and not one inside another.
 * @param {import('playwright').Page} p
 */
export async function overlaps(p) {
  const seen = await visible(p, 'section.view:not([hidden]) :is(button, input, select, textarea, .hint, .coach, .idcard), .coach:not([hidden])');
  const hit = ([al, at, ar, ab], [bl, bt, br, bb]) => al < br - 0.5 && bl < ar - 0.5 && at < bb - 0.5 && bt < ab - 0.5;
  const out = [];
  seen.forEach((a, i) => seen.forEach((b, j) => {
    if (j > i && !a.within.includes(j) && !b.within.includes(i) && hit(a.box, b.box)) out.push([a.name, b.name]);
  }));
  // The scan button and its ring stand above the bar: nothing floating may touch them.
  const [fab] = await visible(p, '.tabs:not(.away) .main i');
  const [coach] = await visible(p, '.coach:not([hidden])');
  if (fab && coach && coach.box[3] > fab.box[1] - 5) out.push(['.coach', 'the scan button']);
  return out;
}

