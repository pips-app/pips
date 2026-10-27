// The app's journeys, end to end, with the real WebAssembly core.
// Run after scripts/build-wasm.sh: `npm ci && npm test` in this folder.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setup, photo, fromPicture, choose, tab, toast, heart, gradient, wide, textMatching, samples } from './helpers.mjs';

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
  // The file is read in the background and puts its name in the title:
  // type over it only after that, as a person would.
  await p.waitForFunction(() => document.querySelector('.import-body input:not([type])')?.value === 'heart-x6');
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

test('restoring on a new phone: the backup and the key in one step', async () => {
  const short = (p) => p.evaluate(async () => (await import('/src/state.js')).app.identity.publicKey().short);
  const a = await env.phone('pixelfox');
  await tab(a, 'me');
  await samples(a);
  await a.waitForTimeout(1500);
  await a.evaluate(async () => {
    const s = await import('/src/state.js');
    await s.setProfile({ ...s.app.profile, link: 'pixelfox.example' });
  });
  await tab(a, 'collection');
  await tab(a, 'me');
  const [download] = await Promise.all([a.waitForEvent('download'), a.click('text=Сохранить копию')]);
  const file = join(env.dir, 'restore.pipsbak');
  await download.saveAs(file);
  const list = (await words(a)).split(' ');
  // The paper key, as printed.
  await a.click('text=Бумажный ключ');
  await a.getByRole('button', { name: 'Показать', exact: true }).click();
  const paper = await photo(a, '.secret .qr-box canvas', env.dir, 'paper-key');

  const fresh = async () => {
    const p = await env.blank('новый телефон');
    await p.click('text=У меня уже есть ключ');
    return p;
  };
  const status = (p) => p.textContent('.onb-status[role="status"]');
  const go = (p) => p.isEnabled('.onb-go');

  // The backup first: whose it is shows before any key.
  const b = await fresh();
  await choose(b, () => b.click('text=Выбрать файл копии'), file);
  await b.locator('.onb-file .idcard').waitFor(); // the file is read in the background
  assert.equal(await b.textContent('.onb-file .idcard small'), `Ключ ${await short(a)}`);
  // A typo shows in its cell at once; a swap, once all 24 are in.
  await b.fill('.words-entry input >> nth=0', list.join(' '));
  await b.fill('.words-entry input >> nth=5', 'qqq');
  assert.match(await status(b), /Слова № 6 нет в списке/);
  assert.equal(await b.getAttribute('.words-entry input >> nth=5', 'aria-invalid'), 'true');
  // Two words swapped. The checksum is 8 bits: one swap in 256 still adds
  // up, so the pair is one the core itself rejects.
  const k = await b.evaluate(async (w) => {
    const { app } = await import('/src/state.js');
    for (let i = 5; i < 23; i++) {
      if (w[i] === w[i + 1]) continue;
      const s = [...w];
      [s[i], s[i + 1]] = [s[i + 1], s[i]];
      try { app.core.Identity.fromWords(s.join(' ')); } catch { return i; }
    }
    return -1;
  }, list);
  assert.ok(k >= 5);
  await b.fill('.words-entry input >> nth=5', list.slice(5, k).concat([list[k + 1], list[k]]).join(' ')); // from cell 6 on
  assert.match(await status(b), /не сходятся/);
  assert.equal(await go(b), false);
  // Four letters of each word are enough; they are written out in full.
  await b.fill('.words-entry input >> nth=0', list.map((w) => w.slice(0, 4)).join(' '));
  assert.equal(await b.inputValue('.words-entry input >> nth=23'), list[23]);
  assert.equal(await b.textContent('.onb-status .idcard small'), `Ключ ${await short(a)} · подходит к копии`);
  await b.click('.onb-go');
  await b.locator('nav.tabs').waitFor(); // no nick asked: it came with the backup
  const facts = await b.evaluate(async () => {
    const s = await import('/src/state.js');
    return { cards: s.app.cards.size, nick: s.app.profile.nick, link: s.app.profile.link };
  });
  assert.deepEqual(facts, { cards: 18, nick: 'pixelfox', link: 'pixelfox.example' });
  assert.equal(await short(b), await short(a));

  // Another key's words do not open this backup.
  const c = await env.phone('чужой');
  const other = await words(c);
  const d = await fresh();
  await choose(d, () => d.click('text=Выбрать файл копии'), file);
  await d.locator('.onb-file .idcard').waitFor(); // the file is read in the background
  await d.fill('.words-entry input >> nth=0', other);
  assert.match(await status(d), /а копия — от другого/);
  assert.equal(await go(d), false);
  await d.click('[aria-label="Убрать"]'); // without the file, the key alone will do
  assert.equal(await go(d), true);

  // The paper key, from a photo of it.
  const e = await fresh();
  await e.click('.onb .seg >> text=Бумажный ключ');
  await fromPicture(e, '.onb', paper);
  await e.locator('.onb-status .idcard').waitFor();
  assert.equal(await e.textContent('.onb-status .idcard small'), `Ключ ${await short(a)}`);
  await e.click('.onb-go');
  await e.fill('.field input', 'pixelfox'); // no backup: the nick is asked
  await e.click('text=Готово');
  await e.locator('nav.tabs').waitFor();
  assert.equal(await short(e), await short(a));
  for (const p of [a, b, c, d, e]) await p.context().close();
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

  // Wider than any canvas of the app: the editor's rule, said here too.
  await choose(p, () => p.click('text=Другой файл'), await wide(env.dir));
  assert.match(await textMatching(p, '.import-status', /до 64×64/), /^80×8: в приложении карточка до 64×64/);
  assert.ok(await p.locator('.import-actions .btn.key').isDisabled(), 'not signed');
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
  await p.waitForFunction(() => document.querySelector('.import-body input:not([type])')?.value === 'heart-x6'); // read, and named after the file
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

  // Passed on once more: the code names its last sender, not the hands
  // before, so the path leaves a gap rather than claim a direct one.
  const c = await env.phone('lumen');
  const relay = await b.evaluate(async () => {
    const s = await import('/src/state.js');
    const [e] = [...s.app.cards.values()];
    return s.app.core.qrPlan(s.app.identity.sealAsSender(e.rec.payload, s.app.profile.nick)).text;
  });
  await c.evaluate(async (text) => {
    const s = await import('/src/state.js');
    await s.receive(s.app.core.openEnvelope(s.app.core.classify(text).bytes));
  }, relay);
  await tab(c, 'collection');
  assert.match(await c.evaluate(async () => {
    const { cardBack } = await import('/src/collection/back.js');
    const [e] = [...(await import('/src/state.js')).app.cards.values()];
    return cardBack(e, { editing: false, onEdit() {}, onTag() {}, onAuthor() {} }).el.textContent;
  }), /@pixelfox → … → @mossfern → вам/);
  for (const p of [a, b, c]) await p.context().close();
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
  // A backup before the copies: they make it stale at once.
  await tab(a, 'me');
  const [saved] = await Promise.all([a.waitForEvent('download'), a.click('text=Сохранить копию')]);
  await saved.cancel();
  await ownCard(a, 'Сердце');
  await act(a, 'share');
  // The sheet keeps its place and size from the copy's code to the panel.
  const sheetBox = async () => { await a.waitForTimeout(700); return a.locator('.top-sheet').boundingBox(); }; // once it has come down
  const asCopy = await sheetBox();
  await a.click('.top-sheet button:text("Экземпляр №")');
  assert.deepEqual(await sheetBox(), asCopy, 'nothing jumps between «Копия» and «Экземпляр №»');
  await a.fill('.edition-panel input', '2');

  await tab(b, 'receive');
  await b.click('text=Код получателя');
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
  await a.keyboard.press('Escape');
  await tab(a, 'me');
  // (Profile draws itself anew when shown: wait for it.)
  assert.match(await textMatching(a, '.group:has(h2:text("Резервная копия"))', /После копии/), /изменений после неё: 1.*После копии выданы 2 номерных экземпляра/s);
  assert.ok(await a.locator('.group:has(h2:text("Резервная копия")) .btn.key').isVisible(), 'saving is the main action now');
  await a.context().close();
  await b.context().close();
});

