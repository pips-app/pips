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
  const land = () => home({ root, core, app });
  if (app.key.state === 'none') onboarding({ root, core, app, done: land });
  else if (!app.profile.nick) onboarding({ root, core, app, done: land, start: 'name' });
  else land();
} catch (e) {
  // The app cannot start: said, in the person's words, not a blank page.
  replace(root, h('main', { class: 'home' }, h('h1', {}, 'Pips'), h('p', { role: 'alert', class: 'wrong' }, say(e))));
}
