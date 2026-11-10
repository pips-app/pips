// @ts-check
// Give: one's own cards, ready to be handed over. The card chosen shows its
// code, to be scanned from this screen — one code, or a carousel for a large
// card — and the ways for someone who is not in the room: the same envelope
// as a link or a .pips file. An own card goes out signed by its author, as
// a plain copy or as a numbered one (ui/edition.js).
// From web/src/ui/give.js and web/src/collection/share.js; the paper and
// the row of small cards come with the collection's art at stage 5.

import { h, replace } from '../dom.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { say } from '../errors.js';
import { MAGIC, linkBase } from '../formats/links.js';
import { codeShow, keepAwake } from './qr.js';
import { fileName, sendFile, sendLink } from './send.js';
import { livePanel } from './edition.js';

/** @typedef {ReturnType<typeof import('../state.js').createState>} State */
/** @typedef {import('../state.js').Entry} Entry */

/** The card last chosen here, kept while the app runs: coming back finds it. @type {string | null} */
let chosen = null;

/** Own cards that can be given (not in the bin), newest first. @param {State} app */
const ownCards = (app) => [...app.cards.values()]
  .filter((e) => e.rec.mine && e.rec.state !== 'trash')
  .sort((a, b) => b.rec.received - a.rec.received);

/**
 * @param {import('./shell.js').Frame & { core: { call(op: string, ...args: unknown[]): Promise<any> }, app: State }} o
 */
export function give({ root, tell, core, app }) {
  const list = ownCards(app);
  const head = [h('h1', {}, t('give.title')), h('p', { class: 'give-sub' }, t('give.sub'))];
  if (!list.length) {
    replace(root, h('main', { class: 'give' }, ...head, h('div', { class: 'give-empty' }, h('b', {}, t('give.empty.title')), h('p', {}, t('give.empty')))));
    return;
  }
  const panel = h('section', { class: 'give-card', 'aria-live': 'polite' });
  const choice = h('div', { class: 'give-choice', role: 'group', 'aria-label': t('give.yours') });
  const page = h('main', { class: 'give' }, ...head, panel, h('h2', { class: 'give-yours' }, t('give.yours')), choice);
  replace(root, page);

  let stop = () => {};
  // The screen stays on while a code is shown, and lets go once the screen is left.
  const release = keepAwake();
  const leave = new MutationObserver(() => { if (!page.isConnected) { stop(); release(); leave.disconnect(); } });
  leave.observe(document.body, { childList: true, subtree: true });

  const buttons = list.map((e) => /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'give-pick', 'aria-pressed': 'false', onclick: () => void lay(e) }, e.card.title || t('card.untitled'))));
  replace(choice, buttons);

  /** Each choice is a turn: a card chosen while the one before was being drawn wins. */
  let turn = 0;

  /** Shows the chosen card's code and ways. @param {Entry} e */
  async function lay(e) {
    const mine = ++turn;
    stop();
    stop = () => {};
    chosen = e.rec.digest;
    buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(list[i] === e)));
    const name = e.card.title || t('card.untitled');
    // Copy or numbered: the panel of numbers lies where the code was.
    const body = h('div', {});
    const modes = /** @type {HTMLButtonElement[]} */ ([
      h('button', { type: 'button', 'aria-pressed': 'true', onclick: () => mode(0) }, t('give.mode.copy')),
      h('button', { type: 'button', 'aria-pressed': 'false', onclick: () => mode(1) }, t('give.mode.edition')),
    ]);
    /** @param {number} which */
    const mode = (which) => {
      modes.forEach((b, i) => b.setAttribute('aria-pressed', String(i === which)));
      if (which === 1) { stop(); stop = livePanel(body, { core, app, tell, digest: e.rec.digest }); } else void copy();
    };
    replace(panel, h('h2', { class: 'give-title' }, name), h('div', { class: 'give-modes', role: 'group', 'aria-label': t('give.mode') }, modes), body);
    await copy();

    async function copy() {
      stop();
      stop = () => {};
      try {
        const env = await core.call('sealOwn', e.rec.payload, undefined);
        const code = await codeShow(core, env, name);
        if (mine !== turn || modes[1].getAttribute('aria-pressed') === 'true') return code.stop();
        stop = code.stop;
        replace(body,
          code.el,
          h('p', { class: 'give-note' }, t('give.hint')),
          h('p', { class: 'give-note small' }, code.plan.kind === 'single' ? t('give.single', env.length) : t('give.carousel', code.plan.fragments)),
          h('div', { class: 'row-btns give-ways', role: 'group', 'aria-label': t('share.ways') },
            h('button', { type: 'button', class: 'btn', onclick: async () => sendLink(tell, await core.call('cardLink', linkBase(location), env), name, t('share.link.text', name)) }, icon('link'), t('share.link')),
            h('button', { type: 'button', class: 'btn', onclick: () => sendFile(tell, new File([new Uint8Array([...MAGIC, ...env])], fileName(name, 'pips'), { type: 'application/octet-stream' }), name) }, icon('file'), t('share.file'))));
      } catch (err) {
        if (mine === turn) replace(body, h('p', { class: 'wrong', role: 'alert' }, say(err)));
      }
    }
  }

  void lay(list.find((e) => e.rec.digest === chosen) ?? list[0]);
}
