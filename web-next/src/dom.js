// @ts-check
// Building DOM without HTML. Card text comes from strangers, so every
// string becomes a text node; the page's CSP and Trusted Types refuse
// markup from strings anyway (trust.js makes none).
// From web/src/dom.js, as it was proven there.

import { keepTyped } from './text.js';

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

/**
 * A short shake: what a refused tap or a full field says. Without motion
 * (the person asked for none) the element is outlined for a moment instead.
 * @param {Element} el
 */
export function shake(el) {
  el.classList.remove('shake');
  // Read the layout once, so that the class added again starts the animation over.
  void (/** @type {HTMLElement} */ (el)).offsetWidth;
  el.classList.add('shake');
  el.addEventListener('animationend', () => el.classList.remove('shake'), { once: true });
}

/**
 * Keeps an input to the format's text rule (text.js) and to its limit, in
 * characters for names, in bytes for addresses. `maxLength` counts UTF-16
 * units, so it can do neither. From web/src/dom.js.
 * @template {HTMLInputElement | HTMLTextAreaElement} T
 * @param {T} input @param {number} max @param {'chars' | 'bytes'} unit @returns {T}
 */
export function textLimit(input, max, unit) {
  const keep = () => {
    const r = keepTyped(input.value, input.selectionStart ?? input.value.length, max, unit);
    if (r.full) shake(input.closest('.field') ?? input);
    if (r.value === input.value) return;
    input.value = r.value;
    input.setSelectionRange(r.caret, r.caret);
  };
  // Not while a word is being composed (a phone's keyboard, Japanese or
  // Chinese input): changing the field then breaks the composition.
  input.addEventListener('input', (e) => { if (!(/** @type {InputEvent} */ (e).isComposing)) keep(); });
  input.addEventListener('compositionend', keep);
  return input;
}
