// @ts-check
// Developer mode: tools for trying the app out, kept out of everyone's way.
// Profile ends with a folded «For developers»; inside, a field that turns
// the mode on only for the exact phrase — no tap, swipe or slip of the
// keyboard gets there by chance. With it on, the group offers sample cards
// (added only after a confirmation, and removable as a set) and the way
// to turn the mode off.

import { h, replace } from '../dom.js';
import { t } from '../i18n.js';
import { app, addOwn, receive, backdate, purge } from '../state.js';
import { getMeta, setMeta } from '../store.js';
import { toast, ask, go } from './shell.js';
import { toCard } from '../editor/to-card.js';
import { T } from '../editor/model.js';
import { parseHex } from '../editor/color.js';
import { caught } from '../diagnostics.js';

export const PHRASE = 'I am a developer';
const DIGITS = '0123456789abcdefghijklmnopqrstuv';
const DAY = 86_400_000;

/** The Profile group: the gate while the mode is off, the tools once on. */
export async function developerGroup() {
  const box = h('div', { class: 'group developer' });
  const paint = async () => {
    if (await getMeta('developer')) return tools();
    const field = /** @type {HTMLInputElement} */ (h('input', {
      type: 'text', autocomplete: 'off', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false',
      'aria-label': t('dev.phrase'), placeholder: t('dev.phrase'),
    }));
    field.addEventListener('input', async () => {
      if (field.value !== PHRASE) return;
      await setMeta('developer', true);
      toast(t('dev.on'));
      paint();
    });
    replace(box, h('details', { class: 'dev-gate' },
      h('summary', {}, t('dev.title')),
      h('p', { class: 'hint lead' }, t('dev.gate')),
      h('div', { class: 'field' }, field)));
  };
  const tools = async () => {
    /** @type {string[]} */
    const added = ((await getMeta('samples')) ?? []).filter((/** @type {string} */ d) => app.cards.has(d));
    const { DRAWN, FILES } = await import('../../samples/samples.js');
    const count = DRAWN.length + FILES.length;
    replace(box, h('h2', {}, t('dev.title')),
      h('p', { class: 'hint lead' }, t('dev.samples.hint', count)),
      h('div', { class: 'row-btns' },
        h('button', { class: 'btn', onclick: (/** @type {Event} */ e) => run(e, t('dev.samples.add.ask', count), async () => toast(t('dev.samples.added', await seed()))) }, t('dev.samples.add')),
        h('button', { class: 'btn', disabled: !added.length, onclick: (/** @type {Event} */ e) => run(e, t('dev.samples.remove.ask', added.length), async () => toast(t('dev.samples.removed', await unseed()))) }, t('dev.samples.remove', added.length))),
      h('button', { class: 'btn wide', style: { marginTop: '8px' }, onclick: async () => { await setMeta('developer', false); paint(); } }, t('dev.off')));
  };
  /**
   * A tool's action, asked about first, with the button held meanwhile.
   * @param {Event} e @param {string} question @param {() => Promise<void>} act
   */
  const run = async (e, question, act) => {
    const b = /** @type {HTMLButtonElement} */ (e.currentTarget);
    if (!(await ask(question, { yes: t('dev.go') }))) return;
    b.disabled = true;
    try {
      await act();
    } catch (err) {
      caught(err, 'developer');
      toast(`${t('err.generic')}: ${/** @type {any} */ (err)?.message ?? err}`);
    }
    paint();
  };
  await paint();
  return box;
}

/**
 * Adds the sample cards: those marked `mine` signed with the person's key
 * and back, as their own work would be; the others from made-up artists,
 * some passed on by another, spread over the past weeks.
 * @returns {Promise<number>} cards added
 */
async function seed() {
  const { DRAWN, FILES } = await import('../../samples/samples.js');
  const artists = ['dapple', 'mossfern', 'kitsu', 'vellum'].map((nick) => ({ nick, id: app.core.Identity.fromSeed(crypto.getRandomValues(new Uint8Array(32))) }));
  const builtins = new Map(app.core.palettes().map((/** @type {any} */ p) => [p.id, p.colors.map((/** @type {number[]} */ c) => (c[0] << 16) | (c[1] << 8) | c[2])]));
  const p = app.profile;
  const own = { nick: p.nick, handle: p.handle, link: p.link };
  const theirs = (/** @type {string} */ nick) => ({ nick, handle: { network: 'telegram', text: nick }, link: `${nick}.art` });

  /** @param {any} s @param {{nick: string, handle: any, link: string}} by */
  const fromRows = (s, by) => {
    const r = toCard({
      size: s.size, title: s.title, shade: s.shade, delay: s.delay, builtin: s.builtin ?? null,
      colors: s.builtin != null ? builtins.get(s.builtin) : s.colors.map((/** @type {string} */ c) => parseHex(c)),
      frames: s.frames.map((/** @type {string[]} */ rows) => Uint8Array.from(rows.join(''), (ch) => (ch === '.' ? T : DIGITS.indexOf(ch)))),
    }, by);
    if (!('card' in r)) throw new Error(`sample «${s.title}»: ${r.problem}`);
    return r.card;
  };
  /** @param {any} s @param {{nick: string, handle: any, link: string}} by */
  const fromFile = async (s, by) => {
    const bytes = new Uint8Array(await (await fetch(new URL(`../../samples/${s.file}`, import.meta.url))).arrayBuffer());
    const r = app.core.importPicture(bytes, s.palette != null ? { palette: s.palette } : { fit: s.fit });
    return { ...r.card, title: s.title, frame: s.shade, author: by.nick, handle: by.handle ?? null, link: by.link };
  };

  /** @type {string[]} */
  const digests = [];
  let k = 0;
  for (const s of /** @type {any[]} */ ([...DRAWN, ...FILES])) {
    const make = (/** @type {any} */ by) => (s.file ? fromFile(s, by) : Promise.resolve(fromRows(s, by)));
    if (s.mine) {
      digests.push((await addOwn(app.identity.signCard(await make(own)))).digest);
      continue;
    }
    const a = artists[k % artists.length], relay = artists[(k + 1) % artists.length];
    const payload = a.id.signCard(await make(theirs(a.nick)));
    const env = k % 4 === 1 ? relay.id.sealAsSender(payload, relay.nick) : a.id.sealAsAuthor(payload, undefined);
    const r = await receive(app.core.openEnvelope(env));
    await backdate(r.digest, Date.now() - Math.floor(k * 6.3 + (k % 3)) * DAY);
    digests.push(r.digest);
    k++;
  }
  await setMeta('samples', [...new Set([...((await getMeta('samples')) ?? []), ...digests])]);
  go('collection');
  return digests.length;
}

/** Removes the sample cards added here, and nothing else. @returns {Promise<number>} */
async function unseed() {
  /** @type {string[]} */
  const list = (await getMeta('samples')) ?? [];
  let n = 0;
  for (const d of list) {
    if (!app.cards.has(d)) continue;
    await purge(d);
    n++;
  }
  await setMeta('samples', []);
  return n;
}
