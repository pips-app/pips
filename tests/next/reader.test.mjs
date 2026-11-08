// @ts-check
// Reading QR codes where the browser has no BarcodeDetector: the core's
// reader, in a worker of its own (web-next/src/core/scan-worker.js). A
// code reads as its text; one drawn small, as a messenger halves a card
// picture, reads on a second, larger look.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.mjs';

/** @type {Awaited<ReturnType<typeof setup>>} */
let env;
/** @type {import('playwright').Page} */
let page;
before(async () => {
  env = await setup();
  page = await env.page('__test__/reader.html');
  await page.waitForFunction(() => /** @type {any} */ (window).harness);
});
after(() => env.close());

/** @param {string} text @param {number} module @param {number} quiet */
const read = (text, module, quiet) => page.evaluate(([t, m, q]) => /** @type {any} */ (window).readCode(t, m, q), /** @type {const} */ ([text, module, quiet]));

test('a code in a picture reads as its text, through the reader’s own worker', async () => {
  assert.deepEqual(await read('PIPS TEST 1', 6, 4), ['PIPS TEST 1']);
});

test('a picture where nothing is found is looked at again, twice as large; one already large is not', async () => {
  // The rule, not one picture: which halved pictures read at all depends on
  // how their pixels fell, and differs between engines.
  const looks = await page.evaluate(async () => {
    const { qrReader } = await import('/src/reader.js');
    /** @param {number} side */
    const sizes = async (side) => {
      /** @type {number[]} */
      const seen = [];
      const client = { call: async (/** @type {string} */ _op, /** @type {Uint8Array} */ _px, /** @type {number} */ w) => { seen.push(w); return seen.length > 1 ? ['found'] : []; } };
      const r = await qrReader({ native: false, client });
      const cv = new OffscreenCanvas(side, side);
      /** @type {OffscreenCanvasRenderingContext2D} */ (cv.getContext('2d')).fillRect(0, 0, side, side);
      const got = await r.read(await createImageBitmap(cv));
      return { seen, got };
    };
    return { small: await sizes(300), large: await sizes(1800) };
  });
  assert.deepEqual(looks.small, { seen: [300, 600], got: ['found'] });
  assert.deepEqual(looks.large, { seen: [1800], got: [] }, 'twice 1800 is past the largest look (2048): not worth it');
});

test('a picture with no code reads as nothing', async () => {
  const none = await page.evaluate(async () => {
    const { qrReader } = await import('/src/reader.js');
    const r = await qrReader({ native: false });
    const cv = new OffscreenCanvas(300, 200);
    const g = /** @type {OffscreenCanvasRenderingContext2D} */ (cv.getContext('2d'));
    g.fillStyle = '#8a8'; g.fillRect(0, 0, 300, 200);
    return r.read(await createImageBitmap(cv));
  });
  assert.deepEqual(none, []);
});
