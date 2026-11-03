// The modules main.js loads before it can run, found by following the
// static imports (dynamic import() is left alone: those load on demand).
// Prints one path per line, relative to web/. Used by build-site.sh to let
// the browser fetch them all at once instead of one level of imports at a time.
//
//   node scripts/module-graph.mjs web src/main.js
import { readFileSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';

const [root, entry] = process.argv.slice(2);
const seen = new Set();
const IMPORT = /^\s*(?:import|export)\s[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]|^\s*import\s*['"](\.{1,2}\/[^'"]+)['"]/gm;
/** @param {string} file relative to root */
function walk(file) {
  if (seen.has(file)) return;
  seen.add(file);
  const text = readFileSync(join(root, file), 'utf8');
  for (const m of text.matchAll(IMPORT)) walk(normalize(join(dirname(file), m[1] ?? m[2])));
}
walk(entry);
for (const f of [...seen].sort()) console.log(relative('.', f));
