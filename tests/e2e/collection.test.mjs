// The collection: its levels and how fingers, a mouse and keys move between
// them; the feed; the archive, its strip and the flights to it; the bin.
// Run after scripts/build-wasm.sh: `npm ci && npm test` in this folder.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suite, tab, toast, textMatching, samples, words, cards, ownCard, act, still, overlaps, until, visible } from './helpers.mjs';

const env = suite();

test('the collection: tags, search, archive and the bin, all without gestures', async () => {
  const p = await env.phone('pixelfox');
  await tab(p, 'me');
  await samples(p);
  await p.locator('.collection-view:visible').waitFor();
  await still(p);
  const sub = async () => (await p.textContent('.collection-bar .level-switch')).split(' · ')[0];
  const inPlace = (st) => p.evaluate(async (x) => [...(await import('/src/state.js')).app.cards.values()].filter((e) => e.rec.state === x).length, st);
  // In the set: not fading out. A card past the screen's edge is not drawn at all (no opacity written yet).
  const shown = () => p.$$eval('.on-stage', (els) => els.filter((e) => e.isConnected && (e.style.opacity === '' || Number(e.style.opacity) > 0.5)).length);
  /** Clicks the first card fully on screen below the bar. */
  const clickCard = async () => {
    const at = await p.$$eval('.on-stage', (els) => els.map((e) => e.getBoundingClientRect()).filter((r) => r.top > 70 && r.bottom < 700 && r.width > 20)[0]);
    await p.mouse.click(at.x + at.width / 2, at.y + at.height / 2);
    await still(p);
  };
  assert.equal(await shown(), 18);
  assert.equal(await sub(), 'по неделям');
  await p.click('.collection-bar .level-switch');
  await still(p);
  assert.equal(await sub(), 'по месяцам', 'the months are a tap away');
  await p.click('.collection-bar .level-switch');
  await still(p);

  // A card opens: feed, then the card itself; a tag goes on its back.
  await clickCard();
  assert.equal(await sub(), 'лента');
  await p.keyboard.press('Escape');
  await still(p);
  assert.equal(await sub(), 'по неделям');
  await clickCard();
  await act(p, 'turn');
  await still(p);
  assert.equal(await sub(), 'карточка');
  // A press on the card's left half turns it the other way.
  const flip = async () => Math.round(Number(await p.$eval('.turn-flip', (e) => e.dataset.angle)) / 180) * 180;
  const before = await flip();
  const card = await p.locator('.turn').boundingBox();
  await p.mouse.click(card.x + card.width * 0.2, card.y + card.height * 0.9);
  await still(p);
  assert.equal(await flip(), before - 180, 'left half: the other way');
  await p.mouse.click(card.x + card.width * 0.8, card.y + card.height * 0.9);
  await still(p);
  assert.equal(await flip(), before, 'right half: back again');
  assert.ok(await p.$eval('.turn textarea', (t) => t.readOnly), 'nothing to type before the pencil');
  await p.click('.turn .pen');
  await p.click('.turn .tag.add');
  await p.keyboard.type('Ночные Совы');
  await p.keyboard.press('Enter');
  await p.click('.turn .pen');
  assert.match(await textMatching(p, '.turn .tags', /#ночные-совы/), /#ночные-совы/);

  // The tag on the back is a filter: every card with it, in the months.
  await p.click('.turn .tag');
  await still(p);
  assert.equal(await sub(), 'по месяцам');
  assert.equal(await p.inputValue('.search-field input'), '#ночные-совы');
  assert.equal(await shown(), 1);
  await p.click('.search-field .clear');
  await still(p);
  assert.equal(await shown(), 18);
  await p.click('.seg button[data-value="mine"]');
  await still(p);
  assert.equal(await shown(), 5, 'the five own sample cards');
  // Quickly to an empty set and back: the months start right under the
  // search again, with no room left for "nothing found".
  await p.fill('.search-field input', 'pixelfox');
  await p.click('.seg button[data-value="got"]');
  await p.click('.seg button[data-value="mine"]');
  await still(p);
  const gap = await p.evaluate(() => Math.min(...[...document.querySelectorAll('.on-stage')].filter((e) => Number(e.style.opacity) > 0.9)
    .map((e) => e.getBoundingClientRect().top)) - document.querySelector('.search-panel').getBoundingClientRect().bottom);
  assert.ok(gap >= 0 && gap < 30, `months right under the search (gap ${gap})`);
  assert.ok(!(await p.isVisible('.search-none')));
  await p.click('.search-field .clear');
  await p.click('.seg button[data-value="all"]');
  await still(p);

  // To the archive from the feed's bar, back with undo, then for good.
  await clickCard();
  await act(p, 'down');
  await still(p);
  assert.equal(await toast(p), 'Карточка в архиве');
  assert.equal(await inPlace('collection'), 17);
  await p.click('.toast button');
  await still(p);
  assert.equal(await inPlace('collection'), 18, 'undone');
  await act(p, 'down');
  await still(p);
  // Beside one card, the places stay out of the bar: a bin there would read as «delete this».
  assert.ok(!(await p.isVisible('.collection-bar .ib[aria-label="Архив"]')), 'no places in the feed');
  await p.keyboard.press('Escape');
  await still(p);
  assert.equal(await p.textContent('.collection-bar .ib[aria-label="Архив"] .ib-badge'), '1');

  // The archive is a place like the collection: the card opens there too.
  await p.click('.collection-bar .ib[aria-label="Архив"]');
  await still(p);
  assert.equal(await p.textContent('.collection-bar h1'), 'Архив');
  assert.equal(await shown(), 1);
  await clickCard();
  await act(p, 'trash');
  await still(p);
  assert.equal(await toast(p), 'Карточка в корзине');
  assert.match(await p.textContent('.place-empty'), /В архиве пусто/);
  await p.click('.collection-bar .ib[aria-label="Назад"]');
  await still(p);
  await p.click('.collection-bar .ib[aria-label="Корзина"]');
  await still(p);
  assert.match(await p.textContent('.collection-bar .level-switch'), /удаляются через 30 дней/);
  await p.click('.collection-bar .pill');
  await clickCard();
  await p.click('.action-bar.up [data-act="purge"]');
  await p.click('.dialog button:text-is("Удалить")');
  await still(p);
  assert.equal(await cards(p), 17);
  await p.context().close();
});

test('on a computer, a mouse and the keys reach every level', async () => {
  const p = await env.phone('deskfox', undefined, true);
  await tab(p, 'me');
  await samples(p);
  await p.locator('.collection-view:visible').waitFor();
  await still(p);
  const level = () => p.$eval('.stage-host', (e) => Number(e.dataset.level));
  const centre = () => p.$eval('.stage-host .on-stage.centre', (e) => [...e.parentElement.children].indexOf(e));
  const settle = () => still(p);
  assert.equal(await level(), 1);
  await p.click('.collection-bar .zoom [aria-label="Дальше"]');
  await settle();
  assert.equal(await level(), 0, 'minus: the months');
  assert.ok(await p.$eval('.collection-bar .zoom [aria-label="Дальше"]', (b) => b.disabled), 'no further than the months');
  await p.click('.collection-bar .zoom [aria-label="Ближе"]');
  await p.click('.collection-bar .zoom [aria-label="Ближе"]');
  await settle();
  assert.equal(await level(), 2, 'plus, twice: the feed');
  assert.ok(await p.isVisible('.feed-nav'), 'arrows along the feed');
  await p.keyboard.press('Home'); // from the first card, so there is a next one
  await settle();
  assert.ok(await p.$eval('.feed-nav [aria-label="Предыдущая карточка"]', (b) => b.disabled), 'Home: the first card');
  const c0 = await centre();
  await p.click('.feed-nav [aria-label="Следующая карточка"]');
  await p.mouse.move(720, 450);
  await p.mouse.wheel(0, 100);
  await settle();
  assert.notEqual(await centre(), c0, 'the arrow and the wheel leaf through');
  await p.keyboard.press('ArrowLeft');
  await p.keyboard.press('ArrowLeft');
  await settle();
  assert.equal(await centre(), c0, 'and the arrow keys back');
  await p.keyboard.press('Enter');
  await settle();
  assert.equal(await level(), 3, 'Enter opens the card');
  await p.keyboard.press(' ');
  await settle();
  assert.equal(await p.$eval('.turn-flip', (e) => Math.abs(Number(e.dataset.angle)) % 360), 180, 'Space turns it');
  await p.keyboard.press('Escape');
  await p.keyboard.press('Escape');
  await settle();
  assert.equal(await level(), 1, 'Esc steps back');
  await p.keyboard.down('Control');
  await p.mouse.wheel(0, -100);
  await p.keyboard.up('Control');
  await settle();
  assert.equal(await level(), 2, 'ctrl + a wheel notch: one level closer');

  // Pulled down, the card flies to the archive; its neighbour takes the
  // middle in one glide — the pull is not handed over to it on landing.
  await p.evaluate(() => {
    const c = document.querySelector('.stage-host .on-stage.centre');
    const next = /** @type {HTMLElement} */ (c.nextElementSibling);
    const ys = (window.__ys = []);
    const t0 = performance.now();
    const f = () => { ys.push(Number(next.style.transform.split(',')[1]?.replace('px', ''))); if (performance.now() - t0 < 1600) requestAnimationFrame(f); };
    requestAnimationFrame(f);
  });
  const box = await p.$eval('.stage-host .on-stage.centre', (e) => { const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
  await p.mouse.move(box.x, box.y);
  await p.mouse.down();
  for (let i = 1; i <= 12; i++) await p.mouse.move(box.x, box.y + i * 30);
  await p.mouse.up();
  await still(p);
  const ys = await p.evaluate(() => window.__ys);
  assert.ok(Math.max(...ys) <= ys[0] + 1, `the neighbour never drops below where it was (${ys[0]} → max ${Math.max(...ys)})`);
  await p.context().close();
});

test('nothing on screen covers anything else, and the hint shows only when it applies', async () => {
  for (const desk of [false, true]) {
    const p = await env.phone('pixelfox', undefined, desk);
    await p.locator('.first-run').waitFor();
    // An empty collection: nothing to zoom, so no word about zooming.
    assert.ok(await p.locator('.first-run').isVisible());
    assert.equal(await p.locator('.coach').isVisible(), false, 'no zoom hint without cards');
    for (const t of ['me', 'receive', 'give', 'draw']) {
      await tab(p, t);
      assert.deepEqual(await overlaps(p), [], `${t}, ${desk ? 'computer' : 'phone'}`);
    }
    // Two-up rows keep their labels on one line.
    await tab(p, 'me');
    // The profile draws its groups once it has read them, the developer's last;
    // what is folded away in it has no box and is not looked at.
    await p.locator('section.view:not([hidden]) .group.developer > *').first().waitFor();
    // Measured in one go: the profile may draw a group again between two questions.
    const twoUp = await visible(p, 'section.view:not([hidden]) .row-btns .btn');
    assert.ok(twoUp.length >= 2, 'there are two-up rows to look at');
    for (const b of twoUp) assert.ok(b.box[3] - b.box[1] <= 50, b.label);
    await samples(p);
    await tab(p, 'collection');
    await still(p);
    // With cards: the hint, clear of the scan button; gone once used.
    assert.ok(await p.locator('.coach').isVisible(), 'the zoom hint, now that there is somewhere to go');
    assert.deepEqual(await overlaps(p), []);
    await p.keyboard.press('-'); // a step out: weeks → months
    await still(p);
    assert.equal(await p.locator('.coach').isVisible(), false, 'learnt: gone');
    await p.reload();
    await p.locator('nav.tabs').waitFor();
    await still(p);
    assert.equal(await p.locator('.coach').isVisible(), false, 'and stays gone');
    await p.context().close();
  }
});

// Under the title, the level and how many cards: a switch to the months, so
// it is read, not cut. Where «по неделям · 18 карточек» does not fit (320
// and 360 px phones), the word goes and the number stays.
test('the level and the count under the title are whole on every phone', async () => {
  const p = await env.phone('pixelfox');
  await tab(p, 'me');
  await samples(p);
  for (const [w, said] of [[320, 'по неделям · 18'], [360, 'по неделям · 18'], [390, 'по неделям · 18 карточек']]) {
    await p.setViewportSize({ width: w, height: 700 });
    await tab(p, 'collection');
    await still(p);
    const sub = await p.$eval('.collection-bar .level-switch', (e) => ({ text: e.innerText, cut: e.scrollWidth > e.clientWidth }));
    assert.deepEqual(sub, { text: said, cut: false }, `${w} px across`);
  }
  await p.context().close();
});

test('the tab bar waits for the card to land in the archive and the strip to go', async () => {
  const p = await env.phone('pixelfox');
  await ownCard(p, 'Последняя', env.dir);
  // Watch the page itself, not a stopwatch: when the strip goes down, and
  // when the tabs come back. Timings differ from machine to machine; the
  // order must not.
  await p.evaluate(() => {
    const w = /** @type {any} */ (window), tabs = document.querySelector('nav.tabs'), strip = document.querySelector('.strip');
    w.seen = { stripDown: 0, tabsBack: 0, flying: false };
    new MutationObserver(() => { if (!tabs?.classList.contains('away') && !w.seen.tabsBack && w.seen.flying) w.seen.tabsBack = performance.now(); })
      .observe(/** @type {Element} */ (tabs), { attributes: true });
    new MutationObserver(() => {
      const up = !/101%/.test(/** @type {HTMLElement} */ (strip).style.transform);
      if (up) w.seen.flying = true;
      else if (w.seen.flying && !w.seen.stripDown) w.seen.stripDown = performance.now();
    }).observe(/** @type {Element} */ (strip), { attributes: true, attributeFilter: ['style'] });
  });
  await act(p, 'down'); // the only card: to the archive, from the feed
  await p.waitForFunction(() => /** @type {any} */ (window).seen.tabsBack > 0, null, { timeout: 6000 });
  const seen = await p.evaluate(() => /** @type {any} */ (window).seen);
  assert.ok(seen.stripDown > 0, 'the strip showed, then went down');
  // (In the same moment counts: both change in one step.)
  assert.ok(seen.tabsBack >= seen.stripDown - 5, `the tabs came back only as the strip went (${JSON.stringify(seen)})`);
  assert.equal(await p.evaluate(async () => [...(await import('/src/state.js')).app.cards.values()][0].rec.state), 'archive');
  await p.context().close();
});

test('an animated card holds still in the grid, with a mark, and plays when looked at', async () => {
  const p = await env.phone('pixelfox');
  await tab(p, 'me');
  await samples(p);
  await tab(p, 'collection');
  await still(p);
  const id = await p.evaluate(async () => [...(await import('/src/state.js')).app.cards.values()].find((e) => e.card.title === 'Кораблик')?.rec.digest);
  const art = `.on-stage .art canvas[data-art="${id}"]`;
  const pixels = () => p.$eval(art, (cv) => /** @type {HTMLCanvasElement} */ (cv).toDataURL());
  // The grid: the first frame, still, and the mark in the corner.
  assert.ok(await p.isVisible(`.on-stage .art:has(${art.split(' ').pop()}) .anim-mark`), 'marked as animated');
  const firstFrame = await pixels();
  await p.waitForTimeout(800); // a while, in which an animation would have moved on
  assert.equal(await pixels(), firstFrame, 'still in the grid');
  // Looked at: it plays (the boat rocks, the waves move).
  await p.locator(art).scrollIntoViewIfNeeded();
  const box = await p.locator(art).boundingBox();
  await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await still(p);
  const seen = new Set();
  for (let k = 0; k < 6; k++) { seen.add(await pixels()); await p.waitForTimeout(170); }
  assert.ok(seen.size > 1, 'it plays in the feed');
  // Back to the grid: still again, on its first frame.
  await p.keyboard.press('Escape');
  await still(p);
  assert.equal(await pixels(), firstFrame, 'the first frame again');
  await p.context().close();
});

test('the feed under a finger: held still before lifting it stays, a flick carries on', async () => {
  const p = await env.phone('flickfox');
  await tab(p, 'me');
  await samples(p);
  await tab(p, 'collection');
  await still(p);
  await p.keyboard.press('+');
  await still(p);
  const centre = () => p.$eval('.stage-host .on-stage.centre', (e) => [...e.parentElement.children].indexOf(e));
  /** A touch across the feed: `dx` in `ms`, then `hold` ms without moving before the lift. */
  const swipe = (dx, ms, hold = 0) => p.evaluate(async ([dx, ms, hold]) => {
    const host = document.querySelector('.stage-host'), x0 = 195 - dx / 2, y = 400;
    const fire = (type, x) => host.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 9, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y }));
    fire('pointerdown', x0);
    for (let i = 1; i <= 10; i++) { await new Promise((r) => setTimeout(r, ms / 10)); fire('pointermove', x0 + (dx * i) / 10); }
    await new Promise((r) => setTimeout(r, hold));
    fire('pointerup', x0 + dx);
  }, [dx, ms, hold]);
  const settle = () => still(p);

  const c0 = await centre();
  // Fast across a third of a card, then held: no throw, back where it was.
  await swipe(-60, 60, 250);
  await settle();
  assert.equal(await centre(), c0, 'a finger that stopped throws nothing');
  // A short quick swipe: one card on.
  await swipe(-60, 80);
  await settle();
  assert.equal(await centre(), c0 + 1, 'a swipe: the next card');
  // A hard flick: several cards.
  await swipe(-260, 70);
  await settle();
  assert.ok((await centre()) >= c0 + 4, `a flick carries on (now ${await centre()})`);
  await p.context().close();
});

test('the archive strip goes away after an undo, even when the write takes its time', async () => {
  const p = await env.phone('stripfox');
  await tab(p, 'me');
  await samples(p);
  await tab(p, 'collection');
  await still(p);
  await p.keyboard.press('+'); // the feed
  await still(p);
  // A slow phone: every write lands 1.5 s after it was asked for.
  await p.evaluate(() => {
    const d = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete');
    Object.defineProperty(IDBTransaction.prototype, 'oncomplete', {
      configurable: true,
      get() { return d.get.call(this); },
      set(f) { d.set.call(this, f && ((e) => setTimeout(() => f.call(this, e), /** @type {any} */ (window).slowWrites ?? 0))); },
    });
  });
  const stripUp = () => p.evaluate(() => {
    const r = document.querySelector('section.view:not([hidden]) .strip').getBoundingClientRect();
    return r.top < innerHeight;
  });
  const title = await p.$eval('.stage-host .on-stage.centre .cap b', (e) => e.textContent);
  await p.click('section.view:not([hidden]) .action-bar.up button[data-act="down"]');
  await p.locator('.toast:not([hidden]) button').waitFor();
  assert.ok(await stripUp(), 'the strip shows where the card went');
  // Undone at once, while the strip is still up; the write is slow.
  await p.evaluate(() => { /** @type {any} */ (window).slowWrites = 1500; });
  await p.click('.toast button');
  await until(async () => !(await stripUp()), 'the strip went down');
  assert.equal(await p.$eval('.stage-host .on-stage.centre .cap b', (e) => e.textContent), title, 'the card is back in the feed');
  await p.context().close();
});

test('the keyboard: a sheet holds focus, Escape closes only what is on top, focus comes back', async () => {
  const p = await env.phone('keyfox');
  await tab(p, 'draw');
  await p.locator('.ed-art').waitFor();
  // A dot in the corner, so that a smaller canvas would cut it off.
  const art = await p.locator('.ed-art').boundingBox();
  await p.mouse.click(art.x + 3, art.y + 3);
  // Reached with the keyboard (a step back and forth), as Tab would.
  await p.focus('.ed-tool-more');
  await p.keyboard.press('Shift+Tab');
  await p.keyboard.press('Tab');
  await p.keyboard.press('Enter');
  await still(p);
  const inside = (sel) => p.evaluate((sel) => !!document.activeElement?.closest(sel), sel);
  assert.ok(await inside('.bottom-sheet.on'), 'focus went into the sheet');
  for (let i = 0; i < 25; i++) await p.keyboard.press('Tab');
  assert.ok(await inside('.bottom-sheet.on'), 'Tab goes round inside it');
  await p.click('.bottom-sheet.on .ed-set-row .seg button:text-is("16")');
  await p.locator('.dialog').waitFor();
  assert.ok(await inside('.dialog'), 'the question takes focus');
  await p.keyboard.press('Escape');
  assert.equal(await p.locator('.dialog').count(), 0, 'Escape answers the question…');
  assert.equal(await p.locator('.bottom-sheet.on').count(), 1, '…and leaves the sheet under it');
  await p.keyboard.press('Escape');
  await still(p);
  assert.equal(await p.locator('.bottom-sheet.on').count(), 0, 'the next one closes the sheet');
  assert.ok(await p.isVisible('.ed-tools'), 'the editor stayed');
  assert.ok(await p.evaluate(() => document.activeElement?.classList.contains('ed-tool-more')), 'focus is back where it was');
  await p.context().close();
});

test('a chosen card scrolled far off the screen flies to the archive from where it really is', async () => {
  const p = await env.phone('pixelfox');
  await tab(p, 'me');
  await samples(p);
  await p.locator('.collection-view:visible').waitFor();
  await still(p);
  await p.click('section.view:visible >> text=Выбрать');
  const first = await p.$$eval('.on-stage', (els) => els.map((e) => e.getBoundingClientRect()).filter((r) => r.width > 20 && r.top > 60).sort((a, b) => a.top - b.top || a.left - b.left)[0]);
  await p.mouse.click(first.x + first.width / 2, first.y + first.height / 2);
  // Off the top in two goes: hidden once past the edge (not drawn there), then much further.
  await p.mouse.move(200, 500);
  for (let i = 0; i < 2; i++) { await p.mouse.wheel(0, 1200); await still(p); }
  assert.equal(await p.$eval('.on-stage.chosen', (e) => e.style.visibility), 'hidden', 'past the edge, not shown where it was');
  await p.click('.action-bar.up [data-act="archive"]');
  await p.locator('.fly-layer .on-stage').waitFor({ state: 'attached' });
  // Where its flight starts: the first frame drawn after the press.
  const top = await p.$eval('.fly-layer .on-stage', (e) => new Promise((ok) => requestAnimationFrame(() => ok(e.getBoundingClientRect().top))));
  assert.ok(top < -first.height * 2, `it starts far above the screen, not where it was last seen: ${top}`);
  await p.context().close();
});

test('the opened card goes to the archive over the strip, face up — turned over or not', async () => {
  const p = await env.phone('pixelfox');
  await tab(p, 'me');
  await samples(p);
  await p.locator('.collection-view:visible').waitFor();
  await still(p);
  for (let i = 0; i < 3; i++) { await p.keyboard.press('+'); await still(p); }
  await act(p, 'turn');
  await still(p);
  const side = () => p.$eval('.turn-flip', (e) => Math.round(Math.abs(Number(e.dataset.angle)) / 180) * 180 % 360);
  assert.equal(await side(), 180, 'its back is up');
  await act(p, 'down');
  await p.waitForTimeout(450); // well before it lands
  assert.equal(await side(), 0, 'face up again while it flies');
  assert.ok(await p.$eval('.turn', (e) => !!e.closest('.fly-layer')), 'over the archive strip it lands on, not under it');
  // Face up from the start, the next one too: over the strip all the way down.
  await still(p);
  await act(p, 'down');
  const over = [];
  for (let i = 0; i < 6; i++) { await p.waitForTimeout(90); over.push(await p.$eval('.turn', (e) => e.hidden || !!e.closest('.fly-layer') || !document.querySelector('.fly-layer .on-stage'))); } // landed: the next card, back in the stage
  assert.deepEqual(over, over.map(() => true), 'never under the strip while it flies');
  await p.context().close();
});

test('a feed card pulled down by a finger lies over the archive strip, before and after it is let go', async () => {
  const p = await env.phone('pullfox');
  await tab(p, 'me');
  await samples(p);
  await tab(p, 'collection');
  await still(p);
  await p.keyboard.press('+');
  await still(p);
  // Down, and held there: the strip has risen under the card.
  await p.evaluate(async () => {
    const host = document.querySelector('.stage-host');
    const fire = (type, y) => host.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: 195, clientY: y }));
    fire('pointerdown', 380);
    for (let i = 1; i <= 12; i++) { await new Promise((r) => setTimeout(r, 25)); fire('pointermove', 380 + i * 30); }
  });
  // The finger stays down, so things never come to rest (the card is held): wait for the state itself.
  const held = () => p.evaluate(() => {
    const c = document.querySelector('.on-stage.centre');
    return { over: !!c?.closest('.fly-layer'), strip: !/101%/.test(/** @type {HTMLElement} */ (document.querySelector('.strip')).style.transform) };
  });
  await until(async () => { const h = await held(); return h.over && h.strip; }, 'while held: the card over the strip that rose for it').catch(() => {});
  assert.deepEqual(await held(), { over: true, strip: true }, 'while held: the card over the strip that rose for it');
  // The empty archive says so, from where its title starts; the words stay while nothing is on its way.
  const words = await p.evaluate(() => {
    const e = /** @type {HTMLElement} */ (document.querySelector('.strip-empty')), b = /** @type {HTMLElement} */ (document.querySelector('.strip-head b'));
    return { gone: e.classList.contains('gone'), lined: Math.abs(e.getBoundingClientRect().left - b.getBoundingClientRect().left) < 1 };
  });
  assert.deepEqual(words, { gone: false, lined: true });
  // Let go a little up the way: it goes back into the feed, and back into the stage.
  await p.evaluate(() => document.querySelector('.stage-host').dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 7, pointerType: 'touch', isPrimary: true })));
  await still(p);
  assert.ok(await p.$eval('.on-stage.centre', (e) => !!e.closest('.stage-host')), 'back in its place in the feed');
  await p.context().close();
});
