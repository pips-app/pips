// @ts-check
// The QR reader (web-next/src/reader.js) through the core's reader in its
// worker, for tests: window.readCode(text, module, quiet) draws `text` as a
// code — `module` pixels a module, `quiet` modules of margin — and reads it
// back as a picture; window.readFrame(rgba, w, h) reads raw pixels.
import { coreClient } from '/src/core/client.js';
import { qrReader } from '/src/reader.js';

const w = /** @type {any} */ (window);
const core = coreClient({ script: new URL('./core-worker.js', import.meta.url), limits: {}, otherLimit: 10000, bootLimit: 10000 });
// The core's reader, as in a browser without BarcodeDetector.
const reader = await qrReader({ native: false });

w.readCode = async (/** @type {string} */ text, /** @type {number} */ module, /** @type {number} */ quiet) => {
  const m = await core.call('qrMatrix', text);
  const side = (m.size + 2 * quiet) * module;
  const cv = new OffscreenCanvas(side, side);
  const g = /** @type {OffscreenCanvasRenderingContext2D} */ (cv.getContext('2d'));
  g.fillStyle = '#fff';
  g.fillRect(0, 0, side, side);
  g.fillStyle = '#000';
  for (let y = 0; y < m.size; y++) for (let x = 0; x < m.size; x++) if (m.modules[y * m.size + x]) g.fillRect((x + quiet) * module, (y + quiet) * module, module, module);
  return reader.read(await createImageBitmap(cv));
};
w.harness = true;
