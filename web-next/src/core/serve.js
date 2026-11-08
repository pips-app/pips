// @ts-check
// The worker's side of the core: one message is one job, one answer goes
// back for each. Runs inside the core's worker, never on the page.
//
// A job is `{ id, op, args }`; the answer is `{ id, ok: true, value }` or
// `{ id, ok: false, error: { code, message, args } }`. Before any job the
// worker says once whether the core loaded: `{ ready: true }` or
// `{ ready: false, error }`.

/**
 * What a worker's global scope offers this file. Typed here rather than
 * with the "webworker" library, which cannot sit beside the page's "dom".
 * @typedef {{
 *   postMessage(message: unknown): void,
 *   close(): void,
 *   addEventListener(type: 'message', listener: (e: MessageEvent) => void): void,
 * }} Scope
 */

/** @typedef {{ code: string, message?: string, args?: number[] }} Failure */
/** @typedef {Record<string, (...args: any[]) => unknown>} Ops */

/**
 * The core's own errors are objects with a string `code` (see
 * crates/pips-wasm/src/codes.rs); they pass to the page as they are.
 * @param {unknown} e
 * @returns {e is Failure}
 */
const isFailure = (e) => typeof e === 'object' && e !== null && typeof (/** @type {any} */ (e).code) === 'string';
/**
 * The disk full under the key's own storage (keys.js): the person can fix
 * that, so it is said (store.js, STORE_CODES), not taken for a mistake.
 * A DOMException's `code` is a number, and does not say it.
 * @param {unknown} e
 */
const full = (e) => /** @type {any} */ (e)?.name === 'QuotaExceededError';

/**
 * Answers the page's jobs with `ops`, once `boot` has loaded the core.
 *
 * A trap in the WebAssembly — a panic in Rust — leaves the module's memory
 * in no known state, so after one the worker answers with `core_crashed`
 * and closes: the page starts a fresh one.
 *
 * @param {() => Promise<Ops>} boot
 */
export function serve(boot) {
  const scope = /** @type {Scope} */ (/** @type {unknown} */ (globalThis));
  /** @type {Ops} */
  let ops = {};
  const started = boot().then(
    (loaded) => { ops = loaded; scope.postMessage({ ready: true }); },
    (e) => { scope.postMessage({ ready: false, error: { code: 'core_unavailable', message: String(e) } }); scope.close(); },
  );
  scope.addEventListener('message', async (e) => {
    await started;
    const { id, op, args } = e.data;
    try {
      // Only the ops listed: a name like "constructor" or "__proto__" is
      // not a job.
      if (!Object.hasOwn(ops, op)) throw { code: 'unknown_op', message: String(op) };
      scope.postMessage({ id, ok: true, value: await ops[op](...args) });
    } catch (error) {
      if (error instanceof WebAssembly.RuntimeError) {
        scope.postMessage({ id, ok: false, error: { code: 'core_crashed', message: error.message } });
        scope.close();
        return;
      }
      /** @type {Failure} */
      const failure = isFailure(error)
        ? { code: error.code, message: error.message, args: error.args }
        : full(error)
          ? { code: 'storage_full', message: String(error) }
          : { code: 'internal', message: String(error) };
      scope.postMessage({ id, ok: false, error: failure });
    }
  });
}
