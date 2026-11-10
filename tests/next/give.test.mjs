// @ts-check
// Give, through the buttons: one's own cards, each with its code ready to
// be scanned from the screen, and as a file for someone not in the room.
// The person's own card comes from their key on another device (the
// harness, until the editor comes); the phone itself only presses buttons.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setup } from './helpers.mjs';
import { artist, asFile, cards, choose, newKey, toldAfter } from './phone.mjs';

/** @type {Awaited<ReturnType<typeof setup>>} */
let env;
before(async () => { env = await setup(); });
after(() => env.close());

/** @typedef {import('playwright').Page} Page */

/** @param {Page} p @param {string} name */
async function tab(p, name) {
  await p.getByRole('button', { name, exact: true }).click();
}

/** The code shown, as the picture it is. @param {Page} p @param {string} name */
const codeOnScreen = (p, name) => p.getByRole('img', { name }).evaluate(async (cv) => {
  const c = /** @type {HTMLCanvasElement} */ (cv);
  const big = new OffscreenCanvas(c.width * 6, c.height * 6);
  const g = /** @type {OffscreenCanvasRenderingContext2D} */ (big.getContext('2d'));
  g.imageSmoothingEnabled = false;
  g.drawImage(c, 0, 0, big.width, big.height);
  return [...new Uint8Array(await (await big.convertToBlob({ type: 'image/png' })).arrayBuffer())];
});

/** A phone with an own card on it, brought from the person's key on another device. @param {string} nick @param {string} title */
async function withOwnCard(nick, title) {
  const me = await newKey(env, nick);
  const elsewhere = await artist(env, nick, me.words);
  const file = asFile('own.pips', await elsewhere.pipsFile([await elsewhere.envelope(title)]));
  await elsewhere.p.context().close();
  await tab(me.p, 'Сканер');
  assert.equal(await toldAfter(me.p, () => choose(me.p, 'Файл .pips', [file])), 'Карточка в коллекции');
  assert.deepEqual(await cards(me.p), [`${title} ваша`]);
  return me.p;
}

test('nothing to give before there is an own card; someone else’s is not offered here', async () => {
  const a = await artist(env, 'pixelfox');
  const { p } = await newKey(env, 'mossfern');
  await tab(p, 'Отдать');
  await p.getByText('Пока нечего отдать').waitFor();
  const file = asFile('theirs.pips', await a.pipsFile([await a.envelope('Чужая')]));
  await tab(p, 'Сканер');
  await toldAfter(p, () => choose(p, 'Файл .pips', [file]));
  await tab(p, 'Отдать');
  await p.getByText('Пока нечего отдать').waitFor();
  await a.p.context().close();
  await p.context().close();
});

test('an own card’s code, scanned from the screen by another phone, arrives there signed by its author', async () => {
  const p = await withOwnCard('pixelfox', 'Сердце');
  await tab(p, 'Отдать');
  await p.getByRole('heading', { name: 'Сердце' }).waitFor();
  await p.getByText(/байт.* · один код/).waitFor();
  const picture = asFile('code.png', await codeOnScreen(p, 'Сердце'), 'image/png');
  const b = await newKey(env, 'mossfern');
  await tab(b.p, 'Сканер');
  assert.equal(await toldAfter(b.p, () => choose(b.p, 'Из картинки', [picture])), 'Карточка в коллекции');
  assert.deepEqual(await cards(b.p), ['Сердце @pixelfox']);
  await p.context().close();
  await b.p.context().close();
});

test('an own card as a file: saved, and opened on another phone', async () => {
  const p = await withOwnCard('pixelfox', 'Файл');
  await tab(p, 'Отдать');
  await p.getByRole('heading', { name: 'Файл' }).waitFor();
  const [download] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: 'Файлом' }).click()]);
  assert.equal(download.suggestedFilename(), 'Fayl.pips', 'in Latin letters: some browsers drop any other name');
  const bytes = [...await readFile(/** @type {string} */ (await download.path()))];
  const b = await newKey(env, 'mossfern');
  await tab(b.p, 'Сканер');
  assert.equal(await toldAfter(b.p, () => choose(b.p, 'Файл .pips', [asFile('Fayl.pips', bytes)])), 'Карточка в коллекции');
  await p.context().close();
  await b.p.context().close();
});

/** The recipient code a phone shows, as a picture. @param {Page} p */
async function recipientCode(p) {
  await tab(p, 'Сканер');
  await p.getByRole('button', { name: 'Код получателя' }).click();
  const dialog = p.getByRole('dialog', { name: 'Код получателя' });
  const picture = asFile('recipient.png', await codeOnScreen(p, 'Код получателя'), 'image/png');
  await dialog.getByRole('button', { name: 'Закрыть' }).click();
  return picture;
}

