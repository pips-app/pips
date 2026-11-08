// @ts-check
// The app's one Trusted Types policy. The page's CSP requires one for every
// script URL, so nothing — not a bug, not text from a card — can start a
// script the app did not name here. The new app writes no HTML at all, so
// the policy makes no HTML: only the URLs of its own workers.

/**
 * A script URL the policy made. TypeScript's DOM library does not name the
 * type yet, so here it is only "not a plain string".
 * @typedef {{ readonly trustedScriptURL: never }} TrustedScriptURL
 */

/** The scripts the app starts: the core's worker. */
const SCRIPTS = [new URL('./core/worker.js', import.meta.url).href];

/** @type {any} */
const tt = /** @type {any} */ (globalThis).trustedTypes;
const policy = tt?.createPolicy('pips', {
  /** @param {string} s */
  createScriptURL(s) {
    const url = new URL(s, document.baseURI).href;
    if (!SCRIPTS.includes(url)) throw new TypeError(`not one of the app's scripts: ${url}`);
    return url;
  },
});

/**
 * The URL of one of the app's own scripts, as the browser will take it.
 * Where there is no Trusted Types, a plain string; the CSP still allows
 * only this origin's scripts.
 * @param {string} url
 * @returns {string | TrustedScriptURL}
 */
export function scriptURL(url) {
  return policy ? policy.createScriptURL(url) : url;
}

/** The core's worker. */
export const CORE_WORKER = SCRIPTS[0];