test('the collection: tags, search, archive and the bin, all without gestures', async () => {
  const p = await env.phone('pixelfox');
  await tab(p, 'me');
  await samples(p);
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
  assert.equal(await shown(), 18);
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
  assert.equal(await shown(), 18);
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
  assert.equal(await inPlace('collection'), 17);
  await p.click('.toast button');
  await p.waitForTimeout(900);
  assert.equal(await inPlace('collection'), 18, 'undone');
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
  assert.equal(await cards(p), 17);
  await p.context().close();
});

test('on a computer, a mouse and the keys reach every level', async () => {
  const p = await env.phone('deskfox', undefined, true);
  await tab(p, 'me');
  await samples(p);
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
  assert.equal(await undoLabel(), 'Отменить: шахматка');
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

test('a backup restores cards, notes and the copy log, only for its key', async () => {
  const a = await env.phone('pixelfox');
  await tab(a, 'me');
  await samples(a);
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
  assert.match(await status(), /Последняя: .*, 18 карточек/, 'the status updates at once');

  const restore = async (p, f) => {
    await choose(p, () => p.click('.group:has(h2:text("Резервная копия")) >> text=Восстановить'), f);
    await p.waitForTimeout(800);
    return toast(p);
  };
  const b = await env.phone('новый', await words(a));
  await tab(b, 'me');
  assert.equal(await restore(b, file), 'Восстановлено: 18');
  const facts = await b.evaluate(async () => {
    const s = await import('/src/state.js');
    const r = [...s.app.cards.values()].map((e) => e.rec);
    return { notes: r.filter((x) => x.note).length, tags: r.flatMap((x) => x.tags ?? []).join(' '), archived: r.filter((x) => x.state === 'archive').length, nick: s.app.profile.nick };
  });
  // The profile fills only what is empty: this phone's own nick stays.
  assert.deepEqual(facts, { notes: 1, tags: 'фестиваль совы', archived: 1, nick: 'новый' });
  assert.match(await b.locator('.group:has(h2:text("Резервная копия")) .hint').first().textContent(), /Последняя/);

  // Another key's backup: the way to it is to switch to that key, from here.
  const c = await env.phone('чужой');
  await ownCard(c, 'Луна');
  await tab(c, 'me');
  assert.match(await restore(c, file), /Это копия другого ключа/);
  await c.click('.toast .text-btn'); // «Сменить ключ»
  assert.match(await c.locator('.dialog').textContent(), /1 ваша карточка подписана нынешним ключом/);
  await c.click('.dialog button:text-is("Сменить ключ")');
  assert.equal(await c.textContent('.onb h1'), 'Другой ключ');
  assert.match(await c.textContent('.onb-file .idcard small'), /Ключ /, 'the backup comes along');
  await c.fill('.words-entry input >> nth=0', await words(a));
  await c.click('.onb-go');
  await c.locator('.onb').waitFor({ state: 'detached' });
  assert.equal(await toast(c), 'Ключ сменён');
  const after = await c.evaluate(async () => {
    const s = await import('/src/state.js');
    const all = [...s.app.cards.values()];
    const me = s.app.identity.publicKey().hex;
    return {
      cards: all.length,
      mineIsMyKey: all.every((e) => e.rec.mine === (e.author?.hex === me)),
      moon: all.find((e) => e.card.title === 'Луна')?.rec.mine,
      nick: s.app.profile.nick,
    };
  });
  assert.deepEqual(after, { cards: 19, mineIsMyKey: true, moon: false, nick: 'чужой' });
  assert.equal(await c.textContent('.idcard small'), `Ключ ${await c.evaluate(async () => (await import('/src/state.js')).app.identity.publicKey().short)}`);
  const bytes = await readFile(file);
  bytes[bytes.length - 5] ^= 1;
  await writeFile(join(env.dir, 'bad.pipsbak'), bytes);
  assert.match(await restore(b, join(env.dir, 'bad.pipsbak')), /Копия повреждена/);
  for (const p of [a, b, c]) await p.context().close();
});

/**
 * Controls on screen that cover one another, or the tab bar's raised scan
 * button: [what, what] pairs. Only what is visible and not inside another.
 */
const overlaps = (p) => p.evaluate(() => {
  const sel = 'section.view:not([hidden]) :is(button, input, select, textarea, .hint, .coach, .idcard), .coach:not([hidden])';
  const els = [...document.querySelectorAll(sel)].filter((e) => {
    const r = e.getBoundingClientRect(), s = getComputedStyle(e);
    if (!(r.width > 0 && r.height > 0) || s.visibility === 'hidden' || e.closest('[hidden]')) return false;
    if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) return false; // parked off screen
    for (let a = e; a; a = a.parentElement) if (getComputedStyle(a).opacity === '0') return false; // faded out
    return true;
  });
  const out = [];
  const name = (e) => `${e.tagName.toLowerCase()}.${[...e.classList].join('.')} «${(e.textContent ?? '').trim().slice(0, 24)}»`;
  const hit = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
  for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
    const a = els[i], b = els[j];
    if (a.contains(b) || b.contains(a)) continue;
    if (hit(a.getBoundingClientRect(), b.getBoundingClientRect())) out.push([name(a), name(b)]);
  }
  // The scan button and its ring stand above the bar: nothing floating may touch them.
  const fab = document.querySelector('.tabs:not(.away) .main i')?.getBoundingClientRect();
  const coach = document.querySelector('.coach:not([hidden])')?.getBoundingClientRect();
  if (fab && coach && coach.bottom > fab.top - 5) out.push(['.coach', 'the scan button']);
  return out;
});

