// The layout of each screen, kept: which controls stand in which row, in
// what order, and how tall each is — on the smallest phone, an ordinary one
// and a computer. A button that moves to another row, wraps onto a second
// line, goes missing or comes in uninvited shows here as a changed row —
// what no journey test notices and a person sees at once.
//
// Not pixels: the fonts are our own, but Linux Chromium spaces their letters
// by the system's hinting, so a label is a few pixels wider on one machine
// than on another and all that follows it moves. Rows, order and height are
// the same everywhere; a control grown too wide is caught by the checks
// below, not by its width.
//
// The rows are compared with files in layout/, made by this test:
//   UPDATE_LAYOUT=1 npm test -- layout.test.mjs
// Look at what changed before you write them anew: a moved control should be
// a decision, not an accident. Only Chromium is compared with them (Firefox
// sets text on its own and may wrap a label elsewhere); in every browser
// each screen is also checked for what is never right: a page wider than
// the screen, controls on top of one another, a label that does not fit in
// its button, a field with no name for a screen reader.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { suite, tab, samples, still, overlaps, visible } from './helpers.mjs';

const env = suite();
const DIR = new URL('./layout/', import.meta.url);
const UPDATE = process.env.UPDATE_LAYOUT === '1';
/** Heights a pixel or two apart are one height (rounding); a wrap adds a whole line. */
const SLACK = 2;

/** The screens, how to reach each from the one before (a phone with the sample cards), and whether a sheet lies over it. */
const SCREENS = [
  ['collection-weeks', async (p) => { await tab(p, 'collection'); await still(p); }],
  ['collection-months', async (p) => { await p.keyboard.press('-'); await still(p); }],
  ['collection-feed', async (p) => { await p.keyboard.press('+'); await p.keyboard.press('+'); await still(p); }],
  ['collection-card', async (p) => { await p.keyboard.press('+'); await still(p); }],
  ['editor', async (p) => { await tab(p, 'draw'); await p.locator('.ed-art').waitFor(); await still(p); }],
  ['editor-layers', async (p) => { await p.click('.ed-layers-btn'); await still(p); }, 'a sheet over the screen'],
  ['give', async (p) => { await p.keyboard.press('Escape'); await tab(p, 'give'); await still(p); }],
  ['scanner', async (p) => { await tab(p, 'receive'); await still(p); }],
  ['profile', async (p) => { await tab(p, 'me'); await still(p); }],
];
const SIZES = [[320, 568], [390, 844], [1440, 900]];

/**
 * Every control on screen in rows, top to bottom, each row left to right,
 * as [label, height] — what can be pressed or typed in, not the cards (their
 * places come from the dates of the samples) nor anything parked off the
 * screen or faded out. A control is in the row of the one above it when its
 * middle is level with it (the raised scan button is in the tab bar).
 * @param {import('playwright').Page} p @returns {Promise<[string, number][][]>}
 */
async function rows(p) {
  const seen = await visible(p, ':is(button, input, select, textarea, summary, [role="tab"]):not(:is(.on-stage, .stage-label, .turn, .toast) *)');
  seen.sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0]);
  /** @type {{ top: number, bottom: number, in: typeof seen }[]} */
  const out = [];
  for (const c of seen) {
    const mid = (c.box[1] + c.box[3]) / 2;
    const row = out.find((r) => mid >= r.top && mid <= r.bottom);
    if (row) row.in.push(c); else out.push({ top: c.box[1], bottom: c.box[3], in: [c] });
  }
  return out.map((r) => r.in.sort((a, b) => a.box[0] - b.box[0]).map((c) => [c.label, Math.round(c.box[3] - c.box[1])]));
}

/**
 * Controls whose content does not fit in them: a label spilling out of its
 * button or cut by it. Not fields — a long value scrolls in them by design —
 * nor a control that ends its text with an ellipsis: a name or a tag can be
 * any length, and that is how it says it goes on.
 * @param {import('playwright').Page} p
 */
async function spilling(p) {
  const seen = await visible(p, ':is(button, summary, [role="tab"]):not(:is(.on-stage, .turn) *)');
  return seen.filter((c) => c.spills).map((c) => `«${c.label}»`);
}

