// @ts-check
// How long each job of the core may take before its worker is stopped
// (client.js). A limit is not a goal: it is where waiting stops being
// worth it, so that a job that would never end — the QR reader's stalls
// were one — ends with words instead of a frozen screen.
//
// Measured with tests/next/measure.mjs on the largest inputs the core
// takes, on a desktop, 8 November 2026 (worst of Chromium, Firefox and
// WebKit):
//   - every job below the two named here: at most 12 ms;
//   - shareSize, which compresses the card: 310 ms for the largest one;
//   - importPicture: 210 ms for a 2048×2048 picture — half the pixels the
//     core reads (pips-raster's MAX_PIXELS), so twice that is its worst;
//   - the worker's start, loading the core and a first job: 90 ms.
// A slow phone is taken to be ten times slower than that desktop (to check
// on the phone at stage 4, docs/REWRITE.md), and a limit is ten times that
// again: rare enough never to stop a job that would have finished.

/** shareSize: 310 ms × 10 × 10, rounded up. */
const SHARE_SIZE = 31_000;
/** importPicture: 2 × 210 ms × 10 × 10, rounded up. */
const IMPORT = 42_000;

/** Limits by job, in ms. */
export const LIMITS = { shareSize: SHARE_SIZE, importPicture: IMPORT };
/** Any other job: 12 ms × 10 × 10, rounded up to the second. */
export const OTHER_LIMIT = 2_000;
/** The worker's start: 90 ms × 10 × 10, rounded up to the second. */
export const BOOT_LIMIT = 9_000;