test('nothing on screen covers anything else, and the hint shows only when it applies', async () => {
  for (const desk of [false, true]) {
    const p = await env.phone('pixelfox', undefined, desk);
    await p.waitForTimeout(600);
    // An empty collection: nothing to zoom, so no word about zooming.
    assert.ok(await p.locator('.first-run').isVisible());
    assert.equal(await p.locator('.coach').isVisible(), false, 'no zoom hint without cards');
    for (const t of ['me', 'receive', 'import', 'draw']) {
      await tab(p, t);
      await p.waitForTimeout(500);
      assert.deepEqual(await overlaps(p), [], `${t}, ${desk ? 'computer' : 'phone'}`);
    }
    // Two-up rows keep their labels on one line.
    await tab(p, 'me');
    await p.waitForTimeout(400);
    for (const b of await p.$$('section.view:not([hidden]) .row-btns .btn')) assert.ok((await b.boundingBox()).height <= 50, await b.textContent());
    await samples(p);
    await p.waitForTimeout(1500);
    await tab(p, 'collection');
    await p.waitForTimeout(800);
    // With cards: the hint, clear of the scan button; gone once used.
    assert.ok(await p.locator('.coach').isVisible(), 'the zoom hint, now that there is somewhere to go');
    assert.deepEqual(await overlaps(p), []);
    await p.keyboard.press('-'); // a step out: weeks → months
    await p.waitForTimeout(600);
    assert.equal(await p.locator('.coach').isVisible(), false, 'learnt: gone');
    await p.reload();
    await p.locator('nav.tabs').waitFor();
    await p.waitForTimeout(800);
    assert.equal(await p.locator('.coach').isVisible(), false, 'and stays gone');
    await p.context().close();
  }
});

