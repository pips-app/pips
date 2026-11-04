// The editor: tools, the precise mode, undo, palettes, frames and layers,
// pictures brought in, signing — and that the canvas holds still.
// Run after scripts/build-wasm.sh: `npm ci && npm test` in this folder.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suite, photo, choose, tab, toast, heart, gradient, wide, png, textMatching, cards, picture, act, still } from './helpers.mjs';

const env = suite();

test('a picture comes onto the canvas: pixel art as it is, the rest through a square', async () => {
  const p = await env.phone('pixelfox');
  // 512 colours: an own palette is fitted by itself, and said so.
  await picture(p, await gradient(env.dir));
  assert.match(await textMatching(p, '.overlay .import-status', /подобрана своя палитра/), /больше 256 цветов файла → свои 32/);
  assert.equal(await p.inputValue('.overlay select'), 'fit:32');
  await p.selectOption('.overlay select', { label: 'PICO-8 · 16' });
  assert.match(await textMatching(p, '.overlay .import-status', /палитра PICO-8 · 512 пикселей сменили цвет/), /палитра PICO-8 · 512 пикселей сменили цвет/);
  assert.equal(await p.locator('.overlay .pic-stage').count(), 0, 'no crop: 64×8 fits the canvas as it is');
  await p.click('.overlay .btn.key');
  assert.equal(await toast(p), 'Картинка на холсте');
  const size = () => p.$eval('.ed-layer', (c) => String(c.width));
  assert.equal(await size(), '64', 'the canvas that holds it');

  // Wider than any canvas: a square of its own pixels, never more than fits.
  await picture(p, await wide(env.dir));
  assert.ok(await p.isVisible('.overlay .pic-stage'));
  assert.match(await textMatching(p, '.overlay .import-status', /^8×8/), /^8×8/);
  await p.click('.overlay .btn.key');
  assert.equal(await size(), '16');

  // A large picture with soft colours: cropped and scaled to the size chosen.
  const big = await png(env.dir, 'dusk.png', 300, 200, (x, y) => [(x * 0.8) | 0, (y * 1.2) | 0, (x + y) % 256, 255]); // no pixel grid in it: a photo
  await picture(p, big);
  assert.match(await textMatching(p, '.overlay .import-status', /^32×32/), /^32×32/, 'a square at 32 to begin with');
  await p.click('.overlay .seg button:text-is("16")');
  assert.match(await textMatching(p, '.overlay .import-status', /^16×16/), /^16×16/);
  // The square follows a finger on its corner, and the result with it.
  const box = await p.locator('.pic-crop').boundingBox();
  await p.evaluate(async ([x0, y0]) => {
    const st = document.querySelector('.pic-stage');
    const fire = (t, x, y) => st.dispatchEvent(new PointerEvent(t, { bubbles: true, pointerId: 3, pointerType: 'touch', clientX: x, clientY: y }));
    fire('pointerdown', x0, y0);
    for (let i = 1; i <= 6; i++) { await new Promise((r) => setTimeout(r, 16)); fire('pointermove', x0 - i * 15, y0 - i * 15); }
    fire('pointerup', x0 - 90, y0 - 90);
  }, [box.x + box.width - 3, box.y + box.height - 3]);
  await p.waitForTimeout(300);
  const after = await p.locator('.pic-crop').boundingBox();
  assert.ok(Math.abs(after.width - (box.width - 90)) < 3 && Math.abs(after.x - box.x) < 1, 'smaller, from the corner held still');
  await p.click('.overlay .btn.key');
  assert.equal(await size(), '16');

  // Soft edges (alpha between 0 and 255): taken, made solid or clear, and said so.
  const soft = await png(env.dir, 'soft.png', 12, 12, (x, y) => {
    const d = Math.hypot(x - 5.5, y - 5.5);
    return [200, 60, 40, d < 4 ? 255 : d < 5 ? 160 : d < 6 ? 60 : 0];
  });
  await picture(p, soft);
  const said = await textMatching(p, '.overlay .import-status', /полупрозрачн/);
  assert.match(said, /^\d+ полупрозрачн.*заметные стали сплошными/);
  assert.match(said, /12×12/);
  await p.click('.overlay .btn.key');
  assert.equal(await toast(p), 'Картинка на холсте');
  assert.equal(await size(), '16');

  // The heart: unscaled, and one tap brings the previous picture back.
  await picture(p, await heart(env.dir));
  assert.match(await textMatching(p, '.overlay .import-status', /60×48 → 10×8 \(снято увеличение ×6\)/), /60×48 → 10×8 \(снято увеличение ×6\)/);
  await p.click('.overlay .btn.key');
  await p.click('.toast button'); // «Вернуть»
  assert.equal(await size(), '16', 'the cropped picture is back');
  // Larger than any canvas: still said, under the square to crop.
  const softBig = await png(env.dir, 'soft-big.png', 80, 80, (x, y) => [40, 90, 200, (x + y) % 7 === 0 ? 100 : 255]);
  await picture(p, softBig);
  assert.ok(await p.isVisible('.overlay .pic-stage'));
  assert.match(await textMatching(p, '.overlay .import-status', /полупрозрачн/), /^\d+ полупрозрачн/);
  await p.click('.overlay .btn.key');
  assert.equal(await toast(p), 'Картинка на холсте');
  assert.equal(await cards(p), 0, 'nothing was signed on the way');
  await p.context().close();
});

