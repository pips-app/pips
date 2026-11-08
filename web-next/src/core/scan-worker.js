// @ts-check
// The QR reader's worker: the core's reader (pkg/pips_scan, a module of
// its own) for browsers without BarcodeDetector. A camera frame is the
// least trusted input there is, and the heaviest: here, a frame that
// stalls the reader or makes it panic stops this worker alone — not the
// page, and not the core that signs and opens cards (docs/REWRITE.md,
// "Чтение QR — в своём потоке"). The page talks to it through client.js,
// as to the core.

import { serve } from './serve.js';
import init, * as scan from '../../pkg/pips_scan.js';

serve(async () => {
  await init({ module_or_path: new URL('../../pkg/pips_scan_bg.wasm', import.meta.url) });
  return {
    /**
     * The texts of the QR codes in an RGBA frame, `width` × `height`. The
     * reader refuses a frame larger than it reads (pips-qr's MAX_SIDE,
     * MAX_PIXELS) with no codes.
     * @param {Uint8Array} rgba @param {number} width @param {number} height
     */
    scanQr: (rgba, width, height) => scan.scanQr(rgba, width, height),
  };
});
