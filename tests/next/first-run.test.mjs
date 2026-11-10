// @ts-check
// The first run and the key in the profile, through the buttons a person
// presses (the agreed mock-up, docs/REWRITE.md О1): a new key's words
// shown once and three of them asked back; the key kept, the name given,
// the app there again after a reload; words checked in the profile; a key
// restored from its words, with its backup. Each test is a new phone.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setup } from './helpers.mjs';
import { asked, newKey as phoneKey, readWords } from './phone.mjs';

/** @type {Awaited<ReturnType<typeof setup>>} */
let env;
before(async () => { env = await setup(); });
after(() => env.close());

/** @typedef {import('playwright').Page} Page */

/** A new phone, through the first run with a new key; its words and the name given. @param {string} nick */
const newKey = (nick) => phoneKey(env, nick);

test('a new key: 24 words shown once, three asked back, kept hidden; the name given, and all there after a reload', async () => {
  const { p, words } = await newKey('kitsu');
  assert.equal(words.length, 24);
  assert.equal(new Set(words).size > 1, true);
  assert.match(await p.getByRole('main').innerText(), /kitsu[\s\S]*Ключ [0-9a-f]{2}·[0-9a-f]{2}·[0-9a-f]{2}·[0-9a-f]{2}/);
  await p.getByText('Хранится в этом браузере так, что его нельзя скопировать.', { exact: false }).waitFor();
  await p.reload();
  await p.getByRole('heading', { name: 'Профиль' }).waitFor();
  assert.match(await p.getByRole('main').innerText(), /kitsu/);
  assert.equal(await p.getByText('24 слова', { exact: false }).count() > 0, true);
  assert.equal(await p.getByRole('list', { name: 'Ваши 24 слова' }).count(), 0, 'the words are not shown again');
  await p.context().close();
});

test('a wrong word asked back is said, and nothing goes on until the record is right; the words can be seen again', async () => {
  const p = await env.page();
  await p.getByRole('button', { name: 'Создать ключ' }).click();
  const words = await readWords(p);
  await p.getByRole('button', { name: 'Я записал(а) — проверить' }).click();
  const [n, ...rest] = await asked(p);
  // A word from another place: a swapped pair, said so.
  const other = words.findIndex((w, i) => i !== n - 1 && w !== words[n - 1]);
  await p.getByLabel(`Слово № ${n}`, { exact: true }).fill(words[other]);
  await p.getByRole('status').filter({ hasText: 'похоже, два слова переставлены' }).waitFor();
  for (const m of rest) await p.getByLabel(`Слово № ${m}`, { exact: true }).fill(words[m - 1]);
  assert.equal(await p.getByRole('button', { name: 'Дальше', exact: true }).isDisabled(), true);
  await p.getByRole('button', { name: 'Показать слова ещё раз' }).click();
  assert.deepEqual(await readWords(p), words, 'the same words: nothing was kept, nothing changed');
  // Back from the words: no key kept, and after a reload the first run again.
  await p.getByRole('button', { name: 'Назад' }).click();
  await p.reload();
  await p.getByRole('button', { name: 'Создать ключ' }).waitFor();
  await p.context().close();
});

test('the words are checked in the profile, never shown: these fit, another key’s do not', async () => {
  const { p, words } = await newKey('mira');
  const check = async (/** @type {string[]} */ typed) => {
    await p.getByRole('button', { name: 'Проверить слова' }).click();
    const dialog = p.getByRole('dialog', { name: 'Проверить слова' });
    await dialog.getByLabel('Слово № 1', { exact: true }).fill(typed.join(' ')); // a pasted phrase fills the cells
    const said = await dialog.getByRole('status').filter({ hasText: /Запись|другого ключа|не сходятся/ }).innerText();
    await dialog.getByRole('button', { name: 'Готово' }).click();
    await dialog.waitFor({ state: 'detached' });
    return said;
  };
  assert.match(await check(words.map((w) => w.slice(0, 4))), /Запись верна: слова подходят к ключу/);
  const other = await env.page();
  await other.getByRole('button', { name: 'Создать ключ' }).click();
  const theirs = await readWords(other);
  await other.context().close();
  assert.match(await check(theirs), /Это слова другого ключа/);
  await p.context().close();
});