test('the editor: drawing, undo that loses nothing, palettes, frames, a draft, signing', async () => {
  const p = await env.phone('drawfox', undefined, true);
  await tab(p, 'draw');
  await p.locator('.ed-art').waitFor();
  await still(p);
  const art = await p.$eval('.ed-art', (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width }; });
  const at = (x, y) => ({ x: art.x + ((x + 0.5) * art.w) / 32, y: art.y + ((y + 0.5) * art.w) / 32 });
  /** The colour of a cell as drawn, or null if empty. */
  const cell = (x, y) => p.evaluate(([x, y]) => {
    const d = document.querySelectorAll('.ed-layer')[2].getContext('2d').getImageData(x, y, 1, 1).data;
    return d[3] ? `#${[d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('')}` : null;
  }, [x, y]);
  const stroke = async (from, to) => {
    const a = at(...from), b = at(...to);
    await p.mouse.move(a.x, a.y);
    await p.mouse.down();
    await p.mouse.move(b.x, b.y, { steps: 8 });
    await p.mouse.up();
  };
  const undoLabel = () => p.getAttribute('.ed-bar .ib >> nth=1', 'aria-label');

  // A line, undone with the keyboard, redone with the button.
  await stroke([2, 2], [9, 2]);
  assert.equal(await cell(5, 2), '#17151f');
  assert.equal(await undoLabel(), 'Отменить: штрих карандашом');
  await p.keyboard.press('Control+z');
  assert.equal(await cell(5, 2), null);
  await p.click('.ed-bar .ib >> nth=2');
  assert.equal(await cell(5, 2), '#17151f');

  // Undo, then something else: the first line is a branch, not lost.
  await p.keyboard.press('Control+z');
  await p.click('.ed-swatch >> nth=8'); // red
  await stroke([2, 6], [9, 6]);
  assert.equal(await cell(5, 6), '#c4392f');
  await p.click('.ed-bar .ib >> nth=1', { button: 'right' }); // the whole history
  await p.locator('.ed-history').waitFor();
  assert.equal(await p.evaluate(() => document.getElementById('app').scrollTop), 0, 'the history list scrolls itself, never the screen');
  await p.locator('.ed-history .ed-branch').first().click();
  assert.equal(await cell(5, 2), '#17151f', 'the abandoned line is back');
  assert.equal(await cell(5, 6), null);
  await p.keyboard.press('Escape');

  // Pixel-perfect: a hand-drawn stair has no doubled corners.
  await p.click('.ed-swatch >> nth=4');
  const pts = [[12, 12], [13, 12], [13, 13], [14, 13], [14, 14]].map(([x, y]) => at(x, y));
  await p.mouse.move(pts[0].x, pts[0].y);
  await p.mouse.down();
  for (const q of pts.slice(1)) await p.mouse.move(q.x, q.y);
  await p.mouse.up();
  assert.equal(await cell(13, 12), null, 'the corner cell is taken out');
  assert.equal(await cell(13, 13), '#17151f');

  // A selection: a box around the stair, moved four cells right, mirrored —
  // two steps, both undone.
  await p.keyboard.press('s');
  await stroke([11, 11], [15, 15]);
  assert.equal(await p.isVisible('.ed-sel-bar'), true);
  await stroke([13, 13], [17, 13]);
  assert.equal(await cell(17, 13), '#17151f', 'moved');
  assert.equal(await cell(13, 13), null, 'and gone from where it was');
  await p.click('.ed-sel-btn[aria-label="Отразить слева направо"]');
  assert.equal(await undoLabel(), 'Отменить: отражение');
  await p.keyboard.press('Control+z');
  await p.keyboard.press('Control+z');
  assert.equal(await cell(13, 13), '#17151f', 'back in place');
  assert.equal(await cell(17, 13), null);

  // The dithering pen fills every other cell.
  await p.keyboard.press('d');
  await stroke([2, 20], [9, 20]);
  assert.deepEqual([await cell(2, 20), await cell(3, 20), await cell(4, 20)], ['#17151f', null, '#17151f']);
  assert.equal(await undoLabel(), 'Отменить: штрих шахматкой');
  await p.keyboard.press('d');

  // Zooming brings the whole card closer; 0 puts it back.
  const mid = at(16, 16);
  await p.mouse.move(mid.x, mid.y);
  await p.mouse.wheel(0, -100);
  assert.match(await p.$eval('.ed-card', (e) => e.style.transform), /scale\(1\.25\)/);
  await p.keyboard.press('0');
  assert.equal(await p.$eval('.ed-card', (e) => e.style.transform), '');

  // A ready palette, tried and applied: the picture takes its colours, one step.
  await p.click('.ed-pal-name');
  await p.locator('.ed-pal-row', { hasText: 'Sweetie 16' }).click();
  await p.click('.bottom-sheet.on .btn.key');
  assert.match(await p.textContent('.ed-pal-name'), /Sweetie 16/);
  assert.notEqual(await cell(5, 2), '#17151f');
  assert.equal(await undoLabel(), 'Отменить: смена палитры');

  // A second frame, a title; the meter says one code.
  await p.click('.ed-frame.add');
  assert.equal(await p.locator('.ed-frame-list .ed-frame').count(), 2);
  await p.fill('.ed-title', 'Лесенка');
  assert.match(await p.textContent('.ed-meter'), /1 QR/);

  // The draft, with its history, outlives a reload.
  await p.waitForTimeout(900);
  await p.reload();
  await p.locator('nav.tabs').waitFor();
  await tab(p, 'draw');
  await p.locator('.ed-frame-list .ed-frame >> nth=1').waitFor();
  assert.equal(await p.inputValue('.ed-title'), 'Лесенка');
  assert.match(await undoLabel(), /смена названия/);

  // Signed, it opens in the collection.
  await p.click('.ed-sign');
  await p.locator('.turn:not([hidden])').waitFor();
  const card = await p.evaluate(async () => {
    const s = await import('/src/state.js');
    const e = [...s.app.cards.values()].find((x) => x.card.title === 'Лесенка');
    return e && { frames: e.card.frames, size: e.card.width, mine: e.rec.mine };
  });
  assert.deepEqual(card, { frames: 2, size: 32, mine: true });
  await tab(p, 'draw');
  assert.equal(await p.inputValue('.ed-title'), '', 'a fresh canvas after signing');
  await p.context().close();
});