/**
 * Fields a screen reader could not name: no label tied to them, no
 * aria-label. A placeholder is not a name (it goes once something is typed).
 * @param {import('playwright').Page} p
 */
const nameless = (p) => p.$$eval(':is(input, select, textarea):not([type="hidden"], [type="file"])', (els) => els
  .filter((e) => e.getClientRects().length && !e.closest('[hidden], [inert]'))
  .filter((e) => !e.getAttribute('aria-label') && !e.getAttribute('aria-labelledby') && !(/** @type {HTMLInputElement} */ (e).labels?.length))
  .map((e) => e.outerHTML.slice(0, 80)));

/** A row as a line of its file: «label» height · «label» height. @param {[string, number][]} row */
const line = (row) => row.map(([label, h]) => `«${label}» ${h}`).join(' · ');
/** @param {string} text @returns {[string, number][][]} */
const parse = (text) => text.trim().split('\n').map((l) => [...l.matchAll(/«(.*?)» (\d+)/g)].map((m) => [m[1], Number(m[2])]));

for (const [w, h] of SIZES) {
  test(`every screen keeps its layout at ${w}×${h}`, async () => {
    const p = await env.phone('layoutfox', undefined, w > 900);
    await p.setViewportSize({ width: w, height: h });
    await tab(p, 'me');
    await samples(p);
    await p.evaluate(() => document.fonts.ready);
    const chromium = p.context().browser()?.browserType().name() === 'chromium';
    const changes = [];
    for (const [name, reach, sheet] of SCREENS) {
      await reach(p);
      // Never right, anywhere: the page wider than the screen, controls on top of one another.
      assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: the page is no wider than the screen`);
      if (!sheet) assert.deepEqual(await overlaps(p), [], `${name}: nothing covers anything else`); // a sheet lies over the screen by design
      assert.deepEqual(await spilling(p), [], `${name}: every label fits in its control`);
      assert.deepEqual(await nameless(p), [], `${name}: every field has a name to be read out`);
      if (!chromium) continue;
      const now = await rows(p);
      const file = new URL(`${name}-${w}.txt`, DIR);
      if (UPDATE) {
        await mkdir(DIR, { recursive: true });
        await writeFile(file, `${now.map(line).join('\n')}\n`); // a row a line: a change reads as one
        continue;
      }
      const kept = parse(await readFile(file, 'utf8'));
      const same = (a = [], b = []) => a.length === b.length && a.every(([l, h], i) => l === b[i][0] && Math.abs(h - b[i][1]) <= SLACK);
      for (let i = 0; i < Math.max(kept.length, now.length); i++) {
        if (!same(kept[i], now[i])) changes.push(`${name}, row ${i + 1}: ${kept[i] ? line(kept[i]) : '(none)'} → ${now[i] ? line(now[i]) : '(none)'}`);
      }
    }
    assert.deepEqual(changes, [], 'controls in the rows kept, each as tall; if this was meant, UPDATE_LAYOUT=1');
    await p.context().close();
  });
}

// English is longer in places and shorter in others: on the narrowest phone,
// the same checks of what is never right, every screen in English.
test('every screen in English, on the narrowest phone: nothing spills, covers or goes unnamed', async () => {
  const p = await env.phone('layoutfox');
  await p.setViewportSize({ width: 320, height: 568 });
  await tab(p, 'me');
  await samples(p);
  await tab(p, 'me'); // the samples are shown in the collection
  await p.selectOption('section.view:visible select[aria-label="Язык"]', 'en'); // the app starts again, in English
  await p.locator('html[lang="en"] nav.tabs').waitFor();
  await p.evaluate(() => document.fonts.ready);
  for (const [name, reach, sheet] of SCREENS) {
    await reach(p);
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: the page is no wider than the screen`);
    if (!sheet) assert.deepEqual(await overlaps(p), [], `${name}: nothing covers anything else`);
    assert.deepEqual(await spilling(p), [], `${name}: every label fits in its control`);
    assert.deepEqual(await nameless(p), [], `${name}: every field has a name to be read out`);
  }
  await p.context().close();
});