test('a key restored from its words is the same key; the name is asked for when there is none', async () => {
  const { p, words } = await newKey('kitsu');
  const key = (await p.getByRole('main').innerText()).match(/Ключ ([0-9a-f·]+)/)?.[1];
  await p.context().close();
  const q = await env.page();
  await q.getByRole('button', { name: 'У меня уже есть ключ' }).click();
  await q.getByLabel('Слово № 1', { exact: true }).fill(words.join(' '));
  await q.getByText('Ключ найден').waitFor();
  await q.getByRole('button', { name: 'Восстановить' }).click();
  await q.getByLabel('Как вас подписывать?').fill('kitsu');
  await q.getByRole('button', { name: 'Готово' }).click();
  await q.getByRole('heading', { name: 'Профиль' }).waitFor();
  assert.match(await q.getByRole('main').innerText(), new RegExp(`Ключ ${key}`));
  await q.context().close();
});

/**
 * Saves a backup from the profile; the file as downloaded, ready to be
 * chosen on another phone (a download goes with its phone, so its bytes are kept).
 * @param {Page} p
 */
async function saveBackup(p) {
  const [download] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: 'Сохранить копию' }).click()]);
  await p.getByRole('status').filter({ hasText: 'Копия сохранена' }).waitFor();
  const name = download.suggestedFilename();
  return { name, mimeType: 'application/octet-stream', buffer: await readFile(/** @type {string} */ (await download.path())) };
}

/** Types the words into the restore screen and waits until they name a key. @param {Page} p @param {string[]} words */
async function typeWords(p, words) {
  await p.getByLabel('Слово № 1', { exact: true }).fill(words.join(' '));
  await p.getByText('Ключ найден').waitFor();
}

/** The short key the profile shows. @param {Page} p */
const shortKey = async (p) => (await p.getByRole('main').innerText()).match(/Ключ ([0-9a-f·]+)/)?.[1];

test('a backup saved from the profile brings back the profile on a new phone, with the key from its words', async () => {
  const { p, words } = await newKey('kitsu');
  const key = await shortKey(p);
  await p.getByText('Копии ещё нет', { exact: false }).waitFor();
  const file = await saveBackup(p);
  assert.match(file.name, /^pips-\d{4}-\d{2}-\d{2}\.pipsbak$/);
  await p.getByText(/Последняя: .+, 0 карточек/).waitFor();
  await p.context().close();

  const q = await env.page();
  await q.getByRole('button', { name: 'У меня уже есть ключ' }).click();
  const [chooser] = await Promise.all([q.waitForEvent('filechooser'), q.getByRole('button', { name: 'Выбрать файл копии' }).click()]);
  await chooser.setFiles(file);
  await q.getByText(file.name).waitFor();
  await typeWords(q, words);
  await q.getByText('подходит к копии', { exact: false }).waitFor();
  await q.getByRole('button', { name: 'Восстановить' }).click();
  // The name came back with the backup: it is not asked for.
  await q.getByRole('heading', { name: 'Профиль' }).waitFor();
  const main = await q.getByRole('main').innerText();
  assert.match(main, /kitsu/);
  assert.match(main, new RegExp(`Ключ ${key}`));
  assert.match(main, /Последняя: .+, 0 карточек/, 'a backup restored onto an empty phone is as good as one just made');
  await q.context().close();
});

test('another key’s backup is not opened; switching to that key from its words opens it', async () => {
  const a = await newKey('aoi');
  const file = await saveBackup(a.p);
  const aKey = await shortKey(a.p);
  await a.p.context().close();

  const { p } = await newKey('beni');
  const [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.getByRole('button', { name: 'Добавить из копии' }).click()]);
  await chooser.setFiles(file);
  const said = p.getByRole('status').filter({ hasText: 'Это копия другого ключа' });
  await said.waitFor();
  await said.getByRole('button', { name: 'Сменить ключ' }).click();
  // The file goes along: only its key's words are asked for.
  await p.getByRole('heading', { name: 'Другой ключ' }).waitFor();
  await p.getByText(file.name).waitFor();
  await typeWords(p, a.words);
  await p.getByRole('button', { name: 'Восстановить' }).click();
  // The current key goes for good: said, and asked, first.
  await p.getByRole('heading', { name: 'Сменить ключ?' }).waitFor();
  await p.getByRole('button', { name: 'Сменить ключ', exact: true }).click();
  await p.getByRole('status').filter({ hasText: 'Ключ сменён' }).waitFor();
  assert.equal(await shortKey(p), aKey);
  // The name already given stays; the backup's does not replace it.
  assert.match(await p.getByRole('main').innerText(), /beni/);
  await p.context().close();
});