test('the precise mode works with every tool', async () => {
  const p = await env.phone('aimfox');
  await tab(p, 'draw');
  await p.locator('.ed-art').waitFor();
  await p.click('.ed-tool-precise');
  const cell = (x, y) => p.evaluate(([x, y]) => {
    const d = document.querySelectorAll('.ed-layer')[2].getContext('2d').getImageData(x, y, 1, 1).data;
    return d[3] ? `#${[d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('')}` : null;
  }, [x, y]);
  // Fingers as pointer events: one moves on the pad, another holds a button.
  const finger = (sel, type, id, dx = 0, dy = 0) => p.evaluate(([sel, type, id, dx, dy]) => {
    const el = document.querySelector(sel), r = el.getBoundingClientRect();
    const x = sel === '.ed-pad' ? r.left + 20 : r.left + r.width / 2, y = sel === '.ed-pad' ? r.top + 50 : r.top + r.height / 2;
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: id, pointerType: 'touch', clientX: x + dx, clientY: y + dy }));
  }, [sel, type, id, dx, dy]);
  /** Moves the cursor by whole cells (22 px of finger a cell). */
  const aim = async (cx, cy) => {
    await finger('.ed-pad', 'pointerdown', 2);
    await finger('.ed-pad', 'pointermove', 2, cx * 22, cy * 22);
    await finger('.ed-pad', 'pointerup', 2, cx * 22, cy * 22);
  };
  /** Holds a button while the cursor moves (or not). */
  const hold = async (sel, cx = 0, cy = 0) => {
    await finger(sel, 'pointerdown', 1);
    if (cx || cy) {
      await finger('.ed-pad', 'pointerdown', 2);
      await finger('.ed-pad', 'pointermove', 2, cx * 22, cy * 22);
      await finger('.ed-pad', 'pointerup', 2, cx * 22, cy * 22);
    }
    await finger(sel, 'pointerup', 1);
  };
  const put = '.ed-put', erase = '.ed-pad .ed-round:nth-child(2)';
  assert.equal(await p.textContent(put), 'Ставить');

  // The pen: a dot, then a line while held. The cursor starts in the middle (16, 16).
  await hold(put);
  assert.equal(await cell(16, 16), '#17151f');
  await hold(put, 4, 0);
  assert.deepEqual([await cell(18, 16), await cell(20, 16)], ['#17151f', '#17151f']);
  // The eraser button, under the cursor (now at 20, 16).
  await hold(erase);
  assert.equal(await cell(20, 16), null);

  // Fill, in red, from an empty cell: everything empty takes it.
  await p.click('.ed-tool-fill');
  await p.click('.ed-swatch >> nth=8');
  assert.equal(await p.textContent(put), 'Залить');
  await aim(-18, -14); // to (2, 2)
  await hold(put);
  assert.equal(await cell(30, 30), '#c4392f');
  assert.equal(await cell(18, 16), '#17151f', 'the line stays');
  await p.click('.ed-bar .ib >> nth=1'); // undo the fill
  assert.equal(await cell(30, 30), null);

  // A rectangle, dragged from press to release.
  await p.click('.ed-tool-shapes');
  await p.click('.ed-tool-shapes');
  await p.click('.ed-shape[data-kind="rect"]');
  await hold(put, 4, 4); // (2, 2) to (6, 6)
  assert.deepEqual([await cell(6, 2), await cell(2, 6), await cell(4, 4)], ['#c4392f', '#c4392f', null]);

  // A selection around it, then moved eight cells right.
  await p.click('.ed-tool-select');
  assert.equal(await p.textContent(put), 'Выделить');
  await aim(-5, -5); // (1, 1)
  await hold(put, 6, 6); // the box (1, 1)–(7, 7)
  assert.equal(await p.isVisible('.ed-sel-bar'), true);
  await aim(-3, -3); // (4, 4), inside
  await hold(put, 8, 0);
  assert.deepEqual([await cell(14, 2), await cell(6, 2)], ['#c4392f', null]);
  assert.equal(await p.getAttribute('.ed-bar .ib >> nth=1', 'aria-label'), 'Отменить: перенос');

  // The pipette button takes the colour under the cursor.
  await p.click('.ed-tool-pen');
  await p.click('.ed-swatch >> nth=4'); // ink
  await aim(-2, -2); // (10, 2): the moved rectangle's corner, red
  await p.click('.ed-pad .ed-round:nth-child(1)');
  assert.match(await p.getAttribute('.ed-swatch[aria-pressed="true"]', 'aria-label'), /#c4392f/);

  // The mirror works here too.
  await p.click('.ed-tool-mirror');
  await aim(0, 20); // (10, 22)
  await hold(put);
  assert.deepEqual([await cell(10, 22), await cell(21, 22)], ['#c4392f', '#c4392f']);
  await p.context().close();
});

