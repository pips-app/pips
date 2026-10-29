// @ts-check
// Sheets and dialogs over the screen, for the keyboard: focus moves into
// the topmost one, the Tab key goes round inside it instead of wandering
// off into the screen beneath, Escape closes it — only it, not what lies
// under it too — and when it closes, focus goes back where it was. With a
// mouse or a finger none of this shows; with a keyboard or a screen reader
// it is the difference between using the sheet and losing it.

const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** @type {{el: HTMLElement, escape?: () => void}[]} the open ones, topmost last */
const stack = [];

/** @param {KeyboardEvent} e */
function onKey(e) {
  const top = stack[stack.length - 1];
  if (!top) return;
  if (e.key === 'Escape' && top.escape) {
    // Nothing beneath takes it as its own: not another sheet, not the screen.
    e.stopImmediatePropagation();
    e.preventDefault();
    top.escape();
    return;
  }
  if (e.key !== 'Tab') return;
  const el = top.el;
  const all = [.../** @type {NodeListOf<HTMLElement>} */ (el.querySelectorAll(FOCUSABLE))].filter((x) => x.offsetParent || x === document.activeElement);
  if (!all.length) { e.preventDefault(); el.focus(); return; }
  const a = all[0], z = all[all.length - 1], at = document.activeElement;
  if (e.shiftKey && (at === a || at === el || !el.contains(at))) { e.preventDefault(); z.focus(); }
  else if (!e.shiftKey && (at === z || !el.contains(at))) { e.preventDefault(); a.focus(); }
}

/**
 * Holds the keyboard inside `el` until the returned function is called.
 * @param {HTMLElement} el
 * @param {{first?: HTMLElement|null, escape?: () => void}} [o]
 * first: what to focus first (else the sheet itself); escape: what Escape does
 * @returns {() => void} lets go, and puts focus back
 */
export function holdFocus(el, o = {}) {
  const before = /** @type {HTMLElement|null} */ (document.activeElement);
  if (!el.hasAttribute('tabindex')) el.tabIndex = -1;
  const entry = { el, escape: o.escape };
  if (!stack.length) document.addEventListener('keydown', onKey, true);
  stack.push(entry);
  (o.first ?? el).focus({ preventScroll: true });
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    const i = stack.indexOf(entry);
    if (i >= 0) stack.splice(i, 1);
    if (!stack.length) document.removeEventListener('keydown', onKey, true);
    // Only if focus is still ours to give back: not if the person moved it.
    const at = document.activeElement;
    if (before?.isConnected && (!at || at === document.body || el.contains(at))) before.focus({ preventScroll: true });
  };
}

/** Whether a sheet or a dialog holds the keyboard now. */
export const holding = () => stack.length > 0;
