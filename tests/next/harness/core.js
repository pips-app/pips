// @ts-check
// The core's client with a worker that can also hang and crash on purpose,
// for tests: window.core is the client, window.harness says it is ready.
// ?worker=<file> starts another worker from this folder instead;
// ?limit=<ms> sets the limit of every job (for measuring).
import { coreClient } from '/src/core/client.js';

const w = /** @type {any} */ (window);
const query = new URLSearchParams(location.search);
const worker = query.get('worker') ?? 'core-worker.js';
const limit = Number(query.get('limit') ?? 0);
w.core = coreClient({
  script: new URL(worker, import.meta.url),
  limits: { hang: 500, slow: 2000 },
  otherLimit: limit || 5000,
  bootLimit: 3000,
});
w.harness = true;