test('switching key can be backed out of, and switching to the same key says so', async () => {
  const { p, words } = await newKey('kitsu');
  const key = await shortKey(p);
  await p.getByRole('button', { name: 'Сменить ключ' }).click();
  await p.getByRole('heading', { name: 'Другой ключ' }).waitFor();
  await p.getByRole('button', { name: 'Назад' }).click();
  await p.getByRole('heading', { name: 'Профиль' }).waitFor();
  assert.equal(await shortKey(p), key);

  await p.getByRole('button', { name: 'Сменить ключ' }).click();
  await typeWords(p, words);
  await p.getByRole('button', { name: 'Восстановить' }).click();
  await p.getByRole('status').filter({ hasText: 'Это тот же ключ — он на месте' }).waitFor();
  assert.equal(await shortKey(p), key);
  await p.reload();
  await p.getByRole('heading', { name: 'Профиль' }).waitFor();
  assert.equal(await shortKey(p), key);
  await p.context().close();
});

test('an own backup added on the same phone adds nothing twice; a file that is not a backup is said so', async () => {
  const { p } = await newKey('kitsu');
  const file = await saveBackup(p);
  const add = async (/** @type {{ name: string, mimeType: string, buffer: Buffer }} */ f) => {
    const [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.getByRole('button', { name: 'Добавить из копии' }).click()]);
    await chooser.setFiles(f);
  };
  await add(file);
  await p.getByRole('status').filter({ hasText: 'Из копии добавлено: 0' }).waitFor();
  await add({ name: 'notes.pipsbak', mimeType: 'application/octet-stream', buffer: Buffer.from('not a backup at all') });
  await p.getByRole('status').filter({ hasText: 'Это не резервная копия Pips' }).waitFor();
  await p.context().close();
});

test('switching to another key asks first, naming the key that goes; back keeps what was typed', async () => {
  const other = await newKey('aoi');
  const theirs = await shortKey(other.p);
  await other.p.context().close();
  const { p } = await newKey('beni');
  const mine = await shortKey(p);
  await p.getByRole('button', { name: 'Сменить ключ' }).click();
  await typeWords(p, other.words);
  await p.getByRole('button', { name: 'Восстановить' }).click();
  await p.getByRole('heading', { name: 'Сменить ключ?' }).waitFor();
  assert.match(await p.getByRole('main').innerText(), new RegExp(`Ключ ${mine} будет удалён из этого браузера`));
  await p.getByRole('button', { name: 'Назад' }).click();
  // Back on the words, as they were: the key they give is still found.
  await p.getByText('Ключ найден').waitFor();
  await p.getByRole('button', { name: 'Назад' }).click();
  await p.getByRole('heading', { name: 'Профиль' }).waitFor();
  assert.equal(await shortKey(p), mine, 'nothing changed');
  await p.reload();
  await p.getByRole('heading', { name: 'Профиль' }).waitFor();
  assert.equal(await shortKey(p), mine);
  assert.notEqual(theirs, mine);
  await p.context().close();
});

test('a key switched in another tab is the key this tab shows, and says so', async () => {
  const other = await newKey('aoi');
  const theirs = await shortKey(other.p);
  await other.p.context().close();
  const { p } = await newKey('beni');
  const tab = await env.tab(p);
  await tab.getByRole('heading', { name: 'Профиль' }).waitFor();
  await tab.getByRole('button', { name: 'Сменить ключ' }).click();
  await typeWords(tab, other.words);
  await tab.getByRole('button', { name: 'Восстановить' }).click();
  await tab.getByRole('button', { name: 'Сменить ключ', exact: true }).click();
  await tab.getByRole('status').filter({ hasText: 'Ключ сменён' }).waitFor();
  await p.getByRole('status').filter({ hasText: 'Ключ сменён в другой вкладке' }).waitFor();
  assert.equal(await shortKey(p), theirs);
  await p.context().close();
});

test('the words sheet holds the keyboard: Tab does not reach the profile under it, and a second tap opens no second sheet', async () => {
  const { p } = await newKey('kitsu');
  const button = p.getByRole('button', { name: 'Проверить слова' });
  await button.dblclick();
  const dialog = p.getByRole('dialog', { name: 'Проверить слова' });
  await dialog.waitFor();
  assert.equal(await dialog.count(), 1);
  const under = () => p.evaluate(() => !!document.activeElement?.closest('main.home'));
  for (let i = 0; i < 30; i++) {
    await p.keyboard.press('Tab');
    assert.equal(await under(), false, `Tab ${i + 1} reached the profile under the sheet`);
  }
  await p.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  assert.equal(await p.evaluate(() => document.activeElement?.textContent), 'Проверить слова', 'focus back on the button that opened it');
  await p.context().close();
});
