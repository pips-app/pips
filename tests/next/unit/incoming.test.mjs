// @ts-check
// What came in (web-next/src/rules/incoming.js): what a file holds, why a
// card was not taken, a code the camera has just read, several counted.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const web = new URL('../../../web-next/src/', import.meta.url);
const { fileHolds, refusal, sameLook, tally, REPEAT_MS } = await import(new URL('rules/incoming.js', web).href);
const { packBundle } = await import(new URL('formats/bundle.js', web).href);
const { MAGIC } = await import(new URL('formats/links.js', web).href);

const env = (/** @type {number} */ n) => Uint8Array.from({ length: n }, (_, i) => (i === 0 ? 0x45 : i & 0xff));
const file = (/** @type {number[] | Uint8Array} */ body) => Uint8Array.from([...MAGIC, ...body]);

test('a file of one card holds its envelope; of several, all of them; from before envelopes, a bare card', () => {
  assert.deepEqual(fileHolds(file(env(10))), { envelopes: [env(10)] });
  assert.deepEqual(fileHolds(packBundle([env(5), env(7)])), { envelopes: [env(5), env(7)] });
  assert.deepEqual(fileHolds(file([0x50, 1, 2])), { payload: Uint8Array.from([0x50, 1, 2]) });
});

test('what holds no card says why: not Pips, a picture without one, newer, damaged', () => {
  assert.deepEqual(fileHolds(Uint8Array.from([1, 2, 3])), { problem: 'not_pips' });
  assert.deepEqual(fileHolds(Uint8Array.from(MAGIC)), { problem: 'not_pips' }, 'the signature alone');
  assert.deepEqual(fileHolds(file(env(71 * 1024))), { problem: 'not_pips' }, 'larger than a card can be');
  assert.deepEqual(fileHolds(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), { problem: 'no_card' });
  const newer = packBundle([env(5)]);
  newer[MAGIC.length + 1] = 2;
  assert.deepEqual(fileHolds(newer), { problem: 'newer' });
  assert.deepEqual(fileHolds(packBundle([env(5)]).slice(0, -1)), { problem: 'damaged' });
});

test('any bytes at all: a file is read or refused, never anything else', () => {
  let seed = 11;
  const rnd = (/** @type {number} */ n) => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 8) % n; };
  const starts = [file(env(40)), packBundle([env(20), env(9)]), Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])];
  for (let k = 0; k < 20000; k++) {
    const b = starts[k % starts.length].slice(0, rnd(60));
    for (let i = rnd(4); i > 0; i--) if (b.length) b[rnd(b.length)] = rnd(256);
    const out = fileHolds(b);
    assert.ok('problem' in out || ('envelopes' in out && out.envelopes.every((e) => e.length > 0)) || ('payload' in out && out.payload.length > 0), JSON.stringify(out));
  }
});

test('a card not taken is called the same wherever it came from; damage by its likely cause', () => {
  assert.equal(refusal({ code: 'newer_version' }, 'link'), 'newer');
  for (const code of ['bad_signature', 'bad_key', 'not_author', 'bad_edition', 'unsigned']) assert.equal(refusal({ code }, 'file'), 'forged', code);
  assert.equal(refusal({ code: 'storage_full' }, 'code'), 'full');
  assert.equal(refusal({ code: 'invalid_code' }, 'code'), 'damaged_code');
  assert.equal(refusal({ code: 'invalid_code' }, 'link'), 'damaged_link');
  assert.equal(refusal({ code: 'invalid_code' }, 'file'), 'damaged_file');
  // Not about the card: the core's worker stopped, a mistake of the app.
  assert.equal(refusal({ code: 'core_timeout' }, 'code'), 'other');
  assert.equal(refusal({ code: 'internal' }, 'code'), 'other');
  assert.equal(refusal(new TypeError('x'), 'code'), 'other');
});

test('the camera seeing a code it has just read is the same look; later, or another code, is not', () => {
  assert.equal(sameLook(null, 'A', 0), false);
  assert.equal(sameLook({ text: 'A', at: 1000 }, 'A', 1000 + REPEAT_MS - 1), true);
  assert.equal(sameLook({ text: 'A', at: 1000 }, 'A', 1000 + REPEAT_MS), false);
  assert.equal(sameLook({ text: 'A', at: 1000 }, 'B', 1001), false);
});

test('several cards counted: a numbered copy over a plain one is a card gained', () => {
  assert.deepEqual(tally(['added', 'numbered', 'duplicate', 'refused', 'refused']), { added: 2, had: 1, bad: 2 });
  assert.deepEqual(tally([]), { added: 0, had: 0, bad: 0 });
});
