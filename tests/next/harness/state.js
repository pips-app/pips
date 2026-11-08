// @ts-check
// The new app's state (web-next/src/state.js) on the real core's worker and
// a storage of its own, for tests. window.app is the state; window.core,
// window.store what it runs on; window.restart(shift) makes a fresh state
// on the same data with the clock moved by `shift` ms, as a later start.
import { coreClient } from '/src/core/client.js';
import * as store from '/src/store.js';
import { createState } from '/src/state.js';

const w = /** @type {any} */ (window);
w.core = coreClient({ script: new URL('./core-worker.js', import.meta.url), limits: {}, otherLimit: 10000, bootLimit: 10000 });
w.store = store;
await store.open('pips-next-state');
w.restart = async (/** @type {number} */ shift = 0) => {
  w.app = createState(w.core, { now: () => Date.now() + shift });
  await w.app.load();
};
await w.restart();
w.harness = true;
