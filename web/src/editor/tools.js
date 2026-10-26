// @ts-check
// The tool bar: what a finger on the canvas does, and two switches — the
// mirror and the precise mode. A second tap on the pen or the shapes tool
// shows its kinds: a plain pen or a dithering one; a line, rectangles,
// ellipses.

import { h, icon } from '../dom.js';
import { t } from '../i18n.js';

/** @typedef {'pen'|'eraser'|'fill'|'shapes'|'select'|'pick'} Tool */
/** @typedef {'line'|'rect'|'rect-fill'|'ellipse'|'ellipse-fill'} Shape */
/** @typedef {'solid'|'dither'} PenMode */

/** Tools with their keys (shown on a computer). */
export const TOOLS = /** @type {const} */ ([
  { id: 'pen', icon: 'brush', key: 'B' },
  { id: 'eraser', icon: 'eraser', key: 'E' },
  { id: 'fill', icon: 'fill', key: 'G' },
  { id: 'shapes', icon: 'shapes', key: 'U' },
  { id: 'select', icon: 'select', key: 'S' },
  { id: 'pick', icon: 'pick', key: 'I' },
]);
export const SHAPES = /** @type {const} */ (['line', 'rect', 'rect-fill', 'ellipse', 'ellipse-fill']);
export const PENS = /** @type {const} */ ([{ id: 'solid', icon: 'brush' }, { id: 'dither', icon: 'dither' }]);

/**
 * @param {{
 *   tool: (t: Tool) => void, shape: (s: Shape) => void, pen: (m: PenMode) => void,
 *   mirror: () => void, precise: () => void, more: () => void,
 * }} o
 */
export function toolBar(o) {
  /** @param {string} id @param {any} ic @param {string} label @param {() => void} run @param {string} [key] */
  const btn = (id, ic, label, run, key) => h('button', {
    type: 'button', class: `ed-tool ed-tool-${id}`, 'aria-label': label, title: key ? `${label} (${key})` : label, onclick: run,
  }, icon(ic), key ? h('kbd', {}, key) : null);
  const tools = TOOLS.map((tl) => btn(tl.id, tl.icon, t(`ed.tool.${tl.id}`), () => onTool(tl.id), tl.key));
  const mirror = btn('mirror', 'mirror', t('ed.mirror'), o.mirror, 'M');
  const precise = btn('precise', 'aim', t('ed.precise'), o.precise);
  const more = btn('more', 'more', t('ed.more'), o.more);

  /** A row of kinds above the bar. @param {string} label @param {{id: string, icon: any, label: string}[]} kinds @param {(id: string) => void} pick */
  const row = (label, kinds, pick) => {
    const buttons = kinds.map((k) => h('button', {
      type: 'button', class: 'ed-shape', dataset: { kind: k.id }, 'aria-label': k.label, title: k.label,
      onclick: () => { pick(k.id); el.hidden = true; },
    }, icon(k.icon)));
    const el = h('div', { class: 'ed-shapes', role: 'group', 'aria-label': label, hidden: true }, buttons);
    return { el, buttons };
  };
  const shapes = row(t('ed.tool.shapes'), SHAPES.map((s) => ({ id: s, icon: s, label: t(`ed.shape.${s}`) })), (s) => o.shape(/** @type {Shape} */ (s)));
  const pens = row(t('ed.tool.pen'), PENS.map((p) => ({ id: p.id, icon: p.icon, label: t(`ed.pen.${p.id}`) })), (m) => o.pen(/** @type {PenMode} */ (m)));
  const el = h('nav', { class: 'ed-tools', 'aria-label': t('ed.tools') }, shapes.el, pens.el, ...tools, mirror, precise, more);

  /** @type {Tool} */
  let current = 'pen';
  /** A second tap on the pen or the shapes shows their kinds; anything else hides them. @param {Tool} id */
  function onTool(id) {
    const again = id === current;
    shapes.el.hidden = !(id === 'shapes' && again && shapes.el.hidden);
    pens.el.hidden = !(id === 'pen' && again && pens.el.hidden);
    o.tool(id);
  }

  return {
    el,
    /** @param {{tool: Tool, shape: Shape, pen: PenMode, mirror: boolean, precise: boolean}} s */
    set(s) {
      current = s.tool;
      TOOLS.forEach((tl, k) => tools[k].setAttribute('aria-pressed', String(tl.id === s.tool)));
      tools[0].replaceChildren(icon(s.pen === 'dither' ? 'dither' : 'brush'), h('kbd', {}, 'B'));
      tools[3].replaceChildren(icon(s.shape === 'line' ? 'shapes' : s.shape), h('kbd', {}, 'U'));
      for (const b of shapes.buttons) b.setAttribute('aria-pressed', String(b.dataset.kind === s.shape));
      for (const b of pens.buttons) b.setAttribute('aria-pressed', String(b.dataset.kind === s.pen));
      mirror.setAttribute('aria-pressed', String(s.mirror));
      precise.setAttribute('aria-pressed', String(s.precise));
      if (s.tool !== 'shapes') shapes.el.hidden = true;
      if (s.tool !== 'pen') pens.el.hidden = true;
    },
  };
}
