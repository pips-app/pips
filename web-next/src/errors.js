// @ts-check
// One model of errors: everything that fails has a code, and every code has
// words in both languages (i18n.js, `error.<code>`). What the person did
// not cause and cannot fix — a mistake in the app — is said the same way
// for every such code ("it is in the journal"), and written to the journal.

import { dictionaries, t } from './i18n.js';

/**
 * Codes that mean a mistake in the app, not in what the person gave it:
 * bytes or options the app itself built wrong, a job that does not exist.
 */
export const APP_MISTAKES = new Set(['bad_seed', 'bad_nonce', 'bad_options', 'unknown_op', 'internal']);

/**
 * What to tell the person about an error: the words for its code, or, for
 * a mistake in the app or an error with no code, that it is in the journal.
 * @param {unknown} e
 * @returns {string}
 */
export function say(e) {
  const err = /** @type {{ code?: unknown, detail?: string, args?: number[] }} */ (typeof e === 'object' && e !== null ? e : {});
  const code = err.code;
  if (typeof code !== 'string' || APP_MISTAKES.has(code)) return t('error.app');
  const key = `error.${code}`;
  if (!Object.hasOwn(dictionaries.ru, key)) return t('error.app');
  const known = /** @type {import('./i18n.js').Key} */ (key);
  // other_owner carries the short form of the other key in its message
  // (crates/pips-wasm/src/api.rs, store_err); the rest carry numbers.
  return code === 'other_owner' ? t(known, err.detail ?? '') : t(known, ...(err.args ?? []));
}