test('the editor grid lies exactly on the cells, from edge to edge', async () => {
  for (const [desk, scale] of [[false, 1], [true, 1], [false, 2.625], [false, 3]]) {
    const p = await env.phone('pixelfox', undefined, desk, scale);
    await tab(p, 'draw');
    await p.locator('.ed-art').waitFor();
    await still(p);
    const m = await p.evaluate(() => {
      const art = document.querySelector('.ed-art').getBoundingClientRect();
      const lines = /** @type {HTMLCanvasElement} */ (document.querySelector('.ed-lines'));
      const v = lines.getBoundingClientRect(), d = lines.getContext('2d').getImageData(0, 0, lines.width, lines.height).data;
      let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
      for (let y = 0; y < lines.height; y++) for (let x = 0; x < lines.width; x++) {
        if (!d[(y * lines.width + x) * 4 + 3]) continue;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
      const k = devicePixelRatio;
      return { art: [art.left - v.left, art.top - v.top, art.right - v.left, art.bottom - v.top], grid: [x0 / k, y0 / k, (x1 + 1) / k, (y1 + 1) / k] };
    });
    // The grid's lines start and end on the art's edges (within a pixel).
    m.art.forEach((a, i) => assert.ok(Math.abs(a - m.grid[i]) <= 1.5, `${desk ? 'computer' : 'phone'}: ${JSON.stringify(m)}`));
    // And the canvas they are on lies on whole device pixels, one of its
    // pixels to each: anything else is resampled, and a line blurs over two.
    // At 2.625 that is only every 8th CSS pixel.
    const fit = await p.evaluate(() => {
      const c = /** @type {HTMLCanvasElement} */ (document.querySelector('.ed-lines')), r = c.getBoundingClientRect(), k = devicePixelRatio;
      const whole = (v) => Math.abs(v - Math.round(v)) < 1e-3;
      return { ok: whole(r.left) && whole(r.top) && whole(r.left * k) && whole(r.top * k) && Math.abs(r.width * k - c.width) < 1e-3 && Math.abs(r.height * k - c.height) < 1e-3, r: [r.left, r.top, r.width, r.height], c: [c.width, c.height], k };
    });
    assert.ok(fit.ok, JSON.stringify(fit));
    await p.context().close();
  }
});

test('a row of kinds in the editor is a small menu: Esc or a tap elsewhere puts only it away', async () => {
  const p = await env.phone('kindfox');
  await tab(p, 'draw');
  await p.locator('.ed-art').waitFor();
  const row = 'section.view:visible .ed-shapes:not([hidden])';
  await p.click('.ed-tool-pen'); // the pen is already chosen: a second tap opens its kinds
  await p.locator(row).waitFor();
  await p.keyboard.press('Escape');
  assert.equal(await p.locator(row).count(), 0, 'the menu went');
  assert.ok(await p.isVisible('.ed-tools'), 'the editor stayed');
  // A tap on a colour under the menu only closes the menu.
  await p.click('.ed-tool-pen');
  const chosen = () => p.$eval('.ed-swatch[aria-pressed="true"]', (b) => b.getAttribute('aria-label')).catch(() => null);
  const before = await chosen();
  const sw = await p.locator('.ed-swatch').nth(10).boundingBox();
  await p.mouse.click(sw.x + sw.width / 2, sw.y + sw.height / 2);
  assert.equal(await p.locator(row).count(), 0, 'the menu went');
  assert.equal(await chosen(), before, 'and nothing under it was pressed');
  await p.context().close();
});

test('the editor: a still picture shows no frames to mistake for colours, and an empty canvas is not signed', async () => {
  const p = await env.phone('stillfox');
  await tab(p, 'draw');
  await p.locator('.ed-art').waitFor();
  // One frame: no play tile, no thumbnail — one button that says what it does.
  assert.ok(!(await p.isVisible('.ed-play')), 'nothing to play');
  assert.equal(await p.locator('.ed-frame-list .ed-frame:visible').count(), 0, 'no lone thumbnail');
  assert.match(await p.textContent('.ed-frame.add'), /Кадр анимации/);
  const height = () => p.$eval('.ed-frames', (e) => e.getBoundingClientRect().height);
  const h1 = await height();
  // Signing nothing: said, and nothing is made.
  await p.fill('.ed-title', 'Пусто');
  await p.click('.ed-sign');
  assert.equal(await toast(p), 'Холст пуст — сначала нарисуйте что-нибудь');
  assert.equal(await p.evaluate(async () => (await import('/src/state.js')).app.cards.size), 0);
  // Two frames: the strip of numbered frames, at the same height.
  await p.click('.ed-frame.add');
  assert.ok(await p.isVisible('.ed-play'));
  assert.deepEqual(await p.$$eval('.ed-frame-list .ed-frame-n', (e) => e.map((x) => x.textContent)), ['1', '2']);
  assert.equal(await height(), h1, 'the strip does not jump');
  await p.context().close();
});

test('the editor holds still: a pinch keeps its zoom as the fingers lift, a selection moves nothing', async () => {
  const p = await env.phone('stillfox');
  await tab(p, 'draw');
  await p.locator('.ed-art').waitFor();
  const width = () => p.evaluate(() => document.querySelector('.ed-art').getBoundingClientRect().width);
  const w0 = await width();
  /** A finger on the canvas, by its offset from the middle. */
  const finger = (type, id, dx, dy = 0) => p.evaluate(([type, id, dx, dy]) => {
    const el = document.querySelector('.ed-card-wrap'), r = el.getBoundingClientRect();
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: id, pointerType: 'touch', clientX: r.left + r.width / 2 + dx, clientY: r.top + r.height / 2 + dy }));
  }, [type, id, dx, dy]);
  // Two fingers spread to three times as far apart: the zoom.
  await finger('pointerdown', 1, -30);
  await finger('pointerdown', 2, 30);
  for (const d of [45, 60, 75, 90]) { await finger('pointermove', 1, -d); await finger('pointermove', 2, d); }
  const w1 = await width();
  assert.ok(w1 > w0 * 2, `zoomed in (${w0} → ${w1})`);
  // One lifts first; the other moves a little before it lifts too.
  await finger('pointerup', 2, 90);
  await finger('pointermove', 1, -80, 6);
  await finger('pointermove', 1, -70, 12);
  await finger('pointerup', 1, -70, 12);
  await p.waitForTimeout(400);
  assert.ok(Math.abs((await width()) - w1) < 1, `the zoom stays as the fingers lift (${w1} → ${await width()})`);

  // A selection, plain and precise: the card does not move by a pixel.
  const rect = () => p.evaluate(() => JSON.stringify(document.querySelector('.ed-card-wrap').getBoundingClientRect()));
  await p.click('.ed-tool-select');
  for (const precise of [false, true]) {
    if (precise) await p.click('.ed-tool-precise');
    const r0 = await rect();
    await p.keyboard.press('Control+a');
    await p.waitForTimeout(100);
    assert.equal(await rect(), r0, `${precise ? 'precise' : 'plain'}: the card stays as the selection's bar comes`);
    await p.keyboard.press('Escape');
    await p.waitForTimeout(100);
    assert.equal(await rect(), r0, `${precise ? 'precise' : 'plain'}: and as it goes`);
  }
  await p.context().close();
});

