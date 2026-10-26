// The app's journeys, end to end, with the real WebAssembly core.
// Run after scripts/build-wasm.sh: `npm ci && npm test` in this folder.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setup, photo, fromPicture, choose, tab, toast, heart, gradient, textMatching } from './helpers.mjs';

/** @type {Awaited<ReturnType<typeof setup>>} */
let env;
before(async () => { env = await setup(); });
after(async () => {
  await env.close();
  assert.deepEqual(env.errors, [], 'no errors in any page');
});

const words = (p) => p.evaluate(async () => (await import('/src/state.js')).app.identity.words());
const cards = (p) => p.evaluate(async () => (await import('/src/state.js')).app.cards.size);

/** Makes an own card from the heart picture; it opens large in the collection. */
async function ownCard(p, title) {
  await tab(p, 'import');
  await choose(p, () => p.click('.import-preview'), await heart(env.dir));
  await p.locator('.import-body input:not([type])').fill(title);
  await p.click('text=Подписать и добавить');
  await p.locator('.turn:not([hidden])').waitFor();
}
/** The card in front: its share sheet, its back. */
const act = (p, name) => p.click(`.action-bar.up [data-act="${name}"]`);
const backText = async (p) => {
  await act(p, 'turn');
  await p.waitForTimeout(700);
  return p.textContent('.turn .back-face');
};

test('a key restored from the words is the same key', async () => {
  const a = await env.phone('pixelfox');
  const b = await env.phone('pixelfox', (await words(a)).toUpperCase());
  const short = (p) => p.evaluate(async () => (await import('/src/state.js')).app.identity.publicKey().short);
  assert.equal(await short(b), await short(a));
  await a.context().close();
  await b.context().close();
});

test('import keeps its layout and reports what it did', async () => {
  const p = await env.phone('pixelfox');
  await tab(p, 'import');
  // Measured with the fonts in place and the sheet's entry animation over.
  await p.evaluate(() => Promise.all([document.fonts.ready, ...document.getAnimations().map((a) => a.finished)]));
  const buttonsAt = async () => (await p.locator('.import-actions').boundingBox())?.y;
  const empty = await buttonsAt();
  assert.ok(await p.locator('.import-actions .btn.key').isDisabled(), 'nothing to sign yet');

  // 512 colours: an own palette is fitted by itself, and said so.
  await choose(p, () => p.click('.import-preview'), await gradient(env.dir));
  assert.match(await textMatching(p, '.import-status', /подобрана своя палитра/), /больше 256 цветов файла → свои 32/);
  assert.equal(await p.inputValue('.import-body select'), 'fit:32');
  assert.ok(await p.locator('.import-actions .btn.key').isEnabled());
  assert.equal(await buttonsAt(), empty, 'the status does not move the buttons');

  await p.selectOption('.import-body select', { label: 'PICO-8 · 16' });
  assert.match(await textMatching(p, '.import-status', /палитра PICO-8 · 512 пикселей сменили цвет/), /палитра PICO-8 · 512 пикселей сменили цвет/);
  assert.equal(await buttonsAt(), empty);

  await choose(p, () => p.click('text=Другой файл'), await heart(env.dir));
  assert.match(await textMatching(p, '.import-status', /60×48 → 10×8 \(снято увеличение ×6\)/), /60×48 → 10×8 \(снято увеличение ×6\)/);
  assert.equal(await buttonsAt(), empty);
  await p.click('text=Подписать и добавить');
  await p.locator('.turn:not([hidden])').waitFor();
  assert.equal(await cards(p), 1);
  await p.context().close();
});

test('an import under way survives a look at another tab', async () => {
  const p = await env.phone('pixelfox');
  await tab(p, 'import');
  await choose(p, () => p.click('.import-preview'), await heart(env.dir));
  await p.locator('.import-body input:not([type])').fill('Сердце');
  await tab(p, 'receive');
  await tab(p, 'collection');
  await tab(p, 'import');
  assert.equal(await p.inputValue('.import-body input:not([type])'), 'Сердце', 'the title is kept');
  assert.ok(await p.locator('.import-actions .btn.key').isEnabled(), 'the picture is kept');
  await p.click('.import-view .bar .ib');
  assert.equal(await p.inputValue('.import-body input:not([type])'), '', 'start over clears it');
  assert.ok(await p.locator('.import-actions .btn.key').isDisabled());
  assert.equal(await cards(p), 0, 'nothing was signed on the way');
  await p.context().close();
});

