// @ts-check
// A worker whose core does not load, as when its WebAssembly is missing.
import { serve } from '/src/core/serve.js';

serve(() => Promise.reject(new Error('no core here, on purpose')));
