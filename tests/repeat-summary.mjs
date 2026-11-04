// Counts the rounds of the repeated browser tests (.github/workflows/repeat.yml):
// for each browser, which tests failed, how often, and the first reason seen.
// Reads the folders results-<browser>-<machine>/ under the given folder,
// one .jsonl file per round (tests/record.mjs), and prints Markdown.
// Exits with 1 if any test failed even once: a test that passes only
// sometimes is a failing test.
//
//   node tests/repeat-summary.mjs <folder>

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.argv[2];
if (!root) throw new Error('usage: node tests/repeat-summary.mjs <folder>');

/** @type {Map<string, {rounds: number, tests: Map<string, {ran: number, failed: number, why?: string}>}>} */
const browsers = new Map();
for (const dir of (await readdir(root)).sort()) {
  const browser = /^results-(\w+)-\d+$/.exec(dir)?.[1];
  if (!browser) continue;
  const b = browsers.get(browser) ?? { rounds: 0, tests: new Map() };
  browsers.set(browser, b);
  for (const file of (await readdir(join(root, dir))).filter((f) => f.endsWith('.jsonl'))) {
    b.rounds++;
    for (const line of (await readFile(join(root, dir, file), 'utf8')).split('\n').filter(Boolean)) {
      const r = JSON.parse(line);
      if (r.skipped) continue;
      const key = `${r.file} › ${r.name}`;
      const t = b.tests.get(key) ?? { ran: 0, failed: 0 };
      b.tests.set(key, t);
      t.ran++;
      if (!r.ok) { t.failed++; t.why ??= r.why; }
    }
  }
}

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ');
let failedAny = browsers.size === 0;
const out = ['# Repeated browser tests', ''];
if (!browsers.size) out.push('No results were found: the rounds did not run.');
for (const [browser, b] of browsers) {
  const failing = [...b.tests].filter(([, t]) => t.failed).sort((x, y) => y[1].failed - x[1].failed);
  out.push(`## ${browser}: ${b.rounds} rounds, ${b.tests.size} tests`, '');
  if (!failing.length) { out.push('Every test passed in every round.', ''); continue; }
  failedAny = true;
  out.push('| Test | Failed | First reason |', '|---|---|---|');
  for (const [name, t] of failing) out.push(`| ${cell(name)} | ${t.failed} of ${t.ran} | ${cell(t.why)} |`);
  out.push('');
}
console.log(out.join('\n'));
process.exitCode = failedAny ? 1 : 0;