test('a card goes from one phone to another and is checked on arrival', async () => {
  const a = await env.phone('pixelfox');
  const b = await env.phone('mossfern');
  await ownCard(a, 'Сердце');
  await act(a, 'share');
  const code = await photo(a, '.top-sheet .qr-box', env.dir, 'give');

  await tab(b, 'receive');
  await fromPicture(b, 'section.view:visible', code);
  // It opens large in the collection, where it now is.
  await b.locator('.turn:not([hidden])').waitFor();
  assert.equal(await toast(b), 'Карточка в коллекции');
  const back = await backText(b);
  assert.match(back, /верна/);
  assert.match(back, /@pixelfox → вам/);
  assert.equal(await cards(b), 1);

  // The same code again: recognised, not duplicated.
  await tab(b, 'receive');
  await fromPicture(b, 'section.view:visible', code);
  await b.waitForTimeout(500);
  assert.equal(await cards(b), 1);
  await a.context().close();
  await b.context().close();
});

test('damaged and forged codes are refused with their reason', async () => {
  const a = await env.phone('pixelfox');
  await ownCard(a, 'Сердце');
  const text = await a.evaluate(async () => {
    const s = await import('/src/state.js');
    const [e] = [...s.app.cards.values()];
    return s.app.core.qrPlan(s.app.identity.sealAsAuthor(e.rec.payload, undefined)).text;
  });
  const b = await env.phone('mossfern');
  await tab(b, 'receive');
  const paste = async (t) => {
    await b.evaluate(() => { document.querySelector('.toast span').textContent = ''; });
    await b.fill('section.view:visible .field input', t);
    await b.press('section.view:visible .field input', 'Enter');
    await b.waitForTimeout(300);
    return toast(b);
  };
  const flip = (at) => text.slice(0, at) + (text[at] === 'A' ? 'B' : 'A') + text.slice(at + 1);
  assert.match(await paste(flip(60)), /Код Pips, но повреждён/);
  assert.match(await paste(flip(text.length - 3)), /Подпись не сходится/);
  assert.match(await paste('hello'), /Это не код Pips/);
  assert.equal(await cards(b), 0);
  await a.context().close();
  await b.context().close();
});

test('numbered copies: issued once each, until the run is complete', async () => {
  const a = await env.phone('pixelfox');
  const b = await env.phone('mossfern');
  await ownCard(a, 'Сердце');
  await act(a, 'share');
  await a.click('.top-sheet button:text("Экземпляр №")');
  await a.fill('.edition-panel input', '2');

  await tab(b, 'receive');
  await b.click('text=Мой код получателя');
  const rc = await photo(b, '.overlay .qr-box', env.dir, 'recipient');
  await b.click('.overlay .icon-btn');

  for (const n of [1, 2]) {
    await a.click(`text=Выдать №${n}`);
    await fromPicture(a, '.overlay', rc);
    assert.match(await a.locator('.dialog').textContent(), new RegExp(`Выдать №${n} из 2 для @mossfern`));
    await a.click('.dialog button:text-is("Выдать")');
    const env1 = await photo(a, '.overlay .qr-box', env.dir, `copy${n}`);
    await a.click('text=Готово');
    if (n === 1) {
      await fromPicture(b, 'section.view:visible', env1);
      await b.locator('.turn:not([hidden])').waitFor();
      assert.match(await backText(b), /экземпляр 1 из 2 — ваш/);
      await tab(b, 'receive');
    }
  }
  assert.equal(await a.textContent('.edition-panel .hint'), 'Выдано 2 из 2');
  assert.ok(await a.locator('.edition-panel .btn').isDisabled());
  await a.context().close();
  await b.context().close();
});

