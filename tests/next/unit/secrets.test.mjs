// @ts-check
// A secret that passes through the core is not left behind in its heap
// (crates/pips-wasm/src/bindings.rs): not the seed, the words, the paper
// key or the backup key once the identity holding them is let go, nor the
// words it was made from. Under node, with the real core, reading its
// memory as the page cannot.
//
// The heap only: what is left there stays until the page closes. The
// stack below it holds copies a moment longer — every call writes over
// the one before — and no Rust code can promise otherwise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const web = new URL('../../../web-next/', import.meta.url);
const core = await import(new URL('pkg/pips_wasm.js', web).href);
const wasm = core.initSync({ module: await readFile(new URL('pkg/pips_wasm_bg.wasm', web)) });

/**
 * Where the heap starts: above the stack, which Rust gives WebAssembly
 * 1 MiB by default (rustc's wasm32 `stack-size`), at the start of memory.
 */
const HEAP = 1 << 20;

/** Whether `needle` is anywhere in the core's heap. @param {Uint8Array} needle */
function inMemory(needle) {
  const hay = new Uint8Array(wasm.memory.buffer);
  outer: for (let i = HEAP; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}
const text = (/** @type {string} */ s) => new TextEncoder().encode(s);

test('the seed, the words, the paper key and the backup key leave no copy in the core once let go', () => {
  const seed = crypto.getRandomValues(new Uint8Array(32));
  const id = core.Identity.fromSeed(seed.slice());
  const words = id.words();
  const paper = id.paper();
  const backup = id.backupKey();
  assert.deepEqual(id.seed(), seed);
  id.free();
  assert.equal(inMemory(seed), false, 'the seed');
  assert.equal(inMemory(text(words)), false, 'the words');
  assert.equal(inMemory(text(paper)), false, 'the paper key');
  assert.equal(inMemory(backup), false, 'the backup key');
});

test('the words a key is restored from, and a backup key handed in, leave no copy either', () => {
  const made = core.Identity.fromSeed(crypto.getRandomValues(new Uint8Array(32)));
  const words = made.words();
  const backup = made.backupKey();
  const owner = Uint8Array.from(made.publicKey().hex.match(/../g), (b) => parseInt(b, 16));
  made.free();
  const again = core.Identity.fromWords(words);
  again.free();
  core.sealBackupWith({ created: 1, profile: { nick: 'k', handle: null, link: '' }, cards: [] }, owner, backup, new Uint8Array(24));
  assert.equal(inMemory(text(words)), false, 'the words typed');
  assert.equal(inMemory(backup), false, 'the backup key');
});
