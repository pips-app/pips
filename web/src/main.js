// @ts-check
// Start-up: load the core, open storage, then either the first-run flow or
// the app itself.

import { install, attach, locate, onUncaught } from './diagnostics.js';
import { h } from './dom.js';
import { loadCore, isDevHost } from './core.js';
import { t, setLanguage, defaultLanguage } from './i18n.js';
import { load, hasIdentity } from './state.js';
import { getMeta } from './store.js';
import { mountShell, go, toast, currentView } from './ui/shell.js';
import { openJournal } from './ui/journal-view.js';
import { collectionView } from './collection/view.js';
import { editorView } from './editor/view.js';
import { importView } from './ui/import.js';
import { receiveView } from './ui/receive.js';
import { meView } from './ui/me.js';
import { onboarding } from './ui/onboarding.js';

const root = /** @type {HTMLElement} */ (document.getElementById('app'));

// Before anything else can fail: errors go in the journal from here on.
install();

async function main() {
  setLanguage(defaultLanguage());
  let loaded;
  try {
    loaded = await loadCore();
  } catch (e) {
    root.append(h('div', { class: 'empty' }, h('b', {}, t('core.failed')), String(/** @type {any} */ (e)?.message ?? e)));
    return;
  }
  await load(loaded.core, loaded.stub);
  await attach();
  const lang = await getMeta('language');
  if (lang) setLanguage(lang);
  if (loaded.stub) document.documentElement.classList.add('dev');
  if (loaded.stub) document.body.append(h('div', { class: 'dev-banner' }, 'DEV STUB — NOT SECURE'));

  const start = () => {
    mountShell(root, {
      collection: collectionView({ draw: () => go('draw') }), draw: editorView(), import: importView(), receive: receiveView(), me: meView(),
    });
    go('collection');
    locate(() => currentView() ?? '');
    // Once a start, a fault nobody caught is told — with the way to the
    // journal, where it can be read and sent. More would only nag.
    let told = false;
    onUncaught(() => {
      if (told) return;
      told = true;
      toast(t('journal.toast'), { label: t('journal.toast.go'), run: () => openJournal() });
    });
  };
  if (hasIdentity()) start();
  else onboarding(root, start);

  if ('serviceWorker' in navigator && !isDevHost()) offerUpdates().catch(() => {});
}

/**
 * A new version installs in the background and waits for the next start
 * (see sw.js). Once it is ready the person may take it now: the page then
 * reloads as one piece, never half old and half new.
 */
async function offerUpdates() {
  const reg = await navigator.serviceWorker.register('sw.js');
  const offer = () => {
    const ready = reg.waiting;
    // Only an update: a first install has no page of an older version to replace.
    if (!ready || !navigator.serviceWorker.controller) return;
    toast(t('app.update'), {
      label: t('app.update.go'),
      run: () => {
        navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
        ready.postMessage('take-over');
      },
    });
  };
  offer();
  reg.addEventListener('updatefound', () => {
    reg.installing?.addEventListener('statechange', (e) => { if (/** @type {ServiceWorker} */ (e.target).state === 'installed') offer(); });
  });
}

main();
