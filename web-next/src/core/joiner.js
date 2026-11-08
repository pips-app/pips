// @ts-check
// Putting a carousel back together, in the core's worker: the one thing
// besides the key that lives between jobs (docs/REWRITE.md, "Операции
// ядра"). One carousel at a time — the person points the camera at one —
// so there is no handle to keep: the page sends frames and hears how far
// it is. A frame of another carousel starts over with that one. A worker
// restarted meanwhile has forgotten the frames; the next one starts anew,
// and the progress the page shows says so (the person scans on).

import * as core from '../../pkg/pips_wasm.js';

/** The carousel being put together, if any. @type {core.Joiner | null} */
let joiner = null;

/** @typedef {{ kind: 'partial', have: number, need: number } | { kind: 'done', bytes: Uint8Array }} Progress */

/** The joiner's jobs, by name (ops.js lists them with the core's). */
export const joinerOps = {
  /**
   * One frame's bytes (as classify gives them): how far the carousel is,
   * or its message once whole.
   * @param {Uint8Array} frame @returns {Progress}
   */
  joinFrame(frame) {
    joiner ??= new core.Joiner();
    /** @type {Progress} */
    let p;
    try {
      p = joiner.push(frame);
    } catch {
      // A frame that does not fit this carousel: another one. Start over
      // with it; if it does not fit an empty joiner either, that refusal is
      // the answer.
      joiner.free();
      joiner = new core.Joiner();
      p = joiner.push(frame);
    }
    if (p.kind === 'done') joinReset();
    return p;
  },

  /** Forgets the carousel being put together (the scanner closed). */
  joinReset,
};

function joinReset() {
  joiner?.free();
  joiner = null;
}
