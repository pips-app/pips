// @ts-check
// The first run and the key in the profile, through the buttons a person
// presses (the agreed mock-up, docs/REWRITE.md О1): a new key's words
// shown once and three of them asked back; the key kept, the name given,
// the app there again after a reload; words checked in the profile; a key
// restored from its words, with its backup. Each test is a new phone.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.mjs';

/** @type {Awaited<ReturnType<typeof setup>>} */
let env;
before(async () => { env = await setup(); });
after(() => env.close());

/** @typedef {import('playwright').Page} Page */

/** The 24 words as the screen shows them, in order. @param {Page} p */
async function readWords(p) {
  const cells = await p.getByRole('list', { name: 'Ваши 24 слова' }).getByRole('listitem').allInnerTexts();
  return cells.map((c) => c.replace(/^\d+\s*/, '').trim());
}

/** The places of the words asked back, from the fields' names. @param {Page} p */
async function asked(p) {
  await p.getByRole('heading', { name: 'Проверим запись' }).waitFor();
  const names = await p.getByRole('textbox').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
  return names.map((n) => Number(n.replace(/\D+/g, '')));
}

/** A new phone, through the first run with a new key; its words and the name given. @param {string} nick */
async function newKey(nick) {
  const p = await env.page();
  await p.getByRole('button', { name: 'Создать ключ' }).click();
  await p.getByRole('heading', { name: 'Ваши 24 слова' }).waitFor();
  const words = await readWords(p);
  await p.getByRole('button', { name: 'Я записал(а) — проверить' }).click();
  for (const n of await asked(p)) await p.getByLabel(`Слово № ${n}`, { exact: true }).fill(words[n - 1].slice(0, 4));
  await p.getByRole('button', { name: 'Дальше', exact: true }).click();
  await p.getByRole('heading', { name: 'Ключ на месте' }).waitFor();
  await p.getByRole('button', { name: 'Дальше: как вас подписывать' }).click();
  await p.getByLabel('Как вас подписывать?').fill(nick);
  await p.getByRole('button', { name: 'Готово' }).click();
  await p.getByRole('heading', { name: 'Профиль' }).waitFor();
  return { p, words };
}

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
