// @ts-check
// The new app's storage (web-next/src/store.js) for tests: window.store is
// the module, opened on a database of its own unless ?wait asks the test to
// open it itself (to meet a missing IndexedDB, newer data and so on).
import * as store from '/src/store.js';

const w = /** @type {any} */ (window);
w.store = store;
w.replaced = 0;
store.onReplaced(() => { w.replaced++; });
if (!new URLSearchParams(location.search).has('wait')) await store.open('pips-next-test');
w.harness = true;
