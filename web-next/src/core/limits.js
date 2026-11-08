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
//
// A backup's jobs take time in proportion to its size, and so do their
// limits. Measured the same way on 5000 of the smallest cards, where
// checking each card's signature costs most, and on 200 of the largest,
// where the bytes do (worst engine, each):
//   - sealBackup: 0.28 ms a card (WebKit), and 84 ms a megabyte of cards
//     beyond that (Firefox);
//   - openBackup: 3.2 s a megabyte of the file, of the smallest cards
//     (WebKit); of the largest, 0.15 s. The cards in a file are not known
//     until it is open, so the file is taken to hold the smallest.
// A backup of the 100 000 cards pips-store allows may so wait for hours: a
// limit is where waiting stops being worth it, and for the person's whole
// collection that is far.

/** shareSize: 310 ms × 10 × 10, rounded up. */
const SHARE_SIZE = 31_000;
/** importPicture: 2 × 210 ms × 10 × 10, rounded up. */
const IMPORT = 42_000;
/** Phone ten times slower, and ten times that again. */
const MARGIN = 100;
const MB = 2 ** 20;
/** sealBackup: ms per card, and per byte of the cards (measured above, rounded up). */
const SEAL_CARD = 0.3;
const SEAL_BYTE = 90 / MB;
/** openBackup: ms per byte of the file (measured above, rounded up). */
const OPEN_BYTE = 3_300 / MB;

/** Any other job: 12 ms × 10 × 10, rounded up to the second. */
export const OTHER_LIMIT = 2_000;
/** The worker's start: 90 ms × 10 × 10, rounded up to the second. */
export const BOOT_LIMIT = 9_000;

/** @param {Uint8Array} file a backup */
const opening = (file) => Math.max(OTHER_LIMIT, MARGIN * OPEN_BYTE * file.length);

/** Limits by job, in ms; see client.js, Limit. */
export const LIMITS = {
  shareSize: SHARE_SIZE,
  importPicture: IMPORT,
  /** @param {{ cards: { payload: Uint8Array, cert: Uint8Array | null }[] }} data */
  sealBackup: (data) => {
    const bytes = data.cards.reduce((n, c) => n + c.payload.length + (c.cert?.length ?? 0), 0);
    return Math.max(OTHER_LIMIT, MARGIN * (SEAL_CARD * data.cards.length + SEAL_BYTE * bytes));
  },
  openBackup: opening,
  openBackupWaiting: opening,
};
