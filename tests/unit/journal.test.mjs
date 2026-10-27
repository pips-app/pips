// The error journal: what goes in, what comes out, and that a flood stays one entry.
import test from 'node:test';
import assert from 'node:assert/strict';

const { createJournal, describe, report, MAX_ENTRIES } = await import('../../web/src/journal.js');

test('an error as text and a short stack, without the site address', () => {
  const e = new Error('boom');
  e.stack = 'Error: boom\n    at paint (https://pips.example/src/a.js:10:5)\n    at https://pips.example/src/b.js:3:1\n    at <anonymous>';
  const d = describe(e, 'https://pips.example');
  assert.equal(d.text, 'boom');
  assert.equal(d.stack, 'at paint (/src/a.js:10:5)\nat /src/b.js:3:1');
  // Firefox's form, a core error with a code, and something that is not an Error.
  assert.equal(describe(Object.assign(new Error('x'), { stack: 'paint@https://p/src/a.js:1:2\n' }), 'https://p').stack, 'paint@/src/a.js:1:2');
  assert.equal(describe({ code: 'bad_link', message: 'no' }).text, 'bad_link: no');
  assert.equal(describe('plain').text, 'plain');
  assert.equal(describe(new Error('y'.repeat(1000))).text.length, 400);
});

test('the same error again is one entry with a count; the oldest go past the limit', () => {
  let t = 0;
  const saved = [];
  const j = createJournal({ now: () => ++t, where: () => 'collection', save: (e) => saved.push(e.length) });
  for (let i = 0; i < 50; i++) j.error(new Error('loop'));
  assert.equal(j.entries.length, 1);
  assert.equal(j.entries[0].count, 50);
  assert.equal(j.entries[0].at, 50, 'the time of the last');
  assert.equal(j.entries[0].where, 'collection');
  j.warn('odd', 'storage');
  assert.equal(j.entries[1].where, 'storage', 'where given wins');
  for (let i = 0; i < MAX_ENTRIES + 5; i++) j.error(new Error(`e${i}`));
  assert.equal(j.entries.length, MAX_ENTRIES);
  assert.equal(j.entries.at(-1).text, `e${MAX_ENTRIES + 4}`);
  assert.ok(saved.length > 0);
  j.clear();
  assert.equal(j.entries.length, 0);
});

test('entries from an earlier start come first; anything malformed is left out', () => {
  const j = createJournal({ now: () => 5 });
  j.error(new Error('now'));
  j.restore([{ at: 1, kind: 'error', where: '', text: 'before', stack: '', count: 1 }, null, { text: 3 }]);
  assert.deepEqual(j.entries.map((e) => e.text), ['before', 'now']);
  j.restore(/** @type {any} */ ('not a list'));
  assert.equal(j.entries.length, 2);
});

test('the report: facts, then entries newest first', () => {
  const text = report([
    { at: Date.UTC(2026, 9, 27, 10), kind: 'warn', where: 'storage', text: 'old', stack: '', count: 1 },
    { at: Date.UTC(2026, 9, 27, 11), kind: 'error', where: 'editor', text: 'new', stack: 'at f (/src/x.js:1:2)', count: 3 },
  ], [['version', 'pips-abc'], ['cards', '4 (own 1)']]);
  assert.match(text, /^Pips — error report\nversion: pips-abc\ncards: 4 \(own 1\)\n\n2 entries, newest first:\n2026-10-27 11:00:00 error ×3 \[editor\] new\n {4}at f \(\/src\/x\.js:1:2\)\n2026-10-27 10:00:00 warn \[storage\] old$/);
  assert.match(report([], []), /No entries\.$/);
});
