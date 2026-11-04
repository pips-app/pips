// Cards between phones: by code, carousel, link, file and picture, one or
// several at once; numbered copies; refusals of what is damaged or forged.
// Run after scripts/build-wasm.sh: `npm ci && npm test` in this folder.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { suite, photo, fromPicture, choose, tab, toast, heart, png, textMatching, samples, words, cards, picture, ownCard, act, backText, still } from './helpers.mjs';

const env = suite();

test('a card goes from one phone to another and is checked on arrival', async () => {
  const a = await env.phone('pixelfox');
  const b = await env.phone('mossfern');
  await ownCard(a, 'Сердце', env.dir);
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
  await ownCard(a, 'Сердце', env.dir);
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
  await ownCard(a, 'Сердце', env.dir);
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
    await a.click('.overlay >> text=Готово');
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

test('a card sent as a link opens the app and arrives, even before the first run', async () => {
  const a = await env.phone('pixelfox');
  await ownCard(a, 'Сердце', env.dir);
  // The device's share sheet, stood in for: what it is handed is kept.
  await a.evaluate(() => { /** @type {any} */ (navigator).share = async (d) => { /** @type {any} */ (window).shared = d; }; });
  await act(a, 'share');
  await a.click('.top-sheet .share-link >> nth=0'); // «Ссылкой»
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
  // A picture from a file comes without a name: signing asks for one.
  await picture(p, await heart(env.dir));
  await p.click('.overlay .btn.key');
  assert.equal(await p.inputValue('.ed-title'), '', 'the file name is no card title');
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
  await still(p);
  assert.equal(await p.textContent('.on-stage .cap b'), 'Без названия');
  assert.ok(await p.$eval('.on-stage .cap b', (b) => b.classList.contains('untitled')));
  await p.context().close();
});

test('give: one’s own cards with their codes, as a link, a file or a picture; a new card from one', async () => {
  const p = await env.phone('givefox');
  await tab(p, 'give');
  assert.match(await p.textContent('section.view:visible .empty'), /Пока нечего отдать/);
  await ownCard(p, 'Сердце', env.dir);
  await ownCard(p, 'Второе', env.dir);
  await tab(p, 'give');
  // The newest first, chosen; another one a tap away, on its own paper.
  assert.equal(await p.locator('.give-mini:not(.add)').count(), 2);
  assert.equal(await p.textContent('.give-paper .paper-body > b'), 'Второе');
  await p.click('.give-mini >> nth=1');
  assert.equal(await p.textContent('.give-paper .paper-body > b'), 'Сердце');
  assert.equal(await p.getAttribute('.give-mini >> nth=1', 'aria-pressed'), 'true');
  assert.ok(await p.isVisible('.give-paper .qr-box canvas'), 'the code, ready');
  // The other ways: a .pips file another phone opens, and the picture as a PNG.
  const [file] = await Promise.all([p.waitForEvent('download'), p.click('.give-paper .share-link:has-text("Файлом")')]);
  assert.equal(file.suggestedFilename(), 'Serdtse.pips', 'a download keeps to Latin letters');
  const pips = join(env.dir, 'given.pips');
  await file.saveAs(pips);
  const [pic] = await Promise.all([p.waitForEvent('download'), p.click('.give-paper .share-link:has-text("Картинкой")')]);
  assert.equal(pic.suggestedFilename(), 'Serdtse.png');
  const pngPath = join(env.dir, 'given.png');
  await pic.saveAs(pngPath);
  const head = await readFile(pngPath);
  assert.ok(head.readUInt32BE(16) >= 512, 'at least 512 pixels across');
  const q = await env.phone('lumen');
  await tab(q, 'receive');
  await choose(q, () => q.click('section.view:visible >> text=Файл .pips'), pips);
  await q.waitForTimeout(800);
  assert.equal(await cards(q), 1, 'the file opens on another phone');

  // One's own card starts a new one in the editor: the picture, without the name.
  await tab(p, 'collection');
  await p.evaluate(async () => (await import('/src/ui/shell.js')).go('collection', { open: [...(await import('/src/state.js')).app.cards.keys()][0] }));
  await still(p);
  await act(p, 'derive');
  await p.locator('.ed-art').waitFor();
  assert.match(await toast(p), /Новая карточка из прежней/);
  assert.equal(await p.inputValue('.ed-title'), '');
  assert.equal(await p.$eval('.ed-layer', (c) => c.width), 16, 'the heart’s canvas');
  for (const x of [p, q]) await x.context().close();
});

test('a picture of a card opens as the card: from the file, or by its code after re-encoding', async () => {
  const p = await env.phone('picfox');
  await ownCard(p, 'Сердце', env.dir);
  await tab(p, 'give');
  const [pic] = await Promise.all([p.waitForEvent('download'), p.click('.give-paper .share-link:has-text("Картинкой")')]);
  const file = join(env.dir, 'card-picture.png');
  await pic.saveAs(file);
  const bytes = await readFile(file);
  assert.equal(bytes.readUInt32BE(16), 1080, 'a card-shaped picture');

  // As sent, a file: the card itself, signed, on another phone.
  const q = await env.phone('lumen');
  await tab(q, 'receive');
  await fromPicture(q, 'section.view:visible', file);
  await q.locator('.turn:not([hidden])').waitFor();
  const got = await q.evaluate(async () => [...(await import('/src/state.js')).app.cards.values()].map((e) => [e.card.title, e.author?.hex.length > 0]));
  assert.deepEqual(got, [['Сердце', true]], 'the card, with its author');

  // Re-encoded on the way (a messenger, a screenshot): the code on it.
  const jpeg = join(env.dir, 'card-picture.jpg');
  const data = await p.evaluate(async (b64) => {
    const img = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/png' }));
    const cv = new OffscreenCanvas(img.width / 2, img.height / 2);
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    const blob = await cv.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
    return btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer())));
  }, bytes.toString('base64'));
  await writeFile(jpeg, Buffer.from(data, 'base64'));
  const r = await env.phone('rook');
  await tab(r, 'receive');
  await fromPicture(r, 'section.view:visible', jpeg);
  await r.locator('.turn:not([hidden])').waitFor({ timeout: 15000 });
  assert.equal(await cards(r), 1, 'read off the picture');

  // In the editor, the picture says what it is before anything else.
  await picture(r, file);
  assert.match(await r.textContent('.overlay .pic-card'), /карточка «Сердце», @picfox/);
  await r.click('.overlay .pic-card .btn');
  await r.locator('.overlay').waitFor({ state: 'detached' });
  assert.equal(await cards(r), 1, 'the same card: nothing new');
  for (const x of [p, q, r]) await x.context().close();
});

