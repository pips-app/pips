// @ts-check
// Building DOM without innerHTML. Card text comes from strangers, so every
// string becomes a text node; only the icon constants below are markup.

/**
 * @param {string} tag
 * @param {Record<string, any>} [props]
 * @param {...any} children
 * @returns {HTMLElement}
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    // Style keys as in CSS (`margin-top`, `--shade`) or in JS (`marginTop`):
    // setProperty takes only the first, and silently ignores the second.
    else if (k === 'style') for (const [p, val] of Object.entries(v)) el.style.setProperty(p.startsWith('--') ? p : p.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`), String(val));
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && typeof v !== 'string') /** @type {any} */ (el)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

/** @param {Element} el @param {any[]} children */
export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** Replaces all children. @param {Element} el @param {...any} children */
export function replace(el, ...children) {
  el.replaceChildren();
  append(el, children);
}

const ICONS = {
  collection: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  give: '<path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"/><rect x="7.5" y="7.5" width="9" height="9" rx="1"/>',
  receive: '<path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M4 19h16"/>',
  me: '<circle cx="12" cy="8" r="3.4"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/>',
  archive: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8M10 12h4"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  next: '<path d="M9 5l7 7-7 7"/>',
  minus: '<path d="M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  restore: '<path d="M4 9h11a5 5 0 0 1 0 10h-6"/><path d="M8 5L4 9l4 4"/>',
  trash: '<path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 16l5-5 4 4 3-3 6 6"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M15 8l2 2"/>',
  scan: '<path d="M4 9V6a2 2 0 0 1 2-2h3M15 4h3a2 2 0 0 1 2 2v3M20 15v3a2 2 0 0 1-2 2h-3M9 20H6a2 2 0 0 1-2-2v-3M7 12h10"/>',
  brush: '<path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3zM13.5 8.5l3 3"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
  pen: '<path d="M4 20l1-4.5L15.5 5a2 2 0 0 1 2.8 0l.7.7a2 2 0 0 1 0 2.8L8.5 19 4 20zM13.5 7l3.5 3.5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  share: '<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/>',
  turn: '<path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3"/><path d="M18 3v4h-4M6 21v-4h4"/>',
  card: '<rect x="5" y="3" width="14" height="18" rx="1.5"/><rect x="8" y="6" width="8" height="8"/>',
  undo: '<path d="M9 6L4 11l5 5M4 11h10a5 5 0 0 1 0 10h-3"/>',
  redo: '<path d="M15 6l5 5-5 5M20 11H10a5 5 0 0 0 0 10h3"/>',
  eraser: '<path d="M4 16l9-9 6 6-7 7H8zM9 11l6 6M8 20h12"/>',
  fill: '<path d="M5 11l7-7 7 7-7 7zM5 11h14M20 15c0 1.6 1 2.4 1 3.4a1 1 0 0 1-2 0c0-1 1-1.8 1-3.4z"/>',
  shapes: '<path d="M4 20L11 13M13 4h7v7h-7z"/>',
  line: '<path d="M5 19L19 5"/>',
  rect: '<rect x="5" y="5" width="14" height="14"/>',
  'rect-fill': '<rect x="5" y="5" width="14" height="14" fill="currentColor"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="8" ry="6.5"/>',
  'ellipse-fill': '<ellipse cx="12" cy="12" rx="8" ry="6.5" fill="currentColor"/>',
  mirror: '<path d="M12 3v18M9 7L4 12l5 5zM15 7l5 5-5 5z"/>',
  aim: '<path d="M12 3v5M12 16v5M3 12h5M16 12h5M10.5 10.5h3v3h-3z"/>',
  more: '<path d="M6 12h.01M12 12h.01M18 12h.01" stroke-width="3"/>',
  play: '<path d="M7 4.5l13 7.5-13 7.5z" fill="currentColor"/>',
  pause: '<path d="M8 5v14M16 5v14" stroke-width="3"/>',
  pick: '<path d="M17.5 3.5a2.1 2.1 0 0 1 3 3L18 9l1 1-1.5 1.5-5-5L14 5l1 1zM13 8l-8 8v3h3l8-8"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-1.3-1.1-1.6-1.1-2.7 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5c0-4-4-7-9-7z"/><path d="M7.5 11.5h.01M10 7.5h.01M15 7.5h.01" stroke-width="2.6"/>',
  grid: '<path d="M4 4h16v16H4zM4 9.3h16M4 14.7h16M9.3 4v16M14.7 4v16"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>',
  history: '<path d="M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4"/><path d="M12 8v4l3 2"/>',
  select: '<path d="M4 4h3M10 4h4M17 4h3v3M20 10v4M20 17v3h-3M14 20h-4M7 20H4v-3M4 14v-4M4 7V4"/>',
  'select-all': '<path d="M4 4h3M10 4h4M17 4h3v3M20 10v4M20 17v3h-3M14 20h-4M7 20H4v-3M4 14v-4M4 7V4"/><rect x="8" y="8" width="8" height="8" fill="currentColor" stroke="none"/>',
  dither: '<path d="M5 5h4v4H5zM13 5h4v4h-4zM9 9h4v4H9zM17 9h2v4h-2zM5 13h4v4H5zM13 13h4v4h-4zM9 17h4v2H9z" fill="currentColor" stroke="none"/>',
  'flip-x': '<path d="M12 3v18M9 7L4 12l5 5zM15 7l5 5-5 5z"/>',
  'flip-y': '<path d="M3 12h18M7 9l5-5 5 5zM7 15l5 5 5-5z"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4"/>',
};

/** An icon from the fixed set above. @param {keyof typeof ICONS} name */
export function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'i');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = ICONS[name]; // constant markup, never data
  return svg;
}

/**
 * Keeps an input within `max` bytes of UTF-8, the unit card limits are in
 * (a Cyrillic letter is two). `maxLength` counts characters, so it cannot.
 * @template {HTMLInputElement|HTMLTextAreaElement} T
 * @param {T} input @param {number} max @returns {T}
 */
export function byteLimit(input, max) {
  input.addEventListener('input', () => {
    const v = fitBytes(input.value, max);
    if (v !== input.value) input.value = v;
  });
  return input;
}

/** The longest prefix of `s` within `max` bytes of UTF-8, whole characters
 * only. @param {string} s @param {number} max */
export function fitBytes(s, max) {
  const enc = new TextEncoder();
  if (enc.encode(s).length <= max) return s;
  const chars = Array.from(s);
  let lo = 0, hi = chars.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (enc.encode(chars.slice(0, mid).join('')).length <= max) lo = mid; else hi = mid - 1;
  }
  return chars.slice(0, lo).join('');
}

/**
 * Scrolls `box` (only it: never the page around it, as scrollIntoView
 * would) so that `child` is in sight. @param {HTMLElement} box @param {Element|null|undefined} child
 */
export function reveal(box, child) {
  if (!child) return;
  const b = box.getBoundingClientRect(), c = child.getBoundingClientRect();
  if (c.top < b.top) box.scrollTop -= b.top - c.top;
  else if (c.bottom > b.bottom) box.scrollTop += c.bottom - b.bottom;
  if (c.left < b.left) box.scrollLeft -= b.left - c.left;
  else if (c.right > b.right) box.scrollLeft += c.right - b.right;
}
