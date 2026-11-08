// @ts-check
// The page's side of the core. Jobs go to the core's worker one at a time,
// each with its own time limit; a worker that runs past it, or crashes, is
// stopped, and the next job starts a fresh one. The page never waits on a
// core that will not answer, and never reloads to get it back.
//
// One at a time, so that a limit counts the job's own time, not its wait
// behind others; and so that a stopped worker takes only the job it was
// running with it — the jobs behind it go to the next worker.

/** @typedef {import('./serve.js').Failure} Failure */

/**
 * A job the core did not do: its code says why (the core's codes,
 * crates/pips-wasm/src/codes.rs, and the client's own below).
 */
export class CoreError extends Error {
  /** @param {Failure} f */
  constructor(f) {
    super(f.message ? `${f.code}: ${f.message}` : f.code);
    this.name = 'CoreError';
    /** @type {string} */
    this.code = f.code;
    /** The core's own message: English for the journal, but see errors.js. */
    this.detail = f.message ?? '';
    /** Numbers the words for the code need. @type {number[]} */
    this.args = f.args ?? [];
  }
}

/**
 * The client's own codes:
 * - `core_timeout`: the job ran past its limit; the worker was stopped.
 * - `core_crashed`: the core panicked, or the worker died; it was stopped.
 * - `core_unavailable`: the core did not load (or not within BOOT_LIMIT).
 * - `unknown_op`, `internal`: a mistake in the app, not in the data.
 */
export const CLIENT_CODES = ['core_timeout', 'core_crashed', 'core_unavailable', 'unknown_op', 'internal'];

/**
 * @typedef {{ id: number, op: string, args: unknown[],
 *   resolve: (v: any) => void, reject: (e: CoreError) => void }} Job
 */

/**
 * @param {object} o
 * @param {string | URL | import('../trust.js').TrustedScriptURL} o.script the worker's script
 *   (through the Trusted Types policy on a page that requires it)
 * @param {Record<string, number>} o.limits ms each job may take, by op
 * @param {number} o.otherLimit ms for a job not in `limits`
 * @param {number} o.bootLimit ms the worker may take to load the core
 */
export function coreClient({ script, limits, otherLimit, bootLimit }) {
  /** @type {Worker | null} */
  let worker = null;
  let ready = false;
  /** @type {Job[]} */
  const queue = [];
  /** @type {Job | null} */
  let running = null;
  let timer = 0;
  let nextId = 1;
  let restarts = 0;

  function start() {
    const w = new Worker(/** @type {string} */ (script), { type: 'module' });
    worker = w;
    ready = false;
    w.onmessage = (e) => { if (worker === w) heard(e.data); };
    // An answer that could not be copied back: the running job's (one at
    // a time), lost; the worker itself is fine.
    w.onmessageerror = () => { if (worker === w) settle(null, new CoreError({ code: 'internal', message: 'an answer could not be read' })); };
    // A script that fails to load, or an error the worker did not catch.
    w.onerror = (e) => {
      e.preventDefault();
      if (worker !== w) return;
      if (ready) stop('core_crashed', e.message);
      else unavailable(e.message);
    };
    timer = window.setTimeout(() => unavailable(`no answer in ${bootLimit} ms`), bootLimit);
  }

  /** Ends the worker, and with it the job it was running. @param {string} code @param {string} [message] */
  function stop(code, message) {
    window.clearTimeout(timer);
    worker?.terminate();
    worker = null;
    restarts++;
    const job = running;
    running = null;
    job?.reject(new CoreError({ code, message }));
    next();
  }

  /** The core did not load: every job waiting fails, the next call tries again. @param {string} [message] */
  function unavailable(message) {
    window.clearTimeout(timer);
    worker?.terminate();
    worker = null;
    for (const job of queue.splice(0)) job.reject(new CoreError({ code: 'core_unavailable', message }));
  }

  /** @param {any} m */
  function heard(m) {
    if ('ready' in m) {
      window.clearTimeout(timer);
      if (!m.ready) return unavailable(m.error?.message);
      ready = true;
      return next();
    }
    if (!running || m.id !== running.id) return;
    // The worker closes itself after a panic; it is not reused.
    if (!m.ok && m.error.code === 'core_crashed') return stop('core_crashed', m.error.message);
    settle(m.ok ? { value: m.value } : null, m.ok ? null : new CoreError(m.error));
  }

  /**
   * Ends the running job with its value or its error, and starts the next.
   * @param {{ value: unknown } | null} done @param {CoreError | null} failed
   */
  function settle(done, failed) {
    const job = running;
    if (!job) return;
    window.clearTimeout(timer);
    running = null;
    if (done) job.resolve(done.value);
    else job.reject(/** @type {CoreError} */ (failed));
    next();
  }

  function next() {
    if (running || !queue.length) return;
    if (!worker) return start();
    if (!ready) return;
    const job = /** @type {Job} */ (queue.shift());
    running = job;
    try {
      worker.postMessage({ id: job.id, op: job.op, args: job.args });
    } catch (e) {
      // Arguments that cannot be copied (a function, a detached buffer):
      // a mistake in the app. The job fails now; the worker never saw it.
      return settle(null, new CoreError({ code: 'internal', message: String(e) }));
    }
    const limit = Object.hasOwn(limits, job.op) ? limits[job.op] : otherLimit;
    timer = window.setTimeout(() => stop('core_timeout', `${job.op} took over ${limit} ms`), limit);
  }

  return {
    /**
     * Does `op` with `args` in the core; fails with a CoreError.
     * @param {string} op @param {...unknown} args @returns {Promise<any>}
     */
    call(op, ...args) {
      return new Promise((resolve, reject) => {
        queue.push({ id: nextId++, op, args, resolve, reject });
        next();
      });
    },
    /** How many times a worker was stopped: for tests and the journal. */
    get restarts() { return restarts; },
  };
}
