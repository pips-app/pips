// @ts-check
// The core's worker: the WebAssembly core runs here, off the page, so that
// a picture or a code that takes it long, or makes it panic, never stops
// the page. The page talks to it only through client.js.

import { serve } from './serve.js';
import { load } from './ops.js';

serve(load);