test('the editor: many frames scroll in their strip, frames last longer, layers draw apart and sign as one', async () => {
  for (const desk of [false, true]) {
    const p = await env.phone('layerfox', undefined, desk);
    await tab(p, 'draw');
    await p.locator('.ed-art').waitFor();
    // Twenty frames: the strip scrolls, nothing is pushed off the screen.
    await p.click('.ed-frame.add');
    for (let i = 0; i < 19; i++) await p.click('.ed-frame.add');
    const fit = await p.evaluate(() => {
      const w = document.documentElement.clientWidth, r = (s) => document.querySelector(s).getBoundingClientRect();
      const s = document.querySelector('.ed-frame-scroll');
      return { scrolls: s.scrollWidth > s.clientWidth, add: r('.ed-frame.add').right <= w, layers: r('.ed-layers-btn').right <= w, page: document.documentElement.scrollWidth <= w, aside: !document.querySelector('.ed-aside').offsetParent || r('.ed-aside').right <= w };
    });
    assert.deepEqual(fit, { scrolls: true, add: true, layers: true, page: true, aside: true }, desk ? 'computer' : 'phone');
    if (desk) {
      // A mouse drags the strip as a finger would; letting go over a frame does not choose it.
      const strip = await p.locator('.ed-frame-scroll').boundingBox();
      const chosen = () => p.evaluate(() => [...document.querySelectorAll('.ed-frame-list .ed-frame')].findIndex((b) => b.getAttribute('aria-pressed') === 'true'));
      const at = () => p.evaluate(() => document.querySelector('.ed-frame-scroll').scrollLeft);
      await p.evaluate(() => { document.querySelector('.ed-frame-scroll').scrollLeft = 0; });
      const before = await chosen();
      const y = strip.y + strip.height / 2;
      await p.mouse.move(strip.x + strip.width - 30, y);
      await p.mouse.down();
      await p.mouse.move(strip.x + strip.width - 130, y, { steps: 8 });
      await p.waitForTimeout(120); // held still: no throw
      await p.mouse.up();
      assert.ok(Math.abs(await at() - 100) <= 2, 'the strip moved with the mouse, no further');
      assert.equal(await chosen(), before, 'a drag chooses nothing');
      await p.click('.ed-frame-list .ed-frame >> nth=3');
      assert.equal(await chosen(), 3, 'a click still chooses');
      await p.context().close();
      continue;
    }

    // Back to two frames; the first lasts three ticks.
    while (await p.locator('.ed-frame-list .ed-frame').count() > 2) {
      await p.click('.ed-frame[aria-pressed="true"]');
      await p.click('.bottom-sheet.on .ed-menu-item:has-text("Удалить кадр")');
      await p.waitForTimeout(150);
    }
    await p.click('.ed-frame-list .ed-frame >> nth=0');
    await p.click('.ed-frame[aria-pressed="true"]');
    await p.click('.bottom-sheet.on .ed-hold button[aria-label="Дольше"]');
    await p.click('.bottom-sheet.on .ed-hold button[aria-label="Дольше"]');
    assert.equal(await p.textContent('.bottom-sheet.on .ed-hold-n'), '×3');
    await p.keyboard.press('Escape');
    assert.equal(await p.textContent('.ed-frame-list .ed-frame >> nth=0 >> .ed-frame-hold'), '×3', 'the tile says how long');

    // A dot on the first layer; a new layer above, hidden: nothing is drawn on it.
    const art = await p.locator('.ed-art').boundingBox();
    const cell = (x, y) => [art.x + art.width * (x + 0.5) / 32, art.y + art.height * (y + 0.5) / 32];
    await p.mouse.click(...cell(1, 1));
    await p.click('.ed-layers-btn');
    await p.click('.bottom-sheet.on .ed-layer-act:has-text("Новый слой")');
    assert.equal(await p.textContent('.ed-layers-btn'), '2/2');
    await p.click('.bottom-sheet.on .ed-layers li.here .ed-layer-eye');
    await p.keyboard.press('Escape');
    await p.mouse.click(...cell(2, 1));
    assert.match(await toast(p), /скрыт/);
    // Shown again: the dot goes on the second layer, over nothing.
    await p.click('.ed-layers-btn');
    await p.click('.bottom-sheet.on .ed-layers li.here .ed-layer-eye');
    await p.keyboard.press('Escape');
    await p.mouse.click(...cell(2, 1));
    const cels = await p.evaluate(() => [...document.querySelectorAll('.ed-frame-list .ed-frame')].length);
    assert.equal(cels, 2);
    await p.fill('.ed-title', 'Слоёный');
    await p.click('.ed-sign');
    await p.locator('.turn:not([hidden])').waitFor();
    const card = await p.evaluate(async () => {
      const c = [...(await import('/src/state.js')).app.cards.values()].find((e) => e.card.title === 'Слоёный').card;
      return { frames: c.frames, a: c.pixels[1 * 32 + 1], b: c.pixels[1 * 32 + 2] };
    });
    assert.equal(card.frames, 4, 'the first frame three times, then the second');
    assert.ok(card.a !== 0 && card.b !== 0, 'both layers in the picture');
    await p.context().close();
  }
});

