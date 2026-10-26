// @ts-check
// The tool bar: what a finger on the canvas does, and two switches —
// the mirror and the precise mode. A second tap on the shapes tool shows
// which shape it draws.

import { h, icon } from '../dom.js';
import { t } from '../i18n.js';

/** @typedef {'pen'|'eraser'|'fill'|'shapes'|'pick'} Tool */
/** @typedef {'line'|'rect'|'rect-fill'|'ellipse'|'ellipse-fill'} Shape */

/** Tools with their keys (shown on a computer). */
export const TOOLS = /** @type {const} */ ([
  { id: 'pen', icon: 'brush', key: 'B' },
  { id: 'eraser', icon: 'eraser', key: 'E' },
  { id: 'fill', icon: 'fill', key: 'G' },
  { id: 'shapes', icon: 'shapes', key: 'U' },
  { id: 'pick', icon: 'pick', key: 'I' },
]);
export const SHAPES = /** @type {const} */ (['line', 'rect', 'rect-fill', 'ellipse', 'ellipse-fill']);

/**
 * @param {{
 *   tool: (t: Tool) => void, shape: (s: Shape) => void,
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
  const shapes = SHAPES.map((s) => h('button', {
    type: 'button', class: 'ed-shape', 'aria-label': t(`ed.shape.${s}`), title: t(`ed.shape.${s}`),
    onclick: () => { o.shape(s); shapeRow.hidden = true; },
  }, icon(s)));
  const shapeRow = h('div', { class: 'ed-shapes', role: 'group', 'aria-label': t('ed.tool.shapes'), hidden: true }, shapes);
  const el = h('nav', { class: 'ed-tools', 'aria-label': t('ed.tools') }, shapeRow, ...tools, mirror, precise, more);

  /** @type {Tool} */
  let current = 'pen';
  /** @param {Tool} id */
  function onTool(id) {
    // Shapes: a second tap shows which shape; any other tool hides that.
    shapeRow.hidden = !(id === 'shapes' && current === 'shapes' && shapeRow.hidden);
    o.tool(id);
  }

  return {
    el,
    /** @param {{tool: Tool, shape: Shape, mirror: boolean, precise: boolean}} s */
    set(s) {
      current = s.tool;
      TOOLS.forEach((tl, k) => tools[k].setAttribute('aria-pressed', String(tl.id === s.tool)));
      const sh = /** @type {HTMLElement} */ (tools[3]);
      sh.replaceChildren(icon(s.shape === 'line' ? 'shapes' : s.shape), h('kbd', {}, 'U'));
      SHAPES.forEach((x, k) => shapes[k].setAttribute('aria-pressed', String(x === s.shape)));
      mirror.setAttribute('aria-pressed', String(s.mirror));
      precise.setAttribute('aria-pressed', String(s.precise));
      if (s.tool !== 'shapes') shapeRow.hidden = true;
    },
  };
}
