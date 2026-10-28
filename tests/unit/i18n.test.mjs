// The two languages kept in step with each other and with the code: the
// same keys, the same arguments, no string the code never asks for, and
// no key the code asks for that is not there (it would show as the key).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const { dictionaries } = await import('../../web/src/i18n.js');
const { ru, en } = dictionaries;

const SRC = new URL('../../web/src/', import.meta.url).pathname;
const walk = (d) => readdirSync(d).flatMap((f) => {
  const p = join(d, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const code = walk(SRC).filter((f) => f.endsWith('.js') && !f.endsWith('i18n.js')).map((f) => ({ f: relative(SRC, f), s: readFileSync(f, 'utf8') }));
const all = code.map((c) => c.s).join('\n');

test('both languages have the same strings, taking the same arguments', () => {
  const ruKeys = Object.keys(ru).sort(), enKeys = Object.keys(en).sort();
  assert.deepEqual(ruKeys.filter((k) => !(k in en)), [], 'in Russian only');
  assert.deepEqual(enKeys.filter((k) => !(k in ru)), [], 'in English only');
  const shape = (v) => (typeof v === 'function' ? `fn/${v.length}` : typeof v);
  assert.deepEqual(ruKeys.filter((k) => shape(ru[k]) !== shape(en[k])).map((k) => `${k}: ${shape(ru[k])} vs ${shape(en[k])}`), []);
});

test('every string is asked for somewhere, and every string asked for is there', () => {
  // Keys made in code: `ed.h.${tool}`, reason('backup.err', e).
  const prefixes = new Set([
    ...[...all.matchAll(/`([a-z][\w.-]*\.)\$\{/g)].map((m) => m[1]),
    ...[...all.matchAll(/reason\('([a-z][\w.-]*)'/g)].map((m) => `${m[1]}.`),
  ]);
  const quoted = new Set([...all.matchAll(/'([a-z][\w-]*(?:\.[\w-]+)+)'/g)].map((m) => m[1]));
  // And `${key}.title`: a key with a suffix, the key itself quoted.
  const suffixes = new Set([...all.matchAll(/\$\{[^}]*\}(\.[\w-]+)`/g)].map((m) => m[1]));
  const used = (k) => quoted.has(k) || [...prefixes].some((p) => k.startsWith(p)) || [...suffixes].some((x) => k.endsWith(x) && quoted.has(k.slice(0, -x.length)));
  const unused = Object.keys(ru).filter((k) => !used(k));
  assert.deepEqual(unused, [], 'strings nothing asks for');
  // Literal keys handed to t(): each must exist.
  const missing = [];
  for (const { f, s } of code) for (const m of s.matchAll(/\bt\('([^']+)'/g)) if (!(m[1] in ru)) missing.push(`${f}: ${m[1]}`);
  assert.deepEqual(missing, [], 'asked for, but not there');
});

test('no Russian quotes or untranslated words in English', () => {
  const bad = Object.entries(en).filter(([, v]) => /[«»а-яё]/i.test(typeof v === 'function' ? v.toString() : v)).map(([k]) => k);
  assert.deepEqual(bad, []);
});
