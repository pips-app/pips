// @ts-check
// Measures how long the core's jobs take on the largest inputs they accept,
// in the engine BROWSER names; the limits in web-next/src/core/limits.js
// rest on these numbers. Not a test: run by hand when the core changes.
//
//   node measure.mjs            (and BROWSER=firefox / webkit node measure.mjs)
import { deflateSync } from 'node:zlib';
import { setup, engineName } from './helpers.mjs';

/** CRC-32 of PNG chunks. */
const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
/** @param {Buffer} b */
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

/** An RGBA PNG of `w`×`h`, each pixel from `at(x, y)`. @param {number} w @param {number} h @param {(x: number, y: number) => number[]} at */
function png(w, h, at) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(at(x, y), y * (w * 4 + 1) + 1 + x * 4);
  /** @param {string} type @param {Buffer} data */
  const chunk = (type, data) => {
    const t = Buffer.from(type);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(Buffer.concat([t, data])));
    return Buffer.concat([len, t, data, sum]);
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w, 0); head.writeUInt32BE(h, 4); head.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** A colour from a cell, many different ones. @param {number} i */
const colour = (i) => [(i * 73) & 255, (i * 151) & 255, (i * 199) & 255, 255];
const pictures = {
  // 128×128 cells of 16×16 pixels, all different: the largest picture the
  // import takes back down to a card, with far more colours than one holds.
  'upscaled 2048²': png(2048, 2048, (x, y) => colour((y >> 4) * 128 + (x >> 4))),
  // The largest side, every pixel its own colour: refused as too big, after
  // reading all of it.
  'noise 2048²': png(2048, 2048, (x, y) => colour(y * 2048 + x)),
  'card 128²': png(128, 128, (x, y) => colour(y * 128 + x)),
};

const env = await setup();
const page = await env.page('__test__/core.html?worker=measure-worker.js&limit=600000');
await page.waitForFunction(() => /** @type {any} */ (window).harness);
// The worker's start: loading and compiling the core, then a first job.
const boot = await page.evaluate(async () => { const t = performance.now(); await /** @type {any} */ (window).core.call('errorCodes'); return performance.now() - t; });
console.log(`${engineName}\tboot (start, load, first job)\t${boot.toFixed(1)} ms`);
const bytes = Object.fromEntries(Object.entries(pictures).map(([k, v]) => [k, [...v]]));
const out = await page.evaluate((b) => /** @type {any} */ (window).core.call('measure',
  Object.fromEntries(Object.entries(b).map(([k, v]) => [k, Uint8Array.from(v)]))), bytes);
// The way there and back: the largest card in (256 KB of pixels) and one
// frame out (64 KB), copied each way, for a job that itself takes ~1 ms.
const trip = await page.evaluate(async () => {
  const card = { width: 128, height: 128, opaque: true, frame: 0, frames: 16, delay_ms: 100, palette: { builtin: 0 },
    title: '', author: '', handle: null, link: '', pixels: new Uint8Array(128 * 128 * 16) };
  const core = /** @type {any} */ (window).core;
  await core.call('render', card, 15);
  const ms = [];
  for (let i = 0; i < 15; i++) { const t = performance.now(); await core.call('render', card, 15); ms.push(performance.now() - t); }
  return ms.sort((a, b) => a - b)[7];
});
console.log(`${engineName}\trender, there and back (median)\t${trip.toFixed(1)} ms`);
console.log(engineName, JSON.stringify(out.card));
for (const [op, t] of Object.entries(out)) {
  if (op !== 'card') console.log(`${engineName}\t${op}\tmax ${t.max.toFixed(1)} ms\tmedian ${t.median.toFixed(1)} ms`);
}
const backup = await page.evaluate(() => /** @type {any} */ (window).core.call('measureBackup', 5000, 200));
for (const [shape, m] of Object.entries(backup)) {
  console.log(`${engineName}\tbackup of ${m.cards} ${shape} cards, ${m.file} B\tseal ${m.seal.max.toFixed(0)} ms (${m.sealPerMB.toFixed(0)} ms/MB of cards)\topen ${m.open.max.toFixed(0)} ms (${m.openPerMB.toFixed(0)} ms/MB of file)`);
}
await env.close();
