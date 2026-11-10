// @ts-check
// The frame around the screens once there is a key and a name: the tab bar
// and one line of messages over it. Each screen draws into its own place
// and says what came of an action through `tell`; it does not know the
// others. From web/src/ui/shell.js; the collection comes as a tab at
// stage 5.

import { h, replace } from '../dom.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';

/**
 * How long a message stays: read at a glance; with a button, long enough
 * to reach for it. From web/src/ui/shell.js.
 */
const TELL_MS = 2400;
const TELL_ACTION_MS = 5000;

/** @typedef {'receive' | 'give' | 'home'} Screen */
/**
 * What a screen is given: where to draw, how to say what came of an
 * action, how to go to another screen.
 * @typedef {{ root: HTMLElement, tell: Tell, go: (name: Screen, o?: any) => void }} Frame
 */
/** @typedef {(text: string, o?: { wrong?: boolean, action?: { label: string, run: () => void } }) => void} Tell */

/**
 * @param {HTMLElement} root
 * @param {Partial<Record<Screen, (frame: Frame, o?: any) => void>>} screens a tab each, in this order
 */
export function shell(root, screens) {
  const view = h('div', { class: 'shell-view' });
  const text = h('span', {});
  const action = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'text-btn', hidden: true }));
  const line = h('div', { class: 'shell-tell', role: 'status', hidden: true }, text, action);
  /** @type {Screen | null} */
  let current = null;
  let timer = 0;

  /** @type {Tell} */
  const tell = (said, o = {}) => {
    text.textContent = said;
    line.classList.toggle('wrong', !!o.wrong);
    action.hidden = !o.action;
    action.textContent = o.action?.label ?? '';
    action.onclick = () => { line.hidden = true; o.action?.run(); };
    line.hidden = false;
    clearTimeout(timer);
    timer = window.setTimeout(() => { line.hidden = true; }, o.action ? TELL_ACTION_MS : TELL_MS);
  };

  /** @type {Record<Screen, { label: string, icon: Parameters<typeof icon>[0] }>} */
  const tabs = {
    receive: { label: t('tab.receive'), icon: 'scan' },
    give: { label: t('tab.give'), icon: 'give' },
    home: { label: t('tab.home'), icon: 'me' },
  };
  const buttons = /** @type {Partial<Record<Screen, HTMLButtonElement>>} */ (Object.fromEntries(Object.keys(screens).map((name) => [name,
    h('button', { type: 'button', onclick: () => go(/** @type {Screen} */ (name)) }, icon(tabs[/** @type {Screen} */ (name)].icon), h('span', {}, tabs[/** @type {Screen} */ (name)].label))])));

  /** Shows a screen, afresh. @param {Screen} name @param {any} [o] what the screen opens with */
  function go(name, o) {
    // A message about the screen left behind does not stay over another.
    if (current !== name) line.hidden = true;
    current = name;
    for (const [n, b] of Object.entries(buttons)) {
      if (n === name) b?.setAttribute('aria-current', 'page');
      else b?.removeAttribute('aria-current');
    }
    const place = h('div', { class: 'shell-screen' });
    replace(view, place);
    screens[name]?.({ root: place, tell, go }, o);
  }

  replace(root, view, h('nav', { class: 'shell-tabs', 'aria-label': t('tab.label') }, Object.values(buttons)), line);
  return { go, tell };
}
