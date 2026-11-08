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

serve(async () => ({
  ...(await load()),
  /** Never answers. */
  hang() { for (;;) { /* on purpose */ } },
  /** Answers after `ms`. @param {number} ms */
  slow(ms) { const end = Date.now() + ms; while (Date.now() < end) { /* on purpose */ } return ms; },
  /** Traps in WebAssembly. */
  trap() { /** @type {any} */ (new WebAssembly.Instance(new WebAssembly.Module(TRAP)).exports).t(); },
  /** A mistake in JavaScript, not in the core. */
  mistake() { throw new TypeError('on purpose'); },
}));
