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
