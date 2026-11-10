// @ts-check
// Another person's phone, for tests of cards that arrive: a key of its own
// in the real core, cards signed with it, and what a person would hand
// over — a code as a picture, a .pips file, a link. Nothing here is the
// app's own screens: what the receiving phone does is pressed on its
// buttons. window.artist(nick) makes the key; the rest take its cards.
import { coreClient } from '/src/core/client.js';
import { packBundle } from '/src/formats/bundle.js';
import { MAGIC, PUBLISHED } from '/src/formats/links.js';

const w = /** @type {any} */ (window);
const core = coreClient({ script: new URL('./core-worker.js', import.meta.url), limits: {}, otherLimit: 20000, bootLimit: 10000 });
w.core = core;

/** A card as the editor makes one; `pixels` from a seed, so cards differ. @param {string} title @param {number} [side] @param {number} [seed] */
const card = (title, side = 8, seed = 1) => {
  let s = seed;
  return {
    width: side, height: side, opaque: true, frame: 0, frames: 1, delay_ms: 100, palette: { builtin: 0 },
    title, author: w.nick, handle: null, link: '',
    pixels: Uint8Array.from({ length: side * side }, () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return (s >>> 16) % 16; }),
  };
};

/** The key, kept; the artist's name on every card. @param {string} nick */
w.artist = async (nick) => {
  w.nick = nick;
  await core.call('keyNew');
  await core.call('keyKeep');
};
/**
 * The person's own key on another device, from its words: their cards, as
 * the editor would sign them (until the editor comes, stage 5).
 * @param {string} words @param {string} nick
 */
w.asKey = async (words, nick) => {
  w.nick = nick;
  await core.call('keyRestore', { words });
  await core.call('keyKeep', { switching: true });
};
/** An envelope of a new card, as its author sends it. @param {string} title @param {number} [side] @param {number} [seed] */
w.envelope = async (title, side, seed) => core.call('sealOwn', await core.call('signCard', card(title, side, seed)), undefined);
/** The same card passed on by someone else (`nick` as its sender). @param {Uint8Array} envelope @param {string} nick */
w.passOn = async (envelope, nick) => core.call('sealAsSender', (await core.call('openEnvelope', envelope)).payload, nick);

/**
 * A code as a PNG picture, `module` pixels a module, with its margin.
 * @param {string} text @param {number} [module]
 */
w.codePicture = async (text, module = 6) => {
  const m = await core.call('qrMatrix', text);
  const quiet = 4;
  const side = (m.size + 2 * quiet) * module;
  const cv = new OffscreenCanvas(side, side);
  const g = /** @type {OffscreenCanvasRenderingContext2D} */ (cv.getContext('2d'));
  g.fillStyle = '#fff';
  g.fillRect(0, 0, side, side);
  g.fillStyle = '#000';
  for (let y = 0; y < m.size; y++) for (let x = 0; x < m.size; x++) if (m.modules[y * m.size + x]) g.fillRect((x + quiet) * module, (y + quiet) * module, module, module);
  return [...new Uint8Array(await (await cv.convertToBlob({ type: 'image/png' })).arrayBuffer())];
};
/** What one code of an envelope says, or each frame's text for a carousel. @param {Uint8Array} envelope */
w.codeTexts = async (envelope) => {
  const plan = await core.call('qrPlan', envelope);
  if (plan.kind === 'single') return [plan.text];
  return Promise.all(Array.from({ length: plan.fragments + 2 }, (_, seq) => core.call('carouselFrame', envelope, seq)));
};
/** A .pips file of one envelope, or of several. @param {Uint8Array[]} envelopes */
w.pipsFile = (envelopes) => [...(envelopes.length === 1 ? Uint8Array.from([...MAGIC, ...envelopes[0]]) : packBundle(envelopes))];
/**
 * A link to an envelope, as the app makes one here: on the published
 * address, since links are https and the tests' server is not
 * (formats/links.js, linkBase). @param {Uint8Array} envelope
 */
w.link = (envelope) => core.call('cardLink', PUBLISHED, envelope);
/** Someone's paper key — a secret, here a throwaway one — as its text. */
w.paperKey = async () => {
  const made = await core.call('keyNew');
  await core.call('keyDrop');
  return made.paper;
};
w.harness = true;
