// @ts-check
// Start-up: load the core, open storage, then either the first-run flow or
// the app itself.

import { install, attach, locate, onUncaught, journal } from './diagnostics.js';
import { h } from './dom.js';
import { loadCore, isDevHost } from './core.js';
import { t, setLanguage, defaultLanguage } from './i18n.js';
import { app, load, hasIdentity } from './state.js';
import { cardInAddress } from './links.js';
import { arrive, peek } from './ui/arrival.js';
import { getMeta, onReplaced, onBlocked } from './store.js';
import { mountShell, go, toast, currentView } from './ui/shell.js';
import { openJournal } from './ui/journal-view.js';
import { collectionView } from './collection/view.js';
import { editorView } from './editor/view.js';
import { giveView } from './ui/give.js';
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
  // Another tab with a newer Pips takes the data over: this one steps aside.
  onReplaced(() => halt('store.replaced'));
  onBlocked(() => halt('store.blocked', false));
  try {
    await load(loaded.core, loaded.stub);
    document.querySelector('.halt')?.remove(); // the other tabs let go
  } catch (e) {
    const code = /** @type {any} */ (e)?.code;
    if (code !== 'newer_data' && code !== 'upgrade_failed') throw e;
    journal.error(e, 'storage');
    halt(code === 'newer_data' ? 'store.newer' : 'store.upgrade-failed');
    return;
  }
  await attach();
  const lang = await getMeta('language');
  if (lang) setLanguage(lang);
  if (loaded.stub) document.documentElement.classList.add('dev');
  if (loaded.stub) document.body.append(h('div', { class: 'dev-banner' }, 'DEV STUB — NOT SECURE'));

  // A card in the address — a link someone sent — is taken out of it at
  // once (a reload must not bring it in again) and kept until the app is
  // ready for it: after the first run, if there is one.
  let incoming = fromAddress();
  const start = () => {
    mountShell(root, {
      collection: collectionView({ draw: () => go('draw') }), draw: editorView(), give: giveView(), receive: receiveView(), me: meView(),
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
    take();
    // Another link opened while the app is up (the same tab, a new address).
    addEventListener('hashchange', () => { incoming = fromAddress(); take(); });
  };
  /** The card from a link, now that there is a key to keep it under. */
  const take = () => {
    if (incoming === 'bad') toast(t('link.bad'));
    else if (incoming) arrive(incoming, 'link');
    incoming = null;
  };
  if (hasIdentity()) start();
  else onboarding(root, start, { arrival: incoming && incoming !== 'bad' ? peek(incoming) : null });

  if ('serviceWorker' in navigator && !isDevHost()) offerUpdates().catch(() => {});
}

/**
 * The app cannot go on with the data as it is: says why, over everything,
 * with the one thing to do. Nothing is written meanwhile.
 * @param {string} key @param {boolean} [reload] whether reloading is the way on
 */
function halt(key, reload = true) {
  document.querySelectorAll('.halt').forEach((e) => e.remove());
  document.body.append(h('div', { class: 'halt', role: 'alertdialog', 'aria-modal': 'true' },
    h('div', {}, h('h1', {}, t(`${key}.title`)), h('p', {}, t(key)),
      reload ? h('button', { class: 'btn key wide', onclick: () => freshReload() }, t('store.reload')) : '',
      // What went wrong can still be read and sent: the journal lives in memory until storage opens.
      key === 'store.upgrade-failed' ? h('button', { class: 'btn wide', style: { marginTop: '8px' }, onclick: () => openJournal() }, t('journal.open')) : '')));
}

/**
 * A reload that brings the newest app: an update already fetched in the
 * background takes over first. Without it, this very page would come back
 * from the cache — the old version that cannot open the data.
 */
async function freshReload() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
    const next = reg?.waiting ?? reg?.installing;
    if (next) {
      navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
      const go = () => { if (next.state === 'installed') next.postMessage('take-over'); };
      next.addEventListener('statechange', go);
      go();
      setTimeout(() => location.reload(), 8000); // whatever happens, not stuck here
      return;
    }
  } catch { /* no service worker here: a plain reload */ }
  location.reload();
}

/**
 * The envelope in the address, taken out of it; 'bad' for a link that is
 * not whole (cut short by a messenger, say). @returns {Uint8Array|'bad'|null}
 */
function fromAddress() {
  const found = cardInAddress(location.href);
  if (!found) return null;
  history.replaceState(null, '', found.rest);
  try {
    return app.core.parseLink(found.link);
  } catch {
    return 'bad';
  }
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
