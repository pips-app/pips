// @ts-check
// The layers: a list, top layer first, as they lie over each other — each
// with its picture in the open frame and an eye that shows or hides it —
// and what can be done with the chosen one: a new layer above it, moving
// it up or down, pressing it into the one below, deleting it. A tap on a
// row chooses the layer the tools draw on. The sheet is low: the canvas
// stays in view above it, so every change is seen as it is made. However
// many layers there are, the list scrolls and the actions stay where they
// are, at the foot: a button never moves away from the finger.
//
// Layers are the editor's own: when the card is signed, its visible layers
// become one picture; hidden ones are left out (said under the list).

import { h, icon, reveal } from '../dom.js';
import { t } from '../i18n.js';
import { bottomSheet } from '../kit/bottom-sheet.js';
import { MAX_LAYERS } from './model.js';
import { paintCells } from './frames.js';

/**
 * @param {{
 *   model: ReturnType<typeof import('./model.js').createModel>,
 *   frame: () => number, layer: () => number, choose: (l: number) => void,
 * }} o choose: the layer the tools draw on from now
 */
export function layersSheet(o) {
  const { model } = o;
  const sheet = bottomSheet({ label: t('ed.layers'), low: true });
  const list = h('ol', { class: 'ed-layers', reversed: true });
  /** @param {any} ic @param {string} label @param {() => void} run @param {boolean} [bare] the arrow alone says it (the name stays, as a hint and for screen readers) */
  const act = (ic, label, run, bare = false) => h('button', {
    type: 'button', class: `btn ed-layer-act${bare ? ' bare' : ''}`, onclick: run, 'aria-label': bare ? label : null, title: bare ? label : null,
  }, icon(ic), bare ? '' : h('span', {}, label));
  const add = act('plus', t('ed.layer.add'), () => { const l = model.addLayer(o.layer()); if (l >= 0) o.choose(l); });
  const up = act('up', t('ed.layer.up'), () => { const l = o.layer(); if (model.moveLayer(l, l + 1)) o.choose(l + 1); }, true);
  const down = act('down', t('ed.layer.down'), () => { const l = o.layer(); if (model.moveLayer(l, l - 1)) o.choose(l - 1); }, true);
  const merge = act('merge', t('ed.layer.merge'), () => { const l = o.layer(); if (model.mergeDown(l)) o.choose(l - 1); });
  const remove = act('trash', t('ed.layer.remove'), () => { const l = o.layer(); if (model.removeLayer(l)) o.choose(Math.max(0, l - 1)); });
  // Two rows on any phone: what makes and moves layers, then what joins and deletes them.
  const acts = h('div', { class: 'ed-layer-acts' }, h('div', {}, add, up, down), h('div', {}, merge, remove));
  sheet.body.append(list, h('p', { class: 'ed-note' }, t('ed.layer.note')));
  sheet.foot.append(acts);

  function paint() {
    if (!sheet.open) return;
    const d = model.doc, f = Math.min(o.frame(), d.frames.length - 1), cur = Math.min(o.layer(), d.layers.length - 1);
    // Drawn anew: the keyboard's place in the list is kept (the same row, the same button).
    const had = /** @type {HTMLElement|null} */ (list.contains(document.activeElement) ? document.activeElement : null);
    const at = had && { n: had.dataset.n, eye: had.classList.contains('ed-layer-eye') };
    const rows = d.layers.map((layer, l) => {
      const cv = /** @type {HTMLCanvasElement} */ (h('canvas', { class: 'ed-layer-art' }));
      paintCells(cv, d, d.frames[f][l]);
      const name = t('ed.layer.n', layer.n);
      const eye = layer.hidden ? t('ed.layer.show', layer.n) : t('ed.layer.hide', layer.n);
      return h('li', { class: `${l === cur ? 'here' : ''} ${layer.hidden ? 'hidden' : ''}` },
        h('button', { type: 'button', class: 'ed-layer-pick', dataset: { n: String(layer.n) }, 'aria-pressed': String(l === cur), onclick: () => o.choose(l) }, cv, h('b', {}, name)),
        h('button', { type: 'button', class: 'ed-layer-eye', dataset: { n: String(layer.n) }, 'aria-pressed': String(!layer.hidden), 'aria-label': eye, title: eye, onclick: () => model.setHidden(l, !layer.hidden) },
          icon(layer.hidden ? 'eye-off' : 'eye')));
    }).reverse(); // the top layer on top, as they lie
    list.replaceChildren(...rows);
    if (at) /** @type {HTMLElement|null} */ (list.querySelector(`${at.eye ? '.ed-layer-eye' : '.ed-layer-pick'}[data-n="${at.n}"]`))?.focus();
    const here = list.querySelector('li.here');
    if (here) reveal(sheet.body, here); // the chosen layer in view, as it moves up or down
    /** @type {HTMLButtonElement} */ (add).disabled = d.layers.length >= MAX_LAYERS;
    /** @type {HTMLButtonElement} */ (up).disabled = cur >= d.layers.length - 1;
    /** @type {HTMLButtonElement} */ (down).disabled = cur <= 0;
    /** @type {HTMLButtonElement} */ (merge).disabled = !model.canMerge(cur);
    /** @type {HTMLButtonElement} */ (remove).disabled = d.layers.length < 2;
  }

  return {
    els: sheet.els,
    get open() { return sheet.open; },
    show() { sheet.show(); paint(); },
    close: () => sheet.close(),
    /** Again, after any change of the picture or of the chosen layer. */
    paint,
  };
}
