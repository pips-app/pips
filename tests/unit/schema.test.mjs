import test from 'node:test';
import assert from 'node:assert/strict';
import { SCHEMA, STEPS, fillCard, stepsFrom } from '../../web/src/schema.js';

test('one step for every version up to this one', () => {
  assert.equal(STEPS.length, SCHEMA);
  assert.deepEqual(stepsFrom(0), STEPS);
  assert.deepEqual(stepsFrom(SCHEMA), []);
  assert.throws(() => stepsFrom(SCHEMA + 1), RangeError, 'data from a newer app has no way back');
  assert.throws(() => stepsFrom(-1), RangeError);
});

test('1 → 2: an older card record gains the fields it lacked, and keeps its own', () => {
  const old = { digest: 'd', payload: new Uint8Array([1]), mine: false, state: 'archive', received: 5, note: 'с ярмарки' };
  const rec = fillCard(old);
  assert.deepEqual(rec, { ...old, cert: null, edition: null, trashedAt: null, from: null, tags: [] });
  assert.equal(rec.note, 'с ярмарки');
  assert.equal(fillCard(rec), rec, 'a full record comes back as it is: nothing to write');
  assert.deepEqual(fillCard({ ...rec, tags: 'нет' }).tags, [], 'tags are a list');
});