test('a fault nobody caught is written down, told once, and can be read and sent', async () => {
  const p = await env.phone('pixelfox');
  const before = env.errors.length;
  const words = await p.evaluate(async () => (await import('/src/state.js')).app.identity.words());
  const boom = () => p.evaluate(() => { setTimeout(() => { throw new Error('boom in a test'); }); });
  await boom();
  assert.match(await textMatching(p, '.toast span', /журнал/), /Что-то пошло не так — это записано в журнал/);
  await boom(); // the same again: one entry, counted
  await p.waitForTimeout(300);
  env.errors.splice(before); // thrown on purpose

  // The toast leads to the journal.
  await p.click('.toast .text-btn');
  await p.locator('.overlay .journal-row').first().waitFor();
  assert.equal(await p.locator('.overlay .journal-row').count(), 1);
  assert.match(await p.textContent('.overlay .journal-row'), /Ошибка×2collection.*boom in a test/s);
  // The report, as it would go: facts and the entry — and nothing secret.
  await p.click('.journal-report summary');
  const text = await textMatching(p, '.journal-report pre', /boom/);
  assert.match(text, /^Pips — error report\nversion: pips-dev\n/);
  assert.match(text, /error ×2 \[collection\] boom in a test/);
  assert.ok(!text.includes(words.split(' ')[0] + ' ' + words.split(' ')[1]), 'no recovery words');
  assert.ok(!text.includes('pixelfox'), 'no nick');
  // It survives a restart (written a moment after it happened).
  await p.keyboard.press('Escape');
  await p.locator('.overlay').waitFor({ state: 'detached' });
  await p.waitForTimeout(1200);
  await p.reload();
  await p.locator('nav.tabs').waitFor();
  await tab(p, 'me');
  assert.match(await textMatching(p, '.journal-group', /1 запись/), /1 запись, последняя —/);
  // Sent the device's way (here: the clipboard, or a file where there is none).
  await p.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await p.click('.journal-group >> text=Отправить отчёт');
  assert.match(await textMatching(p, '.toast span', /Отчёт/), /Отчёт (скопирован|сохранён файлом)/);
  // Cleared from its page.
  await p.click('.journal-group >> text=Открыть журнал');
  await p.click('.overlay >> text=Очистить журнал');
  assert.equal(await p.textContent('.overlay .sheet-body > p.hint'), 'Записей нет.');
  await p.click('.overlay .bar .icon-btn');
  assert.match(await textMatching(p, '.journal-group', /Ошибок не было/), /Ошибок не было/);
  await p.context().close();
});

