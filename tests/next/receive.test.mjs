// @ts-check
// Cards that arrive, through the receiving phone's buttons: a code from a
// picture, a .pips file of one card or of several, a pasted link; each
// checked by the core before it is kept, and what came of it said in the
// same words wherever it came from. Another person's phone is the harness
// (harness/artist.js); what it hands over is what a person would.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.mjs';
import { artist, asFile, cards, choose, newKey, toldAfter } from './phone.mjs';

/** @type {Awaited<ReturnType<typeof setup>>} */
let env;
before(async () => { env = await setup(); });
after(() => env.close());

/** @typedef {import('playwright').Page} Page */

/** Opens the scanner on a phone. @param {Page} p */
async function scanner(p) {
  await p.getByRole('button', { name: 'Сканер' }).click();
  await p.getByRole('heading', { name: 'Сканер' }).waitFor();
}

test('a card’s code read from a picture arrives, checked; the same code again is a card already here', async () => {
  const a = await artist(env, 'pixelfox');
  const { p } = await newKey(env, 'mossfern');
  const [text] = await a.codeTexts(await a.envelope('Сердце'));
  const picture = asFile('code.png', await a.codePicture(text), 'image/png');
  await scanner(p);
  assert.equal(await toldAfter(p, () => choose(p, 'Из картинки', [picture])), 'Карточка в коллекции');
  assert.equal(await toldAfter(p, () => choose(p, 'Из картинки', [picture])), 'Такая карточка уже есть');
  assert.deepEqual(await cards(p), ['Сердце @pixelfox']);
  await a.p.context().close();
  await p.context().close();
});

test('a card passed on names who passed it; a picture with no code, or not a picture, is said so in the frame', async () => {
  const a = await artist(env, 'pixelfox');
  const b = await artist(env, 'lumen');
  const { p } = await newKey(env, 'mossfern');
  const relayed = await b.passOn(await a.envelope('Лиса'), 'lumen');
  const [text] = await a.codeTexts(relayed);
  const picture = asFile('code.png', await a.codePicture(text), 'image/png');
  await scanner(p);
  assert.equal(await toldAfter(p, () => choose(p, 'Из картинки', [picture])), 'Карточка в коллекции');
  assert.deepEqual(await cards(p), ['Лиса @pixelfox · от @lumen']);
  await scanner(p);
  const blank = await a.p.evaluate(async () => { const c = new OffscreenCanvas(200, 200); /** @type {OffscreenCanvasRenderingContext2D} */ (c.getContext('2d')).fillRect(0, 0, 200, 200); return [...new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer())]; });
  await choose(p, 'Из картинки', [asFile('blank.png', blank, 'image/png')]);
  await p.getByText('На картинке не нашлось QR-кода').waitFor();
  await choose(p, 'Из картинки', [asFile('notes.png', [1, 2, 3, 4], 'image/png')]);
  await p.getByText('Не удалось открыть картинку').waitFor();
  for (const x of [a, b]) await x.p.context().close();
  await p.context().close();
});

test('a .pips file brings its card; a file of several brings each, counted; what is not a card file is said why', async () => {
  const a = await artist(env, 'pixelfox');
  const { p } = await newKey(env, 'mossfern');
  const one = await a.envelope('Один');
  const two = await a.envelope('Два', 8, 2);
  const three = await a.envelope('Три', 8, 3);
  const files = { one: await a.pipsFile([one]), cut: await a.pipsFile([one, two]) };
  await scanner(p);
  assert.equal(await toldAfter(p, () => choose(p, 'Файл .pips', [asFile('one.pips', files.one)])), 'Карточка в коллекции');
  // Several: one already here, one damaged in the middle — none refused for another's fault.
  const damaged = [...three];
  damaged[damaged.length - 5] ^= 0xff;
  const many = await a.pipsFile([one, two, damaged]);
  assert.equal(await toldAfter(p, () => choose(p, 'Файл .pips', [asFile('many.pips', many)])), 'Добавлено 1 карточка · уже были: 1 · не приняты: 1');
  assert.equal(await toldAfter(p, () => choose(p, 'Файл .pips', [asFile('notes.txt', [...Buffer.from('hello')])])), 'Это не код Pips');
  const cut = files.cut;
  assert.equal(await toldAfter(p, () => choose(p, 'Файл .pips', [asFile('cut.pips', cut.slice(0, -3))])), 'Файл Pips повреждён: он не дошёл целиком или изменился по дороге');
  const newer = [...cut];
  newer[5] = 2;
  assert.equal(await toldAfter(p, () => choose(p, 'Файл .pips', [asFile('newer.pips', newer)])), 'Это сделала более новая версия Pips — обновите приложение и откройте снова');
  assert.deepEqual((await cards(p)).sort(), ['Два @pixelfox', 'Один @pixelfox']);
  await a.p.context().close();
  await p.context().close();
});

