// @ts-check
// The phone's measuring worker (measure.html): the core's slowest jobs on
// the largest inputs they take, step by step, each answered as it ends.
// The core is loaded here directly, without the app's key or storage.

import init, * as core from '../pkg/pips_wasm.js';
import initScan, * as scan from '../pkg/pips_scan.js';
import { largestCard, measureBackup, measureScan, time } from './measure-ops.js';

/**
 * Backups to seal and open: fewer cards than on the desktop
 * (tests/next/measure.mjs: 5000 and 200), so a slow phone ends in a minute
 * or so; the time per card and per megabyte, which the limits use, is the
 * same measure. Making each of the largest cards takes most of the time
 * (it is compressed to be signed, ~0.35 s on a desktop): 20 of them are
 * about a megabyte.
 */
const SMALL = 2000;
const LARGE = 20;
/** A picture as large as the import is measured with: half the pixels it reads (src/core/limits.js). */
const SIDE = 2048;

/** @param {any} m */
const say = (m) => postMessage(m);

/**
 * A PNG of SIDE×SIDE: 128×128 cells of 16 pixels, each its own colour (the
 * largest picture the import brings back down to a card), or every pixel
 * its own colour (refused as too big, after reading all of it).
 * @param {'upscaled' | 'noise'} kind
 */
async function picture(kind) {
  const canvas = new OffscreenCanvas(SIDE, SIDE);
  const g = /** @type {OffscreenCanvasRenderingContext2D} */ (canvas.getContext('2d'));
  const img = g.createImageData(SIDE, SIDE);
  // A pixel at a time as one 32-bit word (RGBA in memory, little-endian):
  // four million of them, so not an array each.
  const px = new Uint32Array(img.data.buffer);
  for (let y = 0; y < SIDE; y++) {
    for (let x = 0; x < SIDE; x++) {
      const i = kind === 'upscaled' ? (y >> 4) * 128 + (x >> 4) : y * SIDE + x;
      px[y * SIDE + x] = 0xff000000 | (((i * 199) & 255) << 16) | (((i * 151) & 255) << 8) | ((i * 73) & 255);
    }
  }
  g.putImageData(img, 0, 0);
  return new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
}

onmessage = async () => {
  try {
    const started = performance.now();
    await init({ module_or_path: new URL('../pkg/pips_wasm_bg.wasm', import.meta.url) });
    core.errorCodes();
    say({ step: 'boot', ms: performance.now() - started });

    const { card } = largestCard(core);
    const id = core.Identity.fromSeed(new Uint8Array(32).fill(7));
    const payload = id.signCard(card);
    const envelope = id.sealAsAuthor(payload, undefined);
    id.free();
    say({ step: 'shareSize', ms: time(() => core.shareSize(card), 5).max });
    say({ step: 'render', ms: time(() => core.render(card, 15), 5).max });
    say({ step: 'openEnvelope', ms: time(() => core.openEnvelope(envelope), 5).max });

    if (typeof OffscreenCanvas === 'function') {
      for (const kind of /** @type {const} */ (['upscaled', 'noise'])) {
        const png = await picture(kind);
        say({ step: `importPicture ${kind}`, ms: time(() => { try { core.importPicture(png, { solidAlpha: true, fit: 32 }); } catch { /* a refusal is timed too */ } }, 2).max });
      }
    } else {
      say({ step: 'importPicture', skipped: 'no OffscreenCanvas' });
    }

    const b = measureBackup(core, SMALL, LARGE);
    say({ step: 'sealBackup', perCard: b['1×1'].seal.max / SMALL, perMB: b.largest.sealPerMB });
    say({ step: 'openBackup', perMB: b['1×1'].openPerMB, perMBLarge: b.largest.openPerMB });
    await initScan({ module_or_path: new URL('../pkg/pips_scan_bg.wasm', import.meta.url) });
    const read = measureScan(scan);
    say({ step: 'scanQr', ms: Math.max(...Object.values(read).map((t) => t.max)) });
    say({ done: true });
  } catch (e) {
    say({ error: String(e) });
  }
};
