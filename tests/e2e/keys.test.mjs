// The key and what keeps the collection safe: words and paper keys,
// restoring on a new phone, backups — and the scanner when it is asked for a key.
// Run after scripts/build-wasm.sh: `npm ci && npm test` in this folder.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { suite, photo, fromPicture, choose, tab, png, textMatching, samples, words, cards, picture, ownCard, act, still, until, toastAfter } from './helpers.mjs';

const env = suite();

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

test('a backup restores cards, notes and the copy log, only for its key', async () => {
  const a = await env.phone('pixelfox');
  await tab(a, 'me');
  await samples(a);
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
    return toastAfter(p, () => choose(p, () => p.click('.group:has(h2:text("Резервная копия")) >> text=Восстановить'), f));
  };
  // Restored onto the phone it came from: nothing in it is new here, and
  // nothing is counted as changed since.
  await restore(a, file);
  assert.doesNotMatch(await status(), /изменений после неё/);
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
  await ownCard(c, 'Луна', env.dir);
  await tab(c, 'me');
  assert.match(await restore(c, file), /Это копия другого ключа/);
  await c.click('.toast .text-btn'); // «Сменить ключ»
  assert.match(await c.locator('.dialog').textContent(), /1 ваша карточка подписана нынешним ключом/);
  await c.click('.dialog button:text-is("Сменить ключ")');
  assert.equal(await c.textContent('.onb h1'), 'Другой ключ');
  assert.match(await c.textContent('.onb-file .idcard small'), /Ключ /, 'the backup comes along');
  await c.fill('.words-entry input >> nth=0', await words(a));
  assert.equal(await toastAfter(c, () => c.click('.onb-go')), 'Ключ сменён');
  await c.locator('.onb').waitFor({ state: 'detached' });
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

test('a wrong picture for the paper key is answered every time, in the frame', async () => {
  const p = await env.blank('pixelfox');
  await p.click('text=У меня уже есть ключ');
  await p.click('.onb .seg >> text=Бумажный ключ');
  const plain = await png(env.dir, 'plain.png', 40, 40, () => [90, 120, 200, 255]);
  const broken = join(env.dir, 'broken.png');
  await writeFile(broken, 'not a picture');
  const note = '.onb .scanner-start small';
  const shakes = () => p.$eval(note, (e) => e.getAnimations().length);
  await choose(p, () => p.click('.onb >> text=Из картинки'), plain);
  assert.match(await textMatching(p, note, /не нашлось QR-кода/), /не нашлось/);
  assert.ok(await p.$eval(note, (e) => e.classList.contains('bad')), 'said as a problem');
  await p.waitForFunction((s) => !document.querySelector(s)?.getAnimations().length, note); // the first answer has finished moving
  await choose(p, () => p.click('.onb >> text=Из картинки'), plain);
  await p.waitForFunction((s) => document.querySelector(s)?.getAnimations().length, note);
  assert.ok((await shakes()) > 0, 'the same picture again: answered again, visibly');
  await choose(p, () => p.click('.onb >> text=Из картинки'), broken);
  assert.match(await textMatching(p, note, /повреждён/), /не картинка/, 'not a picture is not "no code"');
  await p.context().close();
});

// The author's log of numbered copies goes into every backup. Two of its
// states real people reach broke the backup for good: a number given out
// on two phones of one key (the logs, joined, hold it twice), and a key
// changed after copies were issued (the log stays on a card no longer
// "mine"). A backup that cannot be saved is lost work waiting to happen.
test('a backup is saved with a copy number given out on two phones, and after the key changes', { timeout: 180_000 }, async () => {
  const a = await env.phone('twofox');
  await ownCard(a, 'Дважды', env.dir);
  const a2 = await env.phone('twofox2', await words(a)); // the same key, on a second phone
  await act(a, 'share');
  const plain = await photo(a, '.top-sheet .qr-box', env.dir, 'twice-plain');
  await tab(a2, 'receive');
  await fromPicture(a2, 'section.view:visible', plain);
  await a2.locator('.turn:not([hidden])').waitFor();
  await act(a2, 'share');

  /** A recipient code from a phone of its own. @param {string} nick */
  const recipient = async (nick) => {
    const r = await env.phone(nick);
    await tab(r, 'receive');
    await r.click('text=Код получателя');
    return photo(r, '.overlay .qr-box', env.dir, `rc-${nick}`);
  };
  /** Copy №1 of a run of two, from this phone, to whoever's code it is. */
  const issueFirst = async (p, rc) => {
    await p.click('.top-sheet button:text("Экземпляр №")');
    await p.fill('.edition-panel input', '2');
    await p.click('text=Выдать №1');
    await fromPicture(p, '.overlay', rc);
    await p.click('.dialog button:text-is("Выдать")');
    await p.click('.overlay >> text=Готово');
    await p.keyboard.press('Escape');
    await still(p);
  };
  await issueFirst(a, await recipient('getsone'));
  await issueFirst(a2, await recipient('getstwo')); // the second phone did not know: №1 again

  /** Saves a backup; it must come out as a file. */
  const save = async (p) => {
    await tab(p, 'me');
    const [d] = await Promise.all([p.waitForEvent('download', { timeout: 10_000 }), p.click('text=Сохранить копию')]);
    const f = join(env.dir, `${Date.now()}-${d.suggestedFilename()}`);
    await d.saveAs(f);
    return f;
  };
  // The second phone's backup, restored on the first: the logs are joined.
  const fromSecond = await save(a2);
  await tab(a, 'me');
  assert.match(await toastAfter(a, () => choose(a, () => a.click('.group:has(h2:text("Резервная копия")) >> text=Восстановить'), fromSecond)), /Восстановлено/);
  const log = await a.evaluate(async () => [...(await import('/src/state.js')).app.cards.values()].find((e) => e.card.title === 'Дважды')?.rec.editions?.issued.map((i) => i.edition));
  assert.deepEqual(log, [1, 1], 'number 1, given out twice, to two people');
  await save(a); // it used to fail here, and every time after

  // Another key (another phone's, by its words): the card is a former
  // self's now, its log still with it.
  const other = await words(await env.phone('otherkey'));
  await tab(a, 'me');
  await a.click('.btn.wide:text-is("Сменить ключ")');
  await a.click('.dialog button:text-is("Сменить ключ")');
  assert.equal(await a.textContent('.onb h1'), 'Другой ключ');
  await a.fill('.words-entry input >> nth=0', other);
  assert.equal(await toastAfter(a, () => a.click('.onb-go')), 'Ключ сменён');
  await a.locator('.onb').waitFor({ state: 'detached' });
  const kept = await a.evaluate(async () => {
    const e = [...(await import('/src/state.js')).app.cards.values()].find((x) => x.card.title === 'Дважды');
    return { mine: e?.rec.mine, copies: e?.rec.editions?.issued.length };
  });
  assert.deepEqual(kept, { mine: false, copies: 2 });
  await save(a); // and here
});

test('the first run can step back before anything is kept, and a quick second tap on «Готово» starts the app once', async () => {
  const p = await env.blank('backfox');
  await p.click('text=Создать ключ');
  await p.click('.onb button:text-is("Назад")');
  await p.locator('text=У меня уже есть ключ').waitFor(); // the first screen again
  await p.click('text=Создать ключ');
  const shown = await p.locator('.word-grid').textContent();
  await p.check('.check input');
  await p.click('text=Дальше');
  await p.click('.onb button:text-is("Назад")');
  assert.equal(await p.locator('.word-grid').textContent(), shown, 'from the nick, the same words: the key is not made anew');
  await p.check('.check input');
  await p.click('text=Дальше');
  await p.fill('.field input', 'backfox');
  await p.dblclick('text=Готово');
  await p.locator('nav.tabs').waitFor();
  assert.equal(await p.locator('nav.tabs').count(), 1, 'one app');
  await p.context().close();
});

test('a link the card cannot carry is said under it, and the warning goes once the link is as it was', async () => {
  const p = await env.phone('linkfox');
  await tab(p, 'me');
  const link = p.locator('section.view:visible input[aria-label="Ссылка"]');
  const warning = p.locator('section.view:visible .error');
  await link.fill('kitsu.art/shop');
  await link.press('Tab');
  await until(async () => (await warning.textContent()) === '', 'a good link kept');
  await link.fill('kitsu.art:8080/shop');
  await link.press('Tab');
  await until(async () => (await warning.textContent()) !== '', 'the bad link said');
  await link.fill('kitsu.art/shop'); // back to what is kept: nothing to save, nothing wrong
  await link.press('Tab');
  await until(async () => (await warning.textContent()) === '', 'the warning gone');
  await p.context().close();
});