/**
 * The author issues the next numbered copy to the recipient whose code is
 * `code`, with `run` typed when it is the first; gives the copy's code and
 * what the question said.
 * @param {Page} p @param {ReturnType<typeof asFile>} code @param {string} [run]
 */
async function issue(p, code, run) {
  await tab(p, 'Отдать');
  await p.getByRole('button', { name: 'Экземпляр №' }).click();
  if (run) await p.getByRole('spinbutton', { name: 'Тираж' }).fill(run);
  await p.getByRole('button', { name: /^Выдать №\d+$/ }).click();
  const scan = p.getByRole('dialog', { name: 'Код получателя' });
  await choose(p, 'Из картинки', [code]);
  const ask = p.getByRole('dialog', { name: /^Выдать №\d+( из \d+)?\?$/ });
  const question = (await ask.getByText(/Номер будет занят/).innerText()).trim();
  await ask.getByRole('button', { name: 'Выдать', exact: true }).click();
  await scan.waitFor({ state: 'detached' });
  const label = question.match(/^Выдать (№\d+(?: из \d+)?)/)?.[1] ?? '';
  const shown = p.getByRole('dialog', { name: label });
  const copy = asFile('copy.png', await codeOnScreen(p, label), 'image/png');
  await shown.getByRole('button', { name: 'Готово' }).click();
  return { copy, question };
}

test('numbered copies: issued to a scanned recipient code, once each, until the run is complete', async () => {
  const p = await withOwnCard('pixelfox', 'Тираж');
  const b = await newKey(env, 'mossfern');
  const c = await newKey(env, 'lumen');
  const first = await issue(p, await recipientCode(b.p), '2');
  assert.match(first.question, /^Выдать №1 из 2 для @mossfern \(ключ [0-9a-f]{2}(·[0-9a-f]{2}){3}\)\? Номер будет занят\.$/);
  await tab(b.p, 'Сканер');
  assert.equal(await toldAfter(b.p, () => choose(b.p, 'Из картинки', [first.copy])), 'Карточка в коллекции');
  assert.deepEqual(await cards(b.p), ['Тираж @pixelfox · №1 из 2']);

  const second = await issue(p, await recipientCode(c.p));
  assert.match(second.question, /^Выдать №2 из 2 для @lumen/);
  // The run is complete: said on the button, which no longer issues.
  await tab(p, 'Отдать');
  await p.getByRole('button', { name: 'Экземпляр №' }).click();
  assert.equal(await p.getByRole('button', { name: 'Тираж разошёлся' }).isDisabled(), true);
  await p.getByText('Выдано 2 из 2').waitFor();
  assert.deepEqual(await p.getByRole('list', { name: 'Выданные экземпляры' }).getByRole('listitem').allInnerTexts().then((l) => l.map((s) => s.replace(/\s+\S+$/, '').replace(/\s+/g, ' '))), ['№2 @lumen', '№1 @mossfern']);
  for (const x of [p, b.p, c.p]) await x.context().close();
});

test('a numbered copy for someone who already has the card takes the plain one’s place, and says so; a code that is not a recipient’s is said in the frame', async () => {
  const p = await withOwnCard('pixelfox', 'Сердце');
  const b = await newKey(env, 'mossfern');
  // The plain card first, from the screen.
  await tab(p, 'Отдать');
  const plain = asFile('plain.png', await codeOnScreen(p, 'Сердце'), 'image/png');
  await tab(b.p, 'Сканер');
  await toldAfter(b.p, () => choose(b.p, 'Из картинки', [plain]));
  // A plain card's code where a recipient code should be: said, nothing issued.
  await p.getByRole('button', { name: 'Экземпляр №' }).click();
  await p.getByRole('button', { name: 'Выдать №1' }).click();
  await choose(p, 'Из картинки', [plain]);
  await p.getByRole('dialog', { name: 'Код получателя' }).getByText('Это не код получателя. Попросите открыть «Сканер» → «Код получателя»').waitFor();
  await p.getByRole('dialog', { name: 'Код получателя' }).getByRole('button', { name: 'Отмена' }).click();
  const { copy } = await issue(p, await recipientCode(b.p));
  await tab(b.p, 'Сканер');
  assert.equal(await toldAfter(b.p, () => choose(b.p, 'Из картинки', [copy])), 'Теперь у вас №1 — он заменил прежнюю копию');
  assert.deepEqual(await cards(b.p), ['Сердце @pixelfox · №1']);
  for (const x of [p, b.p]) await x.context().close();
});
