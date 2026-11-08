// @ts-check
// Times the core's jobs on the largest inputs they accept, inside the
// worker, so the numbers are the core's own and not the messages'. Run by
// measure.mjs; the limits in web-next/src/core/limits.js come from it.
import { serve } from '/src/core/serve.js';
import { load } from '/src/core/ops.js';
import * as core from '/pkg/pips_wasm.js';

/** A seeded stream of small numbers, so every run measures the same input. @param {number} seed */
function noise(seed) {
  let s = seed >>> 0;
  // The high bits: an LCG's low bits repeat with a short period.
  return (/** @type {number} */ n) => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return (s >>> 16) % n; };
}

/**
 * The largest card the format takes: every pixel it allows, in as many
 * colours as still fit a payload's 65535 bytes.
 */
function largestCard() {
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

/** @param {() => unknown} f @param {number} times */
function time(f, times) {
  const ms = [];
  for (let i = 0; i < times; i++) {
    const t = performance.now();
    f();
    ms.push(performance.now() - t);
  }
  ms.sort((a, b) => a - b);
  return { first: ms.length ? ms[0] : 0, median: ms[Math.floor(ms.length / 2)], max: ms[ms.length - 1] };
}

serve(async () => {
  const ops = await load();
  return {
    ...ops,
    /** @param {Record<string, Uint8Array>} pictures files to import, by name */
    measure(pictures) {
      const { card, colors } = largestCard();
      const id = core.Identity.fromSeed(new Uint8Array(32).fill(7));
      const payload = id.signCard(card);
      const envelope = id.sealAsAuthor(payload, undefined);
      // A link holds less than a code: the largest card that still fits one.
      let small = envelope;
      for (const frames of [8, 4, 2, 1]) {
        const c = { ...card, frames, pixels: card.pixels.subarray(0, 128 * 128 * frames) };
        small = id.sealAsAuthor(id.signCard(c), undefined);
        try { core.cardLink('https://pips-app.github.io/pips/', small); break; } catch { /* try fewer frames */ }
      }
      const link = core.cardLink('https://pips-app.github.io/pips/', small);
      const plan = core.qrPlan(envelope);
      const text = plan.kind === 'single' ? plan.text : ops.carouselFrame(envelope, 0);
      /** @type {Record<string, unknown>} */
      const out = { card: { colors, payload: payload.length, envelope: envelope.length, plan: plan.kind, link: link.length } };
      const n = 15;
      out.palettes = time(() => ops.palettes(), n);
      out.errorCodes = time(() => ops.errorCodes(), n);
      out.recoveryWords = time(() => ops.recoveryWords(), n);
      out.shareSize = time(() => ops.shareSize(card), n);
      out.render = time(() => ops.render(card, 15), n);
      out.openEnvelope = time(() => ops.openEnvelope(envelope), n);
      out.inspectCard = time(() => ops.inspectCard(payload), n);
      out.classify = time(() => ops.classify(link), n);
      out.parseLink = time(() => ops.parseLink(link), n);
      out.cardLink = time(() => ops.cardLink('https://pips-app.github.io/pips/', small), n);
      out.qrPlan = time(() => ops.qrPlan(envelope), n);
      out.qrMatrix = time(() => ops.qrMatrix(text), n);
      out.carouselFrame = time(() => ops.carouselFrame(envelope, 1000), n);
      out.backupOwner = time(() => { try { ops.backupOwner(envelope); } catch { /* not a backup: the refusal is what is timed */ } }, n);
      for (const [name, bytes] of Object.entries(pictures)) {
        for (const [how, o] of Object.entries({
          exact: {},
          fit: { fit: 32 },
          nearest: { palette: 0 },
        })) {
          out[`importPicture ${name} ${how}`] = time(() => {
            try { ops.importPicture(bytes, { solidAlpha: true, ...o }); } catch { /* a refusal is timed too */ }
          }, 3);
        }
      }
      return out;
    },

    /**
     * Sealing and opening backups, per byte of the file: of the smallest
     * cards, where checking each card's signature costs most, and of the
     * largest, where the bytes do. A backup's jobs take time in proportion
     * to its size, and their limits do too (limits.js).
     * @param {number} small how many 1×1 cards @param {number} large how many of the largest
     */
    measureBackup(small, large) {
      const id = core.Identity.fromSeed(new Uint8Array(32).fill(7));
      const { card } = largestCard();
      const tiny = { ...card, width: 1, height: 1, frames: 1, palette: { builtin: 0 }, title: '', author: '', link: '', pixels: new Uint8Array(1) };
      /** @type {Record<string, unknown>} */
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
        const key = id.backupKey();
        const pub = id.publicKey();
        const pk = Uint8Array.from(pub.hex.match(/../g) ?? [], (b) => parseInt(b, 16));
        /** @type {Uint8Array} */
        let file = new Uint8Array(0);
        const seal = time(() => { file = core.sealBackupWith(data, pk, key, new Uint8Array(24)); }, 3);
        const open = time(() => core.openBackupWith(file, pk, key), 3);
        const payloads = cards.reduce((sum, c) => sum + c.payload.length, 0);
        out[name] = { cards: n, file: file.length, payloads, seal, open,
          sealPerMB: (seal.max / payloads) * 2 ** 20, openPerMB: (open.max / file.length) * 2 ** 20 };
      }
      return out;
    },
  };
});
