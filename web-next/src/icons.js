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
  // From web/src/dom.js, as drawn there.
  give: [['rect', { x: 6, y: 3, width: 12, height: 15, rx: 1.5 }], ['path', { d: 'M9 21h6M12 13V7M9.5 9.5L12 7l2.5 2.5' }]],
  file: [['path', { d: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z' }], ['path', { d: 'M14 3v5h5' }]],
  image: [['rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }], ['path', { d: 'M3 16l5-5 4 4 3-3 6 6' }]],
  link: [['path', { d: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1' }], ['path', { d: 'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1' }]],
  key: [['circle', { cx: 8, cy: 15, r: 4 }], ['path', { d: 'M11 12l9-9M17 6l3 3M15 8l2 2' }]],
  camera: [['path', { d: 'M4 8.5a2 2 0 0 1 2-2h2l1.5-2h5L16 6.5h2a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z' }], ['circle', { cx: 12, cy: 12.5, r: 3.5 }]],
  scan: [['path', { d: 'M4 9V6a2 2 0 0 1 2-2h3M15 4h3a2 2 0 0 1 2 2v3M20 15v3a2 2 0 0 1-2 2h-3M9 20H6a2 2 0 0 1-2-2v-3M7 12h10' }]],
  me: [['circle', { cx: 12, cy: 8, r: 3.4 }], ['path', { d: 'M5.5 20a6.5 6.5 0 0 1 13 0' }]],
  share: [['path', { d: 'M12 15V4M7.5 8.5L12 4l4.5 4.5M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4' }]],
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
