// @ts-check
// The new app's start. So far a frame: the page, its policies, and the
// core in its worker (docs/REWRITE.md, stage 2). Screens come later.

import { coreClient } from './core/client.js';
import { BOOT_LIMIT, LIMITS, OTHER_LIMIT } from './core/limits.js';
import { h } from './dom.js';
import { say } from './errors.js';
import { setLanguage, t } from './i18n.js';
import { CORE_WORKER, scriptURL } from './trust.js';

setLanguage(navigator.language.toLowerCase().startsWith('ru') ? 'ru' : 'en');
document.documentElement.lang = navigator.language.toLowerCase().startsWith('ru') ? 'ru' : 'en';

const core = coreClient({ script: scriptURL(CORE_WORKER), limits: LIMITS, otherLimit: OTHER_LIMIT, bootLimit: BOOT_LIMIT });

const status = h('p', { class: 'shell-status', role: 'status' }, t('shell.starting'));
document.body.append(h('main', { class: 'shell' }, h('h1', {}, 'Pips'), h('p', {}, t('shell.wip')), status));

core.call('errorCodes').then(
  () => { status.textContent = t('shell.ready'); },
  (e) => { status.textContent = say(e); },
);