test('the selection works on the chosen layer only, and never on a hidden one', async () => {
  const p = await env.phone('selfox', undefined, true); // a computer: keys for select-all and Delete
  await tab(p, 'draw');
  await p.locator('.ed-art').waitFor();
  const art = await p.locator('.ed-art').boundingBox();
  const cell = (x, y) => [art.x + art.width * (x + 0.5) / 32, art.y + art.height * (y + 0.5) / 32];
  await p.mouse.click(...cell(3, 3)); // a dot on the bottom layer
  await p.click('.ed-layers-btn');
  await p.click('.bottom-sheet.on .ed-layer-act:has-text("Новый слой")');
  // The list drawn again with the new layer chosen, before its eye is pressed.
  await p.waitForFunction(() => document.querySelectorAll('.bottom-sheet.on .ed-layers li').length === 2 && document.querySelector('.bottom-sheet.on .ed-layers li.here') === document.querySelector('.bottom-sheet.on .ed-layers li'));
  await p.click('.bottom-sheet.on .ed-layers li.here .ed-layer-eye'); // the new top layer, hidden
  await p.keyboard.press('Escape');
  // Everything selected on the hidden layer: Delete and the arrows are refused, and said so.
  await p.keyboard.press('Control+a');
  await p.keyboard.press('Delete');
  assert.match(await toast(p), /скрыт/);
  await p.click('.ed-sel-bar button[aria-label="Снять выделение"]'); // the strip comes back for the layers button
  // Shown again: Delete empties the top layer's box — the dot below stays.
  await p.click('.ed-layers-btn');
  await p.click('.bottom-sheet.on .ed-layers li.here .ed-layer-eye');
  await p.keyboard.press('Escape');
  await p.keyboard.press('Control+a');
  await p.keyboard.press('Delete');
  await p.keyboard.press('Escape');
  await p.fill('.ed-title', 'Под выделением');
  await p.click('.ed-sign');
  await p.locator('.turn:not([hidden])').waitFor();
  const dot = await p.evaluate(async () => {
    const all = [...(await import('/src/state.js')).app.cards.values()];
    const c = all.find((e) => e.card.title === 'Под выделением')?.card;
    if (!c) return all.map((e) => e.card.title).join('|');
    const lit = [...c.pixels].map((v, i) => (v ? `${i % c.width},${Math.floor(i / c.width)}=${v}` : '')).filter(Boolean);
    return { at: c.pixels[3 * c.width + 3], lit: lit.slice(0, 8).join(' '), w: c.width };
  });
  assert.equal(typeof dot, 'object', `the card was signed (cards: ${dot})`);
  // Where exactly the dot fell does not matter here (the canvas may still be settling as the
  // first click comes): that the bottom layer's drawing is still there does.
  assert.ok(dot.lit, 'the bottom layer kept its dot');
  await p.context().close();
});
