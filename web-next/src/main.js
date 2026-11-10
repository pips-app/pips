// @ts-check
// The new app's start: the language, the core in its worker, the state;
// then the first run, or where the app lands. Screens come at stage 5.

import { coreClient } from './core/client.js';
import { BOOT_LIMIT, LIMITS, OTHER_LIMIT } from './core/limits.js';
import { h, replace } from './dom.js';
import { say } from './errors.js';
import { setLanguage } from './i18n.js';
import * as store from './store.js';
import { createState } from './state.js';
import { CORE_WORKER, scriptURL } from './trust.js';
import { onboarding } from './ui/onboarding.js';
import { home } from './ui/home.js';
import { shell } from './ui/shell.js';
import { linkArrival, receive } from './ui/receive.js';
import { give } from './ui/give.js';
import { cardInAddress } from './formats/links.js';
import { t } from './i18n.js';

const lang = navigator.language.toLowerCase().startsWith('ru') ? 'ru' : 'en';
setLanguage(lang);
document.documentElement.lang = lang;

const root = h('div', { id: 'app' });
document.body.append(root);

const core = coreClient({ script: scriptURL(CORE_WORKER), limits: LIMITS, otherLimit: OTHER_LIMIT, bootLimit: BOOT_LIMIT });

try {
  await store.open();
  const app = createState(core);
  await app.load();
  // A card in the address (a link opened): taken out of it at once, so a
  // reload does not bring it in again, and asked about once the app is there.
  /** @type {string | null} */
  let link = null;
  const takeLink = () => {
    const c = cardInAddress(location.href);
    if (!c) return null;
    history.replaceState(null, '', c.rest);
    return c.link;
  };
  link = takeLink();
  /** @type {ReturnType<typeof shell> | null} */
  let frame = null;
  /** Asks about the card a link brought (ui/receive.js, linkArrival). @param {string} l */
  const ask = async (l) => {
    // Still in the first run: asked once the app is there.
    if (!frame) { link = l; return; }
    const tell = frame.tell;
    try {
      await linkArrival({ app, tell }, await core.call('parseLink', l));
    } catch {
      // Cut short on the way, most likely: a messenger trims long links.
      tell(t('link.bad'), { wrong: true });
    }
  };
  const land = (/** @type {string} */ said = '') => {
    // What there is to say on arriving, said once: not again on every visit to the profile.
    let first = said;
    frame = shell(root, {
      give: (f) => give({ ...f, core, app }),
      receive: (f) => receive({ ...f, core, app }),
      home: (f) => { home({ root: f.root, core, app, said: first }); first = ''; },
    });
    frame.go('home');
    if (link) void ask(link);
    link = null;
  };
  // A link opened while the app is open: the same question.
  window.addEventListener('hashchange', () => { const l = takeLink(); if (l) void ask(l); });
  if (app.key.state === 'none') onboarding({ root, core, app, done: land });
  else if (!app.profile.nick) onboarding({ root, core, app, done: land, start: 'name' });
  else land();
} catch (e) {
  // The app cannot start: said, in the person's words, not a blank page.
  replace(root, h('main', { class: 'home' }, h('h1', {}, 'Pips'), h('p', { role: 'alert', class: 'wrong' }, say(e))));
}