test('the code on a card picture takes the paper’s colours and still reads, on every paper, after JPEG', async () => {
  const p = await env.phone('shadefox');
  const results = await p.evaluate(async () => {
    const s = await import('/src/state.js');
    const { cardPicture } = await import('/src/ui/card-picture.js');
    const { qrReader } = await import('/src/qrscan.js');
    const reader = await qrReader();
    const out = [];
    for (const scale of [1, 0.75]) for (let shade = 0; shade < 8; shade++) {
      const card = { width: 16, height: 16, opaque: true, palette: { builtin: 0 }, frame: shade, frames: 1, delay_ms: 0, title: `Рамка ${shade}`, author: 'shadefox', handle: null, link: '', pixels: new Uint8Array(256).map((_, i) => i % 7) };
      const env = s.app.identity.sealAsAuthor(s.app.identity.signCard(card), undefined);
      const png = await cardPicture(card, env);
      // As a messenger passes a photo on: a JPEG, at the size it was (they
      // keep 1280 px), and a screenshot of it on a smaller screen.
      const img = await createImageBitmap(png);
      const cv = new OffscreenCanvas(img.width * scale, img.height * scale);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      const jpeg = await createImageBitmap(await cv.convertToBlob({ type: 'image/jpeg', quality: 0.75 }));
      const texts = await reader.read(jpeg);
      const want = s.app.core.qrPlan(env).text;
      out.push(texts.includes(want));
    }
    return out;
  });
  assert.deepEqual(results, Array(16).fill(true), `every paper, at both sizes: ${results.map(Number).join('')}`);
  await p.context().close();
});