test('a forged code is refused for its signature; a damaged one is asked to be scanned again', async () => {
  const a = await artist(env, 'pixelfox');
  const { p } = await newKey(env, 'mossfern');
  const envelope = await a.envelope('Подделка');
  // A byte of the card itself changed: it reads, and its signature no longer fits.
  const forged = [...envelope];
  forged[forged.length - 80] ^= 0x01;
  const forgedFile = asFile('forged.pips', await a.pipsFile([forged]));
  // A code of an envelope cut short: a Pips code, but damaged.
  const [cutText] = await a.codeTexts(envelope.slice(0, 40));
  const cutPicture = asFile('cut.png', await a.codePicture(cutText), 'image/png');
  await scanner(p);
  assert.equal(await toldAfter(p, () => choose(p, 'Файл .pips', [forgedFile])), 'Подпись не сходится: код повреждён или подделан. Карточка не добавлена');
  assert.equal(await toldAfter(p, () => choose(p, 'Из картинки', [cutPicture])), 'Код Pips, но повреждён. Попробуйте отсканировать ещё раз');
  assert.deepEqual(await cards(p), []);
  await a.p.context().close();
  await p.context().close();
});

test('a pasted link brings its card; one cut short on the way is said to be', async () => {
  const a = await artist(env, 'pixelfox');
  const { p } = await newKey(env, 'mossfern');
  const link = await a.link(await a.envelope('Ссылка'));
  await scanner(p);
  const field = p.getByRole('textbox', { name: 'Ссылка или текст кода' });
  assert.equal(await toldAfter(p, async () => { await field.fill(link); await field.press('Enter'); }), 'Карточка в коллекции');
  assert.equal(await toldAfter(p, async () => { await field.fill(link.slice(0, -20)); await field.press('Enter'); }), 'Ссылка на карточку неполная — возможно, её обрезал мессенджер. Попросите прислать ещё раз');
  assert.deepEqual(await cards(p), ['Ссылка @pixelfox']);
  await a.p.context().close();
  await p.context().close();
});

