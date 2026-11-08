// @ts-check
// The core's real worker, plus jobs that misbehave: what the client must
// survive without the page reloading.
import { serve } from '/src/core/serve.js';
import { load } from '/src/core/ops.js';

/** A WebAssembly module whose one function is `unreachable`: a real trap, as a panic in Rust ends. */
const TRAP = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // magic, version
  0x01, 0x04, 0x01, 0x60, 0x00, 0x00, // type: () -> ()
  0x03, 0x02, 0x01, 0x00, // one function of that type
  0x07, 0x05, 0x01, 0x01, 0x74, 0x00, 0x00, // export it as "t"
  0x0a, 0x05, 0x01, 0x03, 0x00, 0x00, 0x0b, // body: unreachable
]);

/** Busy for `ms`, then answers it. @param {number} ms */
function busy(ms) { const end = Date.now() + ms; while (Date.now() < end) { /* on purpose */ } return ms; }

serve(async () => ({
  ...(await load()),
  /** Never answers. */
  hang() { for (;;) { /* on purpose */ } },
  /** Answers after `ms`. */
  slow: busy,
  /** Answers after `ms`; its limit is its second argument (harness/core.js). */
  sized: busy,
  /** Traps in WebAssembly. */
  trap() { /** @type {any} */ (new WebAssembly.Instance(new WebAssembly.Module(TRAP)).exports).t(); },
  /** Answers, then throws where nothing catches it: the worker's own error. */
  throwLater() { setTimeout(() => { throw new Error('thrown later, on purpose'); }); return 'thrown later'; },
  /** A mistake in JavaScript, not in the core. */
  mistake() { throw new TypeError('on purpose'); },
}));
