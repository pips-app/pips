// @ts-check
// What the core's time limits rest on (src/core/limits.js): its slowest
// jobs on the largest inputs they take, timed inside a worker so that the
// numbers are the core's own. Shared by the phone's page (measure.html)
// and the desktop's (tests/next/measure.mjs), so both measure the same.
// Not part of the app: nothing here keeps a key or touches storage.

/** @typedef {typeof import('../pkg/pips_wasm.js')} Core */
/** @typedef {{ first: number, median: number, max: number }} Times */

/** A seeded stream of small numbers, so every run measures the same input. @param {number} seed */
export function noise(seed) {
  let s = seed >>> 0;
  // The high bits: an LCG's low bits repeat with a short period.
  return (/** @type {number} */ n) => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return (s >>> 16) % n; };
}

/** Runs `f` `times` times. @param {() => unknown} f @param {number} times @returns {Times} */
export function time(f, times) {
  const ms = [];
  for (let i = 0; i < times; i++) {
    const t = performance.now();
    f();
    ms.push(performance.now() - t);
  }
  ms.sort((a, b) => a - b);
  return { first: ms.length ? ms[0] : 0, median: ms[Math.floor(ms.length / 2)], max: ms[ms.length - 1] };
}

/**
 * The largest card the format takes: every pixel it allows, in as many
 * colours as still fit a payload's 65535 bytes.
 * @param {Core} core
 */
export function largestCard(core) {
  for (const colors of [32, 16, 8, 4, 2]) {
    const next = noise(colors);
    const card = {
      width: 128, height: 128, opaque: false, frame: 0, frames: 16, delay_ms: 100,
      palette: { inline: Array.from({ length: 32 }, (_, i) => [i * 8, 255 - i * 8, (i * 37) & 255]) },
      title: 'Ж'.repeat(16), author: 'a'.repeat(24), handle: null, link: 'example.com/' + 'a'.repeat(40),
      pixels: Uint8Array.from({ length: 128 * 128 * 16 }, () => next(colors)),
    };
    try {
      core.shareSize(card);
      return { card, colors };
    } catch { /* too large in this many colours: try fewer */ }
  }
  throw new Error('no card fits');
}

/**
 * Sealing and opening backups, per byte: of the smallest cards, where
 * checking each card's signature costs most, and of the largest, where the
 * bytes do. A backup's jobs take time in proportion to its size, and their
 * limits do too.
 * @param {Core} core @param {number} small how many 1×1 cards @param {number} large how many of the largest
 */
export function measureBackup(core, small, large) {
  const id = core.Identity.fromSeed(new Uint8Array(32).fill(7));
  try {
    const { card } = largestCard(core);
    const tiny = { ...card, width: 1, height: 1, frames: 1, palette: { builtin: 0 }, title: '', author: '', link: '', pixels: new Uint8Array(1) };
    const key = id.backupKey();
    const pk = Uint8Array.from(id.publicKey().hex.match(/../g) ?? [], (b) => parseInt(b, 16));
    /** @type {Record<string, { cards: number, file: number, payloads: number, seal: Times, open: Times, sealPerMB: number, openPerMB: number }>} */
    const out = {};
    for (const [name, n, at] of /** @type {[string, number, (i: number) => any][]} */ ([
      ['1×1', small, (i) => ({ ...tiny, title: String(i) })],
      ['largest', large, (i) => ({ ...card, title: String(i) })],
    ])) {
      const cards = Array.from({ length: n }, (_, i) => ({
        payload: id.signCard(at(i)), cert: null, edition: null, mine: true, state: 'collection',
        received: 1, trashedAt: null, from: null, note: '', tags: [],
      }));
      const data = { created: 1, profile: { nick: 'k', handle: null, link: '' }, cards };
      /** @type {Uint8Array} */
      let file = new Uint8Array(0);
      const seal = time(() => { file = core.sealBackupWith(data, pk, key, new Uint8Array(24)); }, 3);
      const open = time(() => core.openBackupWith(file, pk, key), 3);
      const payloads = cards.reduce((sum, c) => sum + c.payload.length, 0);
      out[name] = { cards: n, file: file.length, payloads, seal, open,
        sealPerMB: (seal.max / payloads) * 2 ** 20, openPerMB: (open.max / file.length) * 2 ** 20 };
    }
    return out;
  } finally {
    id.free();
  }
}