test('developer mode opens only for its phrase, and its samples come and go as a set', async () => {
  const p = await env.phone('pixelfox');
  await ownCard(p, 'Моя');
  await tab(p, 'me');
  const group = p.locator('section.view:visible .group.developer');
  await group.locator('> *').first().waitFor();
  assert.equal(await group.locator('button').count(), 0, 'no tools, only the folded gate');
  await group.locator('summary').click();
  for (const wrong of ['i am a developer', 'I am a developer ', 'I am a develope']) {
    await group.locator('input').fill(wrong);
    await p.waitForTimeout(150);
    assert.equal(await group.locator('.dev-gate').count(), 1, `not for «${wrong}»`);
  }
  await group.locator('input').fill('I am a developer');
  await group.locator('text=Добавить образцы').waitFor();
  // Asked first: «Cancel» adds nothing.
  await group.locator('text=Добавить образцы').click();
  await p.click('.dialog button:text-is("Отмена")');
  assert.equal(await cards(p), 1);
  await tab(p, 'collection');
  await tab(p, 'me');
  await samples(p);
  await p.waitForTimeout(500);
  assert.equal(await cards(p), 19);
  // Taken away as a set: the person's own card stays.
  await tab(p, 'me');
  await group.locator('text=Убрать образцы (18)').click();
  await p.click('.dialog button:text-is("Да")');
  assert.match(await textMatching(p, '.toast span', /Удалено/), /Удалено образцов: 18/);
  assert.equal(await cards(p), 1);
  // Off again: back behind the phrase.
  await group.locator('text=Выключить режим разработчика').click();
  await group.locator('.dev-gate').waitFor();
  await p.context().close();
});

