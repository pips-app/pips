// @ts-check
// The jobs the core's worker does, by name: the core's functions the app
// may call, and nothing else of the module (its glue and memory stay
// inside the worker). Loaded only in the worker.
//
// What lives between calls: the person's key (keys.js) and the carousel
// being put together (joiner.js; docs/REWRITE.md, "Операции ядра").

import init, * as core from '../../pkg/pips_wasm.js';
import { keyOps } from './keys.js';
import { joinerOps } from './joiner.js';

/** Loads the core and lists its jobs. */
export async function load() {
  await init({ module_or_path: new URL('../../pkg/pips_wasm_bg.wasm', import.meta.url) });
  return {
    ...keyOps,
    ...joinerOps,
    errorCodes: core.errorCodes,
    palettes: core.palettes,
    recoveryWords: core.recoveryWords,
    shareSize: core.shareSize,
    render: core.render,
    openEnvelope: core.openEnvelope,
    inspectCard: core.inspectCard,
    importPicture: core.importPicture,
    backupOwner: core.backupOwner,
    classify: core.classify,
    cardLink: core.cardLink,
    parseLink: core.parseLink,
    qrPlan: core.qrPlan,
    qrMatrix: core.qrMatrix,
    sealOwn: core.sealOwn,
    /**
     * One frame of a carousel. Making the encoder costs a copy of the
     * bytes and their checksum, so each frame makes its own: no handle to
     * keep, and nothing lost if the worker restarts.
     * @param {Uint8Array} bytes @param {number} seq
     */
    carouselFrame(bytes, seq) {
      const c = new core.Carousel(bytes);
      try {
        return c.frameText(seq);
      } finally {
        c.free();
      }
    },
  };
}
