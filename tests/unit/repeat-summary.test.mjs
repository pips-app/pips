// The count over repeated browser test rounds (tests/repeat-summary.mjs):
// what makes the repeated run red is itself checked here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const script = new URL('../repeat-summary.mjs', import.meta.url).pathname;
const line = (name, ok, extra = {}) => JSON.stringify({ file: 'a.test.mjs', name, ok, skipped: false, ...extra });

/** Writes rounds as folders the workflow makes, and runs the count on them. @param {Record<string, string[][]>} machines */
async function count(machines) {
  const root = await mkdtemp(join(tmpdir(), 'pips-repeat-'));
  for (const [dir, rounds] of Object.entries(machines)) {
    await mkdir(join(root, dir));
    for (const [i, lines] of rounds.entries()) await writeFile(join(root, dir, `round-${i + 1}.jsonl`), `${lines.join('\n')}\n`);
  }
  return run(process.execPath, [script, root]).then(({ stdout }) => ({ code: 0, out: stdout }), (e) => ({ code: e.code, out: e.stdout }));
}

test('every round green: said so, and the run passes', async () => {
  const { code, out } = await count({ 'results-chromium-1': [[line('one', true)], [line('one', true)]], 'results-chromium-2': [[line('one', true)]] });
  assert.equal(code, 0);
  assert.match(out, /## chromium: 3 rounds, 1 tests\n\nEvery test passed in every round/);
});

test('a test failing once in many rounds fails the run, counted with its first reason', async () => {
  const { code, out } = await count({
    'results-firefox-1': [[line('steady', true), line('flaky', true)], [line('steady', true), line('flaky', false, { why: 'first | reason' })]],
    'results-firefox-2': [[line('steady', true), line('flaky', false, { why: 'second' })], [line('steady', true), line('flaky', true)]],
  });
  assert.equal(code, 1);
  assert.match(out, /\| a\.test\.mjs › flaky \| 2 of 4 \| first \\\| reason \|/);
  assert.doesNotMatch(out, /steady/, 'a test that never failed is not listed');
});

test('skipped tests are not counted, and no results at all is a failure, not a pass', async () => {
  const skipped = await count({ 'results-firefox-1': [[line('speed', true, { skipped: true }), line('one', true)]] });
  assert.equal(skipped.code, 0);
  assert.match(skipped.out, /1 rounds, 1 tests/);
  const none = await count({});
  assert.equal(none.code, 1);
  assert.match(none.out, /No results were found/);
});

test('the record reporter: a line per test, a file only when it fails whole, the reason\'s first line', async () => {
  const { default: record } = await import('../record.mjs');
  const file = '/w/tests/e2e/a.test.mjs';
  async function* events() {
    yield { type: 'test:pass', data: { file, name: 'works', nesting: 0, details: {} } };
    yield { type: 'test:fail', data: { file, name: 'breaks', nesting: 0, details: { error: { cause: new Error('the reason\nand its stack') } } } };
    yield { type: 'test:pass', data: { file, name: 'inner', nesting: 1, details: {} } };
    yield { type: 'test:pass', data: { file, name: 'a.test.mjs', nesting: 0, details: {} } };
    yield { type: 'test:fail', data: { file: '/w/tests/e2e/b.test.mjs', name: 'b.test.mjs', nesting: 0, details: { error: new Error('did not load') } } };
    yield { type: 'test:diagnostic', data: { message: 'tests 2' } };
  }
  const lines = [];
  for await (const l of record(events())) lines.push(JSON.parse(l));
  assert.deepEqual(lines, [
    { file: 'a.test.mjs', name: 'works', ok: true, skipped: false },
    { file: 'a.test.mjs', name: 'breaks', ok: false, skipped: false, why: 'the reason' },
    { file: 'b.test.mjs', name: 'b.test.mjs', ok: false, skipped: false, why: 'did not load' },
  ]);
});
