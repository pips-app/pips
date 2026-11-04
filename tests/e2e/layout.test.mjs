// The layout of each screen, kept: where every control is, on the smallest
// phone, an ordinary one and a computer. A button that moves, grows, wraps
// onto a second line or slides under another shows here as a changed
// rectangle — what no journey test notices and a person sees at once.
//
// The rectangles are compared with files in layout/, made by this test:
//   UPDATE_LAYOUT=1 npm test -- layout.test.mjs
// Look at what changed before you write them anew: a moved control should be
// a decision, not an accident. Only Chromium is compared with them (Firefox
// sets text a pixel differently); in every browser each screen is also
// checked for what is never right: a page wider than the screen, or
// controls on top of one another.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { suite, tab, samples, still, overlaps, visible } from './helpers.mjs';

const env = suite();
const DIR = new URL('./layout/', import.meta.url);
const UPDATE = process.env.UPDATE_LAYOUT === '1';
/** Rounded to the pixel; a difference this small or smaller is not a change. */
const SLACK = 1;

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
 * Every control on screen, as name → [x, y, width, height] of the part
 * seen: what can be pressed or typed in, not the cards (their places come
 * from the dates of the samples) nor anything parked off the screen or faded
 * out. The same name twice (palette colours) is numbered in order.
 * @param {import('playwright').Page} p
 */
async function controls(p) {
  const out = {};
  for (const { label, box: [l, t, r, b] } of await visible(p, ':is(button, input, select, textarea, summary, [role="tab"]):not(:is(.on-stage, .stage-label, .turn, .toast) *)')) {
    let key = label, n = 2;
    while (key in out) key = `${label} #${n++}`;
    out[key] = [l, t, r - l, b - t].map(Math.round);
  }
  return out;
}

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
      if (!chromium) continue;
      const now = await controls(p);
      const file = new URL(`${name}-${w}.json`, DIR);
      if (UPDATE) {
        await mkdir(DIR, { recursive: true });
        await writeFile(file, `{\n${Object.entries(now).map(([k, v]) => ` ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n')}\n}\n`); // a control a line: a change reads as one
        continue;
      }
      const kept = JSON.parse(await readFile(file, 'utf8'));
      for (const key of new Set([...Object.keys(kept), ...Object.keys(now)])) {
        const a = kept[key], b = now[key];
        if (!a) changes.push(`${name}: «${key}» is new at ${b}`);
        else if (!b) changes.push(`${name}: «${key}» is gone (was at ${a})`);
        else if (a.some((v, i) => Math.abs(v - b[i]) > SLACK)) changes.push(`${name}: «${key}» ${a} → ${b}`);
      }
    }
    assert.deepEqual(changes, [], 'controls where they were kept (x, y, width, height); if this was meant, UPDATE_LAYOUT=1');
    await p.context().close();
  });
}
