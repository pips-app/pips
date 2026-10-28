// @ts-check
// Give: one's own cards, ready to be handed over. The card chosen lies on
// its own paper with its code, exactly as the share sheet shows it (the
// same component: copy or numbered, link, file, picture); below, the
// person's cards as a row of small papers to choose from, the chosen one
// lifted. At a meeting it is one tap from the tab bar to a code.

import { h, icon, replace, reveal } from '../dom.js';
import { t } from '../i18n.js';
import { app } from '../state.js';
import { go } from './shell.js';
import { artCanvas, FRAME_SHADES, cardTitle } from './card.js';
import { fillShare } from '../collection/share.js';

/** The card last chosen here, kept while the app runs. @type {string|null} */
let chosen = null;

/** Own cards that can be given (not in the bin), newest first. */
const ownCards = () => [...app.cards.values()]
  .filter((e) => e.rec.mine && e.rec.state !== 'trash')
  .sort((a, b) => b.rec.received - a.rec.received);

/** The code's side here: as large as fits above the row of cards. */
const sizeHere = () => Math.round(Math.max(180, Math.min(300, innerWidth - 96, innerHeight - 576)));

export function giveView() {
  const paper = h('div', { class: 'give-paper on-paper' });
  const body = h('div', { class: 'paper-body' });
  paper.append(body);
  const deck = h('div', { class: 'give-deck', role: 'group', 'aria-label': t('give.yours') });
  const count = h('span', {});
  const deckBox = h('div', { class: 'give-deck-box' }, h('div', { class: 'give-deck-head' }, h('span', {}, t('give.yours')), count), deck);
  const main = h('div', { class: 'scroll give-scroll' }, paper);
  const el = h('section', { class: 'view give-view' },
    h('div', { class: 'bar' }, h('div', { class: 'title' }, h('h1', {}, t('give.title')), h('div', { class: 'sub' }, t('give.sub')))),
    main, deckBox);

  let stop = () => {};

  /** Lays the chosen card on the paper. @param {import('../state.js').Entry} e */
  function lay(e) {
    stop();
    chosen = e.rec.digest;
    const s = FRAME_SHADES[e.card.frame] ?? FRAME_SHADES[0];
    paper.style.setProperty('--shade', s.paper);
    paper.style.setProperty('--shade-ink', s.ink);
    paper.style.setProperty('--shade-dim', s.dim);
    stop = fillShare(body, e, { size: sizeHere(), hint: t('give.hint') });
    for (const b of deck.querySelectorAll('.give-mini')) {
      const on = /** @type {HTMLElement} */ (b).dataset.id === chosen;
      b.setAttribute('aria-pressed', String(on));
      if (on) reveal(deck, b);
    }
  }

  function show() {
    const list = ownCards();
    count.textContent = String(list.length);
    if (!list.length) {
      stop();
      stop = () => {};
      el.classList.add('empty-give');
      replace(main, h('div', { class: 'empty' },
        h('b', {}, t('give.empty.title')), t('give.empty'),
        h('div', { style: { marginTop: '18px' } }, h('button', { class: 'btn key', onclick: () => go('draw') }, icon('brush'), t('give.empty.draw')))));
      deckBox.hidden = true;
      return;
    }
    el.classList.remove('empty-give');
    deckBox.hidden = false;
    if (!main.contains(paper)) replace(main, paper);
    replace(deck, ...list.map((e) => {
      const s = FRAME_SHADES[e.card.frame] ?? FRAME_SHADES[0];
      const b = h('button', {
        type: 'button', class: 'give-mini', dataset: { id: e.rec.digest }, 'aria-label': cardTitle(e.card), title: cardTitle(e.card),
        onclick: () => lay(e),
      }, artCanvas(e.card, e.rec.digest));
      b.style.setProperty('--shade', s.paper);
      return b;
    }), h('button', { type: 'button', class: 'give-mini add', 'aria-label': t('give.new'), title: t('give.new'), onclick: () => go('draw') }, icon('plus')));
    lay(list.find((e) => e.rec.digest === chosen) ?? list[0]);
  }

  return {
    el,
    show,
    hide() { stop(); stop = () => {}; },
  };
}
