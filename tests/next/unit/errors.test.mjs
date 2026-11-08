// @ts-check
// One model of errors (web-next/src/errors.js): every code the core or its
// client can give has words in both languages, and the two languages say
// the same things with the same arguments. Under node, with the real core.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const web = new URL('../../../web-next/', import.meta.url);
const core = await import(new URL('pkg/pips_wasm.js', web).href);
core.initSync({ module: await readFile(new URL('pkg/pips_wasm_bg.wasm', web)) });
const { dictionaries, setLanguage } = await import(new URL('src/i18n.js', web).href);
const { say, APP_MISTAKES } = await import(new URL('src/errors.js', web).href);
const { CLIENT_CODES } = await import(new URL('src/core/client.js', web).href);
const { KEY_CODES } = await import(new URL('src/core/keys.js', web).href);
const { STORE_CODES } = await import(new URL('src/store.js', web).href);

/** @type {string[]} */
const codes = [...core.errorCodes(), ...CLIENT_CODES, ...KEY_CODES, ...STORE_CODES];

test('every code the core, its client, the key or storage can give has words, or is a mistake of the app', () => {
  const missing = codes.filter((c) => !APP_MISTAKES.has(c) && !Object.hasOwn(dictionaries.ru, `error.${c}`));
  assert.deepEqual(missing, []);
  const unknown = [...APP_MISTAKES].filter((c) => !codes.includes(c));
  assert.deepEqual(unknown, [], 'a mistake of the app no one can give');
});

test('no words for a code that does not exist', () => {
  const extra = Object.keys(dictionaries.ru)
    .filter((k) => k.startsWith('error.') && k !== 'error.app')
    .filter((k) => !codes.includes(k.slice('error.'.length)) || APP_MISTAKES.has(k.slice('error.'.length)));
  assert.deepEqual(extra, []);
});

test('both languages have the same keys, taking the same arguments', () => {
  const { ru, en } = dictionaries;
  assert.deepEqual(Object.keys(en).sort(), Object.keys(ru).sort());
  for (const k of Object.keys(ru)) {
    assert.equal(typeof en[k], typeof ru[k], k);
    if (typeof ru[k] === 'function') assert.equal(en[k].length, ru[k].length, k);
  }
});

test('an error is said by its code; a mistake of the app, or no code, as one', () => {
  setLanguage('en');
  assert.equal(say({ code: 'too_big', args: [200, 100] }), '200×100 is larger than a card (up to 128×128)');
  assert.equal(say({ code: 'other_owner', detail: '4f·a1·c8·0e' }), 'This is the backup of another key (4f·a1·c8·0e): it opens once you switch to that key');
  const app = 'Something went wrong — it is in the journal';
  for (const e of [{ code: 'internal' }, { code: 'no_such_code' }, new TypeError('x'), null, 'text', { code: 7 }]) assert.equal(say(e), app);
  setLanguage('ru');
  assert.equal(say({ code: 'too_many_colors', args: [3] }), '3 цвета, а в карточке до 32');
});
