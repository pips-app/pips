// @ts-check
// The layout of the new app's database (web-next/src/schema.js): a step for
// every version, and no way back from a newer one.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { SCHEMA, STEPS, stepsFrom } = await import(new URL('../../../web-next/src/schema.js', import.meta.url).href);

test('one step for every version up to this one, and none from a newer one', () => {
  assert.equal(STEPS.length, SCHEMA);
  assert.deepEqual(stepsFrom(0), STEPS);
  assert.deepEqual(stepsFrom(SCHEMA), []);
  assert.throws(() => stepsFrom(SCHEMA + 1), RangeError, 'data from a newer app has no way back');
  assert.throws(() => stepsFrom(-1), RangeError);
  assert.throws(() => stepsFrom(0.5), RangeError);
});