test('the collection: tags, search, archive and the bin, all without gestures', async () => {
  const p = await env.phone('pixelfox');
  await tab(p, 'me');
  await p.click('text=Добавить образцы карточек');
  await p.locator('.collection-view:visible').waitFor();
  await p.waitForTimeout(800);
  const sub = async () => (await p.textContent('.collection-bar .level-switch')).split(' · ')[0];
  const inPlace = (st) => p.evaluate(async (x) => [...(await import('/src/state.js')).app.cards.values()].filter((e) => e.rec.state === x).length, st);
  const shown = () => p.$$eval('.on-stage', (els) => els.filter((e) => e.isConnected && Number(e.style.opacity) > 0.5).length);
  /** Clicks the first card fully on screen below the bar. */
  const clickCard = async () => {
    const at = await p.$$eval('.on-stage', (els) => els.map((e) => e.getBoundingClientRect()).filter((r) => r.top > 70 && r.bottom < 700 && r.width > 20)[0]);
    await p.mouse.click(at.x + at.width / 2, at.y + at.height / 2);
    await p.waitForTimeout(900);
  };
  assert.equal(await shown(), 22);
  assert.equal(await sub(), 'по неделям');
  await p.click('.collection-bar .level-switch');
  await p.waitForTimeout(900);
  assert.equal(await sub(), 'по месяцам', 'the months are a tap away');
  await p.click('.collection-bar .level-switch');
  await p.waitForTimeout(900);

  // A card opens: feed, then the card itself; a tag goes on its back.
  await clickCard();
  assert.equal(await sub(), 'лента');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(900);
  assert.equal(await sub(), 'по неделям');
  await clickCard();
  await act(p, 'turn');
  await p.waitForTimeout(800);
  assert.equal(await sub(), 'карточка');
  // A press on the card's left half turns it the other way.
  const flip = async () => Math.round(Number(await p.$eval('.turn-flip', (e) => e.dataset.angle)) / 180) * 180;
  const before = await flip();
  const card = await p.locator('.turn').boundingBox();
  await p.mouse.click(card.x + card.width * 0.2, card.y + card.height * 0.9);
  await p.waitForTimeout(900);
  assert.equal(await flip(), before - 180, 'left half: the other way');
  await p.mouse.click(card.x + card.width * 0.8, card.y + card.height * 0.9);
  await p.waitForTimeout(900);
  assert.equal(await flip(), before, 'right half: back again');
  assert.ok(await p.$eval('.turn textarea', (t) => t.readOnly), 'nothing to type before the pencil');
  await p.click('.turn .pen');
  await p.click('.turn .tag.add');
  await p.keyboard.type('Ночные Совы');
  await p.keyboard.press('Enter');
  await p.click('.turn .pen');
  await p.waitForTimeout(100);
  assert.match(await p.textContent('.turn .tags'), /#ночные-совы/);

  // The tag on the back is a filter: every card with it, in the months.
  await p.click('.turn .tag');
  await p.waitForTimeout(1200);
  assert.equal(await sub(), 'по месяцам');
  assert.equal(await p.inputValue('.search-field input'), '#ночные-совы');
  assert.equal(await shown(), 1);
  await p.click('.search-field .clear');
  await p.waitForTimeout(900);
  assert.equal(await shown(), 22);
  await p.click('.seg button[data-value="mine"]');
  await p.waitForTimeout(900);
  assert.equal(await shown(), 5, 'the five own sample cards');
  // Quickly to an empty set and back: the months start right under the
  // search again, with no room left for "nothing found".
  await p.fill('.search-field input', 'pixelfox');
  await p.click('.seg button[data-value="got"]');
  await p.click('.seg button[data-value="mine"]');
  await p.waitForTimeout(900);
  const gap = await p.evaluate(() => Math.min(...[...document.querySelectorAll('.on-stage')].filter((e) => Number(e.style.opacity) > 0.9)
    .map((e) => e.getBoundingClientRect().top)) - document.querySelector('.search-panel').getBoundingClientRect().bottom);
  assert.ok(gap >= 0 && gap < 30, `months right under the search (gap ${gap})`);
  assert.ok(!(await p.isVisible('.search-none')));
  await p.click('.search-field .clear');
  await p.click('.seg button[data-value="all"]');
  await p.waitForTimeout(900);

  // To the archive from the feed's bar, back with undo, then for good.
  await clickCard();
  await act(p, 'down');
  await p.waitForTimeout(2200);
  assert.equal(await toast(p), 'Карточка в архиве');
  assert.equal(await inPlace('collection'), 21);
  await p.click('.toast button');
  await p.waitForTimeout(900);
  assert.equal(await inPlace('collection'), 22, 'undone');
  await act(p, 'down');
  await p.waitForTimeout(2200);
  assert.equal(await p.textContent('.collection-bar .ib[aria-label="Архив"] .ib-badge'), '1');

  // The archive is a place like the collection: the card opens there too.
  await p.click('.collection-bar .ib[aria-label="Архив"]');
  await p.waitForTimeout(900);
  assert.equal(await p.textContent('.collection-bar h1'), 'Архив');
  assert.equal(await shown(), 1);
  await clickCard();
  await act(p, 'trash');
  await p.waitForTimeout(900);
  assert.equal(await toast(p), 'Карточка в корзине');
  assert.match(await p.textContent('.place-empty'), /В архиве пусто/);
  await p.click('.collection-bar .ib[aria-label="Назад"]');
  await p.waitForTimeout(900);
  await p.click('.collection-bar .ib[aria-label="Корзина"]');
  await p.waitForTimeout(900);
  assert.match(await p.textContent('.collection-bar .level-switch'), /удаляются через 30 дней/);
  await p.click('.collection-bar .pill');
  await clickCard();
  await p.click('.action-bar.up [data-act="purge"]');
  await p.click('.dialog button:text-is("Удалить")');
  await p.waitForTimeout(900);
  assert.equal(await cards(p), 21);
  await p.context().close();
});

test('on a computer, a mouse and the keys reach every level', async () => {
  const p = await env.phone('deskfox', undefined, true);
  await tab(p, 'me');
  await p.click('text=Добавить образцы карточек');
  await p.locator('.collection-view:visible').waitFor();
  await p.waitForTimeout(800);
  const level = () => p.$eval('.stage-host', (e) => Number(e.dataset.level));
  const centre = () => p.$eval('.stage-host .on-stage.centre', (e) => [...e.parentElement.children].indexOf(e));
  const settle = () => p.waitForTimeout(800);
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
  await p.waitForTimeout(1800);
  const ys = await p.evaluate(() => window.__ys);
  assert.ok(Math.max(...ys) <= ys[0] + 1, `the neighbour never drops below where it was (${ys[0]} → max ${Math.max(...ys)})`);
  await p.context().close();
});

test('the editor: drawing, undo that loses nothing, palettes, frames, a draft, signing', async () => {
  const p = await env.phone('drawfox', undefined, true);
  await tab(p, 'draw');
  await p.locator('.ed-art').waitFor();
  await p.waitForTimeout(400);
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
  assert.equal(await undoLabel(), 'Отменить: карандаш');
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
  assert.equal(await undoLabel(), 'Отменить: другая палитра');

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
  assert.match(await undoLabel(), /название/);

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

test('a backup restores cards, notes and the copy log, only for its key', async () => {
  const a = await env.phone('pixelfox');
  await tab(a, 'me');
  await a.click('text=Добавить образцы карточек');
  await a.waitForTimeout(1500);
  await a.evaluate(async () => {
    const s = await import('/src/state.js');
    const [d1, d2] = [...s.app.cards.keys()];
    await s.setNote(d1, 'заметка с фестиваля');
    await s.setTags(d1, ['фестиваль', 'совы']);
    await s.move(d2, 'archive');
  });
  await tab(a, 'collection');
  await tab(a, 'me');
  const status = () => a.locator('.group:has(h2:text("Резервная копия")) .hint').first().textContent();
  assert.match(await status(), /Копии ещё нет/);
  const [download] = await Promise.all([a.waitForEvent('download'), a.click('text=Сохранить копию')]);
  const file = join(env.dir, download.suggestedFilename());
  await download.saveAs(file);
  assert.match(await status(), /Последняя: .*, 22 карточки/, 'the status updates at once');

  const restore = async (p, f) => {
    await choose(p, () => p.click('.group:has(h2:text("Резервная копия")) >> text=Восстановить'), f);
    await p.waitForTimeout(800);
    return toast(p);
  };
  const b = await env.phone('новый телефон', await words(a));
  await tab(b, 'me');
  assert.equal(await restore(b, file), 'Восстановлено: 22');
  const facts = await b.evaluate(async () => {
    const s = await import('/src/state.js');
    const r = [...s.app.cards.values()].map((e) => e.rec);
    return { notes: r.filter((x) => x.note).length, tags: r.flatMap((x) => x.tags ?? []).join(' '), archived: r.filter((x) => x.state === 'archive').length, nick: s.app.profile.nick };
  });
  assert.deepEqual(facts, { notes: 1, tags: 'фестиваль совы', archived: 1, nick: 'pixelfox' });
  assert.match(await b.locator('.group:has(h2:text("Резервная копия")) .hint').first().textContent(), /Последняя/);

  const c = await env.phone('чужой');
  await tab(c, 'me');
  assert.match(await restore(c, file), /Это копия другого ключа/);
  const bytes = await readFile(file);
  bytes[bytes.length - 5] ^= 1;
  await writeFile(join(env.dir, 'bad.pipsbak'), bytes);
  assert.match(await restore(b, join(env.dir, 'bad.pipsbak')), /Копия повреждена/);
  for (const p of [a, b, c]) await p.context().close();
});
