// The class names between the stylesheets and the code. All CSS here is
// global, so two parts of the app that pick the same name for different
// things style each other without a word (it happened: a strip of the
// palette and a place in the editor's layout were both .ed-strip). And a
// rule for a class nobody makes any more is dead weight that looks alive.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('../../web/', import.meta.url).pathname;
const walk = (d) => readdirSync(d).flatMap((f) => {
  const p = join(d, f);
  return statSync(p).isDirectory() ? (f === 'pkg' ? [] : walk(p)) : [p];
});
const files = walk(ROOT);
const js = files.filter((f) => f.endsWith('.js'));
const css = files.filter((f) => f.endsWith('.css'));
const html = files.filter((f) => f.endsWith('.html'));

/**
 * Classes meant to be used by any part of the app: the shared vocabulary
 * (buttons, fields, sheets, bars) and the card's own parts, which the
 * editor lays out as the card does. Any other class belongs to the one
 * module that makes it. A new shared one is added here on purpose.
 */
const SHARED = new Set([
  // layout of a screen and its bar
  'view', 'bar', 'title', 'sub', 'scroll', 'empty', 'lead', 'group', 'wide', 'pill',
  // buttons and their rows
  'btn', 'key', 'text-btn', 'icon-btn', 'row-btns', 'add',
  // fields and texts
  'field', 'check', 'hint', 'small',
  // sheets
  'grab', 'scrim',
  // the card and the key's pictures, wherever they are shown
  'face', 'front', 'cap', 'idcard', 'word-grid',
  // the editor's own pieces, shared by its sheets and its layout
  'ed-note', 'ed-swatch', 'ed-set-row', 'ed-place',
]);

/** The words inside the string and template literals of a source (the
 * static parts of a template), and the prefixes a template completes
 * (`is-${kind}` makes every is-…). */
function words(src) {
  const out = new Set(), prefixes = new Set();
  // Quoted strings anywhere, those inside a template's ${…} too; then
  // the templates' own parts.
  const quoted = [...src.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g)].map((m) => m[1] ?? m[2]);
  const templates = [...src.matchAll(/`((?:[^`\\]|\\.)*)`/g)].map((m) => m[1]);
  for (const text of [...quoted, ...templates]) {
    for (const part of text.split(/\$\{[^}]*\}/)) for (const w of part.match(/[a-z][\w-]*/g) ?? []) out.add(w);
    for (const p of text.matchAll(/([a-z][\w-]*-)\$\{/g)) prefixes.add(p[1]);
  }
  return { out, prefixes };
}

/** The classes a CSS file's selectors name. */
function selectorClasses(src) {
  const sel = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@import[^;]*;/g, '').replace(/\{[^{}]*\}/g, '{}');
  return new Set([...sel.matchAll(/\.([a-z][\w-]*)/g)].map((m) => m[1]));
}

test('every class the stylesheets style is made somewhere', () => {
  const made = new Set(), prefixes = new Set();
  for (const f of js) {
    const w = words(readFileSync(f, 'utf8'));
    w.out.forEach((x) => made.add(x));
    w.prefixes.forEach((x) => prefixes.add(x));
  }
  for (const f of html) for (const m of readFileSync(f, 'utf8').matchAll(/class="([^"]*)"/g)) m[1].split(/\s+/).forEach((x) => made.add(x));
  const dead = [];
  for (const f of css) {
    for (const c of selectorClasses(readFileSync(f, 'utf8'))) {
      if (!made.has(c) && ![...prefixes].some((p) => c.startsWith(p))) dead.push(`${relative(ROOT, f)}: .${c}`);
    }
  }
  assert.deepEqual(dead, [], 'rules for classes nothing makes');
});

test('a class is made by one module, unless it is shared on purpose', () => {
  /** @type {Map<string, Set<string>>} */
  const by = new Map();
  for (const f of js) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/class:\s*(['`])([^'`]*)\1/g)) {
      for (const c of m[2].replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)) {
        if (!/^[a-z][\w-]*$/.test(c) || SHARED.has(c)) continue;
        if (!by.has(c)) by.set(c, new Set());
        by.get(c)?.add(relative(ROOT, f));
      }
    }
  }
  const twice = [...by].filter(([, f]) => f.size > 1).map(([c, f]) => `.${c}: ${[...f].join(', ')}`);
  assert.deepEqual(twice, [], 'one name for two things: rename one, or add it to SHARED if it is one thing');
});
