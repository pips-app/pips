// Sums up what the tests ran of the app's own code: for each file under
// web/src, the share of its lines that ran, and the functions that never
// ran at all — the places no test reaches.
//
//   cd tests/e2e && COVERAGE=/tmp/cov npm test                      # browser tests, Chromium only
//   NODE_V8_COVERAGE=/tmp/cov node --test tests/unit/*.test.mjs     # unit tests, from the root
//   node tests/coverage-report.mjs /tmp/cov
//
// The measure is V8's: Chromium's JS coverage, one file per page
// (helpers.mjs), and Node's for the unit tests — the same format.
// A line counts as run if any of its code ran; lines with no code
// (blank, comments) are not counted. Code that ran in some page counts,
// whatever the others did. A file no test loaded is listed at 0%.

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) throw new Error('usage: node tests/coverage-report.mjs <folder>');
const WEB = new URL('../web/', import.meta.url).pathname;

/** @type {Map<string, {ran: Uint8Array, fns: Map<number, {name: string, ran: boolean}>}>} */
const files = new Map();
/** @type {Map<string, string>} */
const sources = new Map();

/** The file under web/ a script came from, or null: a page's /src/…, or Node's file:///…/web/src/…. @param {string} url */
function under(url) {
  const u = new URL(url);
  const path = u.protocol === 'file:' ? (u.pathname.startsWith(WEB) ? u.pathname.slice(WEB.length) : '') : u.pathname.replace(/^\//, '');
  return path.startsWith('src/') ? path : null;
}

for (const name of (await readdir(dir)).filter((f) => f.endsWith('.json'))) {
  const read = JSON.parse(await readFile(join(dir, name), 'utf8'));
  for (const script of Array.isArray(read) ? read : read.result ?? []) { // a page's list, or Node's { result }
    const path = under(script.url);
    if (!path) continue;
    if (!sources.has(path)) sources.set(path, await readFile(join(WEB, path), 'utf8').catch(() => ''));
    const text = /** @type {string} */ (sources.get(path));
    if (!text) continue;
    const f = files.get(path) ?? { ran: new Uint8Array(text.length), fns: new Map() };
    files.set(path, f);
    // V8's ranges nest: a function, then its blocks that ran a different
    // number of times. Painted outer first, the innermost range decides.
    // Offsets are in UTF-16 units, as JavaScript strings index.
    const here = new Uint8Array(text.length);
    const ranges = script.functions.flatMap((/** @type {any} */ fn) => fn.ranges).sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);
    for (const r of ranges) here.fill(r.count > 0 ? 1 : 0, r.startOffset, Math.min(r.endOffset, text.length));
    for (let i = 0; i < here.length; i++) f.ran[i] |= here[i];
    for (const fn of script.functions) {
      if (!fn.functionName) continue; // the module itself, and nameless callbacks: their lines speak for them
      const at = fn.ranges[0].startOffset, was = f.fns.get(at);
      f.fns.set(at, { name: fn.functionName, ran: (was?.ran ?? false) || fn.ranges[0].count > 0 });
    }
  }
}

/** Lines with code, and how many of them ran. @param {string} text @param {Uint8Array} ran */
function lines(text, ran) {
  let code = 0, hit = 0, at = 0, inComment = false;
  for (const line of text.split('\n')) {
    const t = line.trim();
    const comment = inComment || t.startsWith('//') || t.startsWith('/*') || t.startsWith('*');
    if (t.startsWith('/*') && !t.includes('*/')) inComment = true;
    if (inComment && t.includes('*/')) inComment = false;
    if (t && !comment) {
      code++;
      for (let i = at; i < at + line.length; i++) if (ran[i] && line[i - at].trim()) { hit++; break; }
    }
    at += line.length + 1;
  }
  return { code, hit };
}
/** The line a character offset falls on. @param {string} text @param {number} at */
const lineOf = (text, at) => text.slice(0, at).split('\n').length;

// Files no test loaded at all: a 0% that would otherwise not show. The stub
// stands in for the core only where it was not built, which a run refuses.
for (const path of (await readdir(join(WEB, 'src'), { recursive: true })).map((p) => `src/${p}`).filter((p) => p.endsWith('.js') && p !== 'src/stub-core.js' && !files.has(p))) {
  const text = await readFile(join(WEB, path), 'utf8');
  sources.set(path, text);
  files.set(path, { ran: new Uint8Array(text.length), fns: new Map() });
}

const rows = [...files].map(([path, f]) => {
  const text = /** @type {string} */ (sources.get(path));
  const { code, hit } = lines(text, f.ran);
  const never = [...f.fns].filter(([, fn]) => !fn.ran).map(([at, fn]) => `${fn.name} (${lineOf(text, at)})`);
  return { path, code, hit, never };
}).sort((a, b) => a.hit / a.code - b.hit / b.code);

const pct = (/** @type {number} */ a, /** @type {number} */ b) => `${b ? Math.round((a / b) * 100) : 100}%`;
const code = rows.reduce((s, r) => s + r.code, 0), hit = rows.reduce((s, r) => s + r.hit, 0);
const out = ['# What the tests ran', '', `${pct(hit, code)} of ${code} lines with code, in ${rows.length} files of web/src.`, ''];
out.push('| File | Lines run | Functions never run |', '|---|---|---|');
for (const r of rows) out.push(`| ${r.path} | ${pct(r.hit, r.code)} (${r.hit} of ${r.code}) | ${r.hit ? r.never.join(', ') || '—' : 'never loaded'} |`);
out.push('', 'Not measured: web/sw.js, the service worker — it runs outside the page, and only on a published site (not on the test server).');
console.log(out.join('\n'));