test('a card from a link opened before the first run is asked about once the app is there, and kept only on yes', async () => {
  const a = await artist(env, 'pixelfox');
  const link = await a.link(await a.envelope('По ссылке'));
  const { p } = await newKey(env, 'mossfern', `/${link.slice(link.indexOf('#'))}`);
  const dialog = p.getByRole('dialog', { name: 'Карточка по ссылке' });
  await dialog.getByText('По ссылке пришла карточка «По ссылке» от @pixelfox. Взять её в коллекцию?').waitFor();
  assert.doesNotMatch(p.url(), /#/, 'out of the address at once: a reload does not bring it in again');
  assert.equal(await toldAfter(p, () => dialog.getByRole('button', { name: 'Взять' }).click()), 'Карточка в коллекции');
  assert.deepEqual(await cards(p), ['По ссылке @pixelfox']);
  await a.p.context().close();
  await p.context().close();
});

test('a page that opened Pips cannot fill the collection: each link is a question, one at a time, and no is no', async () => {
  const a = await artist(env, 'pixelfox');
  const { p } = await newKey(env, 'mossfern');
  const first = await a.link(await a.envelope('Первая'));
  const second = await a.link(await a.envelope('Вторая', 8, 2));
  // The address changed from outside, twice, while the first question is open.
  await p.evaluate((h) => { location.hash = h; }, first.slice(first.indexOf('#') + 1));
  const dialog = p.getByRole('dialog', { name: 'Карточка по ссылке' });
  await dialog.getByText(/«Первая»/).waitFor();
  assert.equal(await toldAfter(p, () => p.evaluate((h) => { location.hash = h; }, second.slice(second.indexOf('#') + 1))), 'Пока вы решали, пришла ещё одна ссылка на карточку. Если она нужна, откройте её снова');
  await dialog.getByRole('button', { name: 'Не брать' }).click();
  await dialog.waitFor({ state: 'detached' });
  assert.deepEqual(await cards(p), [], 'neither kept');
  await a.p.context().close();
  await p.context().close();
});

test('a large card comes as a carousel, one picture at a time, its progress said, until it arrives', async () => {
  const a = await artist(env, 'bigfox');
  const { p } = await newKey(env, 'bigmoss');
  // 64×64 of sixteen colours in no pattern: well past one code.
  const texts = await a.codeTexts(await a.envelope('Шум', 64, 7));
  assert.ok(texts.length > 2, 'a carousel');
  const pictures = [];
  for (const [i, text] of texts.entries()) pictures.push(asFile(`frame-${i}.png`, await a.codePicture(text, 4), 'image/png'));
  await scanner(p);
  let arrived = '';
  for (const picture of pictures) {
    await choose(p, 'Из картинки', [picture]);
    const parts = p.getByText(/^Собрано \d+ из \d+$/);
    // Each picture either moves the count on or brings the card.
    await Promise.race([parts.waitFor(), p.locator('.shell-tell:not([hidden])').waitFor()]);
    if (await p.locator('.shell-tell:not([hidden])').count()) { arrived = (await p.locator('.shell-tell span').innerText()).trim(); break; }
  }
  assert.equal(arrived, 'Карточка в коллекции');
  assert.deepEqual(await cards(p), ['Шум @bigfox']);
  await a.p.context().close();
  await p.context().close();
});

test('the recipient code is shown for an artist to scan; a recipient code or a paper key scanned here is said for what it is', async () => {
  const a = await artist(env, 'pixelfox');
  const paper = asFile('paper.png', await a.codePicture(await a.paperKey()), 'image/png');
  const { p } = await newKey(env, 'mossfern');
  await scanner(p);
  await p.getByRole('button', { name: 'Код получателя' }).click();
  const dialog = p.getByRole('dialog', { name: 'Код получателя' });
  await dialog.getByText('Покажите автору: он выдаст вам пронумерованный экземпляр на имя @mossfern.').waitFor();
  // The picture shown, as it is drawn: Playwright's screenshot adds a style to the page, which its CSP refuses (WebKit says so).
  const shot = await dialog.getByRole('img', { name: 'Код получателя' }).evaluate(async (cv) => {
    const big = new OffscreenCanvas(/** @type {HTMLCanvasElement} */ (cv).width * 6, /** @type {HTMLCanvasElement} */ (cv).height * 6);
    const g = /** @type {OffscreenCanvasRenderingContext2D} */ (big.getContext('2d'));
    g.imageSmoothingEnabled = false;
    g.drawImage(/** @type {HTMLCanvasElement} */ (cv), 0, 0, big.width, big.height);
    return [...new Uint8Array(await (await big.convertToBlob({ type: 'image/png' })).arrayBuffer())];
  });
  await dialog.getByRole('button', { name: 'Закрыть' }).click();
  await dialog.waitFor({ state: 'detached' });
  assert.equal(await toldAfter(p, () => choose(p, 'Из картинки', [asFile('recipient.png', [...shot], 'image/png')])), 'Это код получателя — его сканирует автор при выдаче экземпляра');
  assert.match(await toldAfter(p, () => choose(p, 'Из картинки', [paper])), /^Это чей-то секретный ключ/);
  await a.p.context().close();
  await p.context().close();
});
