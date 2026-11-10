// @ts-check
// Reading QR codes from a camera frame or a picture: the browser's own
// BarcodeDetector where it has one (Chrome on Android and macOS),
// otherwise the core's reader in its own worker (core/scan-worker.js),
// started on first use. What is read is only text: the app classifies it
// like any other scan, and trusts none of it. From web/src/qrscan.js,
// whose sizes were tuned on real phones.

import { coreClient } from './core/client.js';
import { BOOT_LIMIT, OTHER_LIMIT, SCAN_LIMITS } from './core/limits.js';
import { SCAN_WORKER, scriptURL } from './trust.js';

/** What can be read: a playing camera, or a decoded picture. @typedef {HTMLVideoElement | ImageBitmap} Source */
/** @typedef {{ native: boolean, read(src: Source): Promise<string[]> }} Reader */
/** @typedef {{ call(op: string, ...args: unknown[]): Promise<any> }} Client */

/**
 * The longest side a frame is read at: a camera frame smaller, for speed
 * (several a second); a picture larger, since the code may fill only part
 * of a photo. Both well inside the reader's own limit (pips-qr's MAX_SIDE,
 * 2560). From web/src/qrscan.js.
 */
const VIDEO_SIDE = 960;
const PICTURE_SIDE = 2048;
/**
 * A picture where the first look found nothing is looked at again, larger,
 * smoothed, one step after another until a code is found: a card picture
 * a messenger shrank to 3/4 and saved as JPEG has codes of two and a half
 * pixels a module, which the reader mostly misses as they are. Measured on
 * 40 such pictures, each with its own code (10.11.2026, Chromium and
 * WebKit): about a quarter read as they are; at ×1.25, ×1.5 or ×1.9 one
 * step or another read all 40 — no one step did. (web/ looked once more,
 * at ×2, and missed some.) Steps past the largest look are not taken, nor
 * one hardly larger than the look before it.
 */
const STEPS = [1.25, 1.5, 1.9];
const WORTH_A_STEP = 1.1;

/**
 * A reader for this browser.
 * @param {{ native?: boolean, client?: Client }} [o] `native`: use
 *   BarcodeDetector where there is one; `client`: the core reader's client
 *   (one is started on first use otherwise)
 * @returns {Promise<Reader>}
 */
export async function qrReader({ native = true, client } = {}) {
  const D = /** @type {any} */ (globalThis).BarcodeDetector;
  const formats = native && D ? await D.getSupportedFormats?.().catch(() => /** @type {string[]} */ ([])) : [];
  if (formats?.includes('qr_code')) {
    const d = new D({ formats: ['qr_code'] });
    return { native: true, read: async (src) => (await d.detect(src)).map((/** @type {any} */ c) => String(c.rawValue)) };
  }
  /** @type {Client | null} */
  let worker = client ?? null;
  const cv = document.createElement('canvas');
  const g = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d', { willReadFrequently: true }));

  /** The codes in `src` drawn at `k` times its size. @param {Source} src @param {number} w0 @param {number} h0 @param {number} k @returns {Promise<string[]>} */
  async function at(src, w0, h0, k) {
    const w = Math.max(1, Math.round(w0 * k));
    const h = Math.max(1, Math.round(h0 * k));
    cv.width = w;
    cv.height = h;
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, w, h);
    const px = g.getImageData(0, 0, w, h).data;
    worker ??= coreClient({ script: scriptURL(SCAN_WORKER), limits: SCAN_LIMITS, otherLimit: OTHER_LIMIT, bootLimit: BOOT_LIMIT });
    return worker.call('scanQr', new Uint8Array(px.buffer, px.byteOffset, px.byteLength), w, h);
  }

  return {
    native: false,
    async read(src) {
      const video = src instanceof HTMLVideoElement;
      const w0 = video ? src.videoWidth : src.width;
      const h0 = video ? src.videoHeight : src.height;
      if (!w0 || !h0) return [];
      const k = Math.min(1, (video ? VIDEO_SIDE : PICTURE_SIDE) / Math.max(w0, h0));
      let found = await at(src, w0, h0, k);
      if (found.length || video) return found;
      let last = k;
      for (const step of STEPS) {
        const next = Math.min(k * step, PICTURE_SIDE / Math.max(w0, h0));
        if (next < last * WORTH_A_STEP) continue;
        found = await at(src, w0, h0, next);
        if (found.length) return found;
        last = next;
      }
      return found;
    },
  };
}