test('several cards at once: chosen in the collection, sent as one file or as pictures, all taken in on another phone', async () => {
  const a = await env.phone('manyfox');
  await tab(a, 'me');
  await samples(a);
  await tab(a, 'collection');
  await still(a);
  /** Chooses the first `n` cards in sight, from the `from`-th on. */
  const choose3 = async (from, n) => {
    await a.click('.collection-bar .pill'); // «Выбрать»
    const spots = await a.$$eval('.on-stage', (els) => els.map((e) => e.getBoundingClientRect()).filter((r) => r.top > 70 && r.bottom < 700 && r.width > 20).map((r) => [r.x + r.width / 2, r.y + r.height / 2]));
    for (const [x, y] of spots.slice(from, from + n)) await a.mouse.click(x, y);
    await a.click('.action-bar.up [data-act="share"]');
    await a.locator('.bottom-sheet.on .many-way').first().waitFor();
  };
  await choose3(0, 3);
  assert.match(await a.textContent('.bottom-sheet.on h2'), /3 карточки/);
  assert.equal(await a.locator('.bottom-sheet.on .many-mini').count(), 3, 'what goes, shown small');
  const [dl] = await Promise.all([a.waitForEvent('download'), a.click('.bottom-sheet.on .many-way >> nth=0')]);
  const bundle = join(env.dir, 'three.pips');
  await dl.saveAs(bundle);
  assert.match(dl.suggestedFilename(), /^Pips-3-kartochki\.pips$/, 'a Latin name with what it holds');
  // The sheet goes once the file is out; the cards stay chosen until «Готово».
  await a.waitForFunction(() => !document.querySelector('.bottom-sheet.on'));
  assert.match(await a.textContent('.collection-bar .pill .on'), /Готово/);
  await a.click('.collection-bar .pill');

  // As pictures: one file each, two at a time.
  await a.waitForTimeout(500);
  await choose3(3, 2);
  const pics = [];
  a.on('download', (d) => pics.push(d));
  await a.click('.bottom-sheet.on .many-way >> nth=1');
  await a.waitForTimeout(3000);
  assert.equal(pics.length, 2, 'a picture for each card');
  const files = [];
  for (const [k, d] of pics.entries()) { const f = join(env.dir, `pic-${k}.png`); await d.saveAs(f); files.push(f); }

  // Another phone: the file of three, then both pictures at once.
  const b = await env.phone('manyowl');
  await tab(b, 'receive');
  await choose(b, () => b.click('section.view:visible >> text=Файл .pips'), bundle);
  assert.match(await textMatching(b, '.toast span', /Добавлено/), /Добавлено 3 карточки/);
  assert.equal(await cards(b), 3);
  await tab(b, 'receive');
  await choose(b, () => b.click('section.view:visible >> text=Файл .pips'), files);
  assert.match(await textMatching(b, '.toast span', /Добавлено 2/), /Добавлено 2 карточки/);
  assert.equal(await cards(b), 5);
  // The same file again: nothing new, and said so.
  await tab(b, 'receive');
  await choose(b, () => b.click('section.view:visible >> text=Файл .pips'), bundle);
  assert.match(await textMatching(b, '.toast span', /Новых/), /Новых карточек нет · уже были: 3/);
  // A file cut short is refused whole, in words.
  const cut = join(env.dir, 'cut.pips');
  await writeFile(cut, (await readFile(bundle)).subarray(0, 100));
  await tab(b, 'receive');
  await choose(b, () => b.click('section.view:visible >> text=Файл .pips'), cut);
  assert.match(await textMatching(b, '.toast span', /повреждён/), /повреждён/);
  assert.equal(await cards(b), 5);
  for (const x of [a, b]) await x.context().close();
});
