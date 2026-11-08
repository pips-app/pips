// @ts-check
// The app's icons: line drawings on a 24-unit square, drawn in the text's
// colour. Built as SVG elements from the shapes below — never parsed from
// markup, which the page's Trusted Types would refuse anyway.

/** @typedef {[tag: string, attrs: Record<string, string | number>][]} Shapes */

/** @type {Record<string, Shapes>} */
const ICONS = {
  lock: [['rect', { x: 5, y: 11, width: 14, height: 10, rx: 2 }], ['path', { d: 'M8 11V8a4 4 0 0 1 8 0v3' }]],
  open: [['rect', { x: 5, y: 11, width: 14, height: 10, rx: 2 }], ['path', { d: 'M8 11V7a4 4 0 0 1 7.5-2' }]],
  qr: [
    ['rect', { x: 4, y: 4, width: 6, height: 6 }], ['rect', { x: 14, y: 4, width: 6, height: 6 }],
    ['rect', { x: 4, y: 14, width: 6, height: 6 }], ['path', { d: 'M14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2' }],
  ],
  check: [['path', { d: 'M5 12.5l4.5 4.5L19 7.5' }]],
  lines: [['path', { d: 'M4 7h16M4 12h16M4 17h10' }]],
};

const SVG = 'http://www.w3.org/2000/svg';

/**
 * An icon, hidden from screen readers: the control it is on is named.
 * @param {keyof typeof ICONS} name
 */
export function icon(name) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'i');
  svg.setAttribute('aria-hidden', 'true');
  for (const [tag, attrs] of ICONS[name]) {
    const el = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    svg.append(el);
  }
  return svg;
}
