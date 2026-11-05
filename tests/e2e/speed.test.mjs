// Smoothness that would be lost unseen: a change that makes every card be
// laid out again on every frame of a zoom still works, and only shows on a
// slow phone with many cards (that once made weeks ↔ months run at a few
// frames a second, DECISIONS.md, «Масштаб без перекладки»).
//
// Frame times depend on the machine; how many times the browser lays the
// page out does not. So this counts layouts during a zoom, with many cards
// on screen, against the frames drawn meanwhile. It needs Chromium's
// DevTools for the count; Firefox has no such measure to read.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suite, tab, still } from './helpers.mjs';

const env = suite();
/** Cards: enough for a full screen at the smallest level, and many off it. */
const CARDS = 150;

test('a zoom between weeks and months lays the cards out once, not on every frame', { skip: process.env.BROWSER === 'firefox' && 'counting layouts needs Chromium’s DevTools' }, async () => {
  const p = await env.phone('speedfox');
  // Many cards, each its own picture, spread over a year.
  await p.evaluate(async (n) => {
    const { app, addOwn, backdate } = await import('/src/state.js');
    const c = new OffscreenCanvas(16, 16), g = c.getContext('2d');
    for (let i = 0; i < n; i++) {
      for (let y = 0; y < 16; y += 4) for (let x = 0; x < 16; x += 4) {
        g.fillStyle = `hsl(${(i * 37 + x * 9 + y) % 360} 60% 50%)`;
        g.fillRect(x, y, 4, 4);
      }
      const png = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
      const card = { ...app.core.importPicture(png, { fit: 16 }).card, title: `№${i}`, author: 'speedfox', handle: null, link: '' };
      await backdate((await addOwn(app.identity.signCard(card))).digest, Date.now() - i * 2.4 * 86_400_000);
    }
  }, CARDS);
  await p.reload();
  await p.locator('nav.tabs').waitFor();
  await tab(p, 'collection');
  await still(p);

  const cdp = await p.context().newCDPSession(p);
  await cdp.send('Performance.enable');
  const layouts = async () => (await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'LayoutCount')?.value ?? 0;
  /** Layouts and frames while the zoom runs, from the key to the last frame of it. @param {string} key */
  const zoom = async (key) => {
    await p.evaluate(() => {
      const w = /** @type {any} */ (window);
      w.drawn = 0;
      const count = () => { w.drawn++; if (w.drawn < 600) requestAnimationFrame(count); };
      requestAnimationFrame(count);
    });
    const before = await layouts();
    await p.keyboard.press(key);
    await still(p);
    return { layouts: (await layouts()) - before, frames: await p.evaluate(() => /** @type {any} */ (window).drawn) };
  };
  for (const [key, what] of [['-', 'weeks → months'], ['+', 'months → weeks']]) {
    const r = await zoom(key);
    assert.ok(r.frames > 20, `${what}: the zoom ran (${r.frames} frames)`);
    // Some layouts are the zoom's own: its start, its end, the bars changing,
    // a card coming into view (14 in 63 frames measured). Laying the cards
    // out on every frame, as before «Масштаб без перекладки», gave 41 in 44.
    assert.ok(r.layouts * 2 < r.frames, `${what}: ${r.layouts} layouts in ${r.frames} frames — cards laid out again as they move`);
  }
  await p.context().close();
});