test('a card sent as a link opens the app and arrives, even before the first run', async () => {
  const a = await env.phone('pixelfox');
  await ownCard(a, 'Сердце');
  // The device's share sheet, stood in for: what it is handed is kept.
  await a.evaluate(() => { /** @type {any} */ (navigator).share = async (d) => { /** @type {any} */ (window).shared = d; }; });
  await act(a, 'share');
  await a.click('.top-sheet .share-link');
  const sent = await a.evaluate(() => /** @type {any} */ (window).shared);
  assert.match(sent.url, /^https:\/\/pips-app\.github\.io\/pips\/#[A-Za-z0-9_-]+$/, 'the published app (this one is not on https)');
  assert.equal(sent.title, 'Сердце');
  const fragment = sent.url.slice(sent.url.indexOf('#'));

  // Someone with the app: it opens on the card, and the address forgets it.
  const b = await env.phone('mossfern');
  await b.goto('about:blank');
  await b.goto(env.url + fragment);
  await b.locator('.turn:not([hidden])').waitFor();
  assert.equal(await toast(b), 'Карточка в коллекции');
  assert.equal(await b.evaluate(() => location.hash), '', 'a reload will not bring it in again');
  assert.match(await backText(b), /@pixelfox → вам/);

  // Someone new: the first screen says a card waits, and after the key it is there.
  const c = await env.blank('lumen');
  await c.goto('about:blank');
  await c.goto(env.url + fragment);
  assert.match(await c.textContent('.onb-arrival'), /Вам прислали карточку «Сердце» от @pixelfox/);
  await c.click('text=Создать ключ');
  await c.check('.check input');
  await c.click('text=Дальше');
  await c.fill('.field input', 'lumen');
  await c.click('text=Готово');
  await c.locator('.turn:not([hidden])').waitFor();
  assert.equal(await cards(c), 1);

  // A link cut short says so, and adds nothing.
  await b.goto('about:blank');
  for (const cut of [fragment.slice(0, 40), fragment.slice(0, 41)]) { // whole base64 or not
    await b.goto('about:blank');
    await b.goto(env.url + cut);
    assert.match(await textMatching(b, '.toast span', /Ссылка/), /Ссылка на карточку неполная/, cut.length);
  }
  assert.equal(await cards(b), 1);
  for (const p of [a, b, c]) await p.context().close();
});

test('a card is signed with a name; one that came without shows «Без названия»', async () => {
  const p = await env.phone('pixelfox');
  // The import: the title emptied, signing asks for one instead.
  await tab(p, 'import');
  await choose(p, () => p.click('.import-preview'), await heart(env.dir));
  await p.waitForFunction(() => document.querySelector('.import-body input:not([type])')?.value === 'heart-x6');
  await p.fill('.import-body input:not([type])', '   ');
  await p.click('text=Подписать и добавить');
  assert.match(await toast(p), /Сначала назовите карточку/);
  assert.equal(await p.evaluate(() => document.activeElement?.matches('.import-body input:not([type])')), true, 'the title field, ready to type');
  assert.equal(await cards(p), 0);
  // The editor: the same.
  await tab(p, 'draw');
  await p.locator('.ed-art').waitFor();
  await p.click('.ed-sign');
  assert.match(await textMatching(p, '.toast span', /назовите/), /Сначала назовите карточку/);
  assert.equal(await p.evaluate(() => document.activeElement?.classList.contains('ed-title')), true);
  assert.equal(await cards(p), 0);

  // A card without a name from elsewhere (the format allows it): named for the eye.
  await p.click('[aria-label="Закрыть редактор"]');
  await p.evaluate(async () => {
    const s = await import('/src/state.js');
    const other = s.app.core.Identity.fromSeed(crypto.getRandomValues(new Uint8Array(32)));
    const card = { width: 8, height: 8, opaque: true, palette: { builtin: 0 }, frame: 0, frames: 1, delay_ms: 0, title: '', author: 'kitsu', handle: null, link: '', pixels: new Uint8Array(64).fill(3) };
    await s.receive(s.app.core.openEnvelope(other.sealAsAuthor(other.signCard(card), undefined)));
  });
  await tab(p, 'collection');
  await p.waitForTimeout(600);
  assert.equal(await p.textContent('.on-stage .cap b'), 'Без названия');
  assert.ok(await p.$eval('.on-stage .cap b', (b) => b.classList.contains('untitled')));
  await p.context().close();
});

test('the tab bar waits for the card to land in the archive and the strip to go', async () => {
  const p = await env.phone('pixelfox');
  await ownCard(p, 'Последняя');
  await act(p, 'down'); // the only card: to the archive, from the feed
  const away = () => p.locator('nav.tabs').evaluate((n) => n.classList.contains('away'));
  // Through the flight and while the strip shows where it landed, the tabs stay out of its way…
  for (const ms of [300, 700, 900]) {
    await p.waitForTimeout(ms);
    assert.equal(await away(), true, `still away after ${ms} ms more`);
  }
  // …and come back once the strip has gone down.
  await p.waitForFunction(() => !document.querySelector('nav.tabs')?.classList.contains('away'), null, { timeout: 4000 });
  assert.equal(await p.evaluate(async () => [...(await import('/src/state.js')).app.cards.values()][0].rec.state), 'archive');
  await p.context().close();
});

test('the editor grid lies exactly on the cells, from edge to edge', async () => {
  for (const desk of [false, true]) {
    const p = await env.phone('pixelfox', undefined, desk);
    await tab(p, 'draw');
    await p.locator('.ed-art').waitFor();
    await p.waitForTimeout(400);
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
    await p.context().close();
  }
});
