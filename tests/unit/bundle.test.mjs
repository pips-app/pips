// Several cards in one .pips file: packed and unpacked alike, and anything
// that does not hold together refused, never half-read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { packBundle, unpackBundle, isBundle, MAX_CARDS } from '../../web/src/bundle.js';
import { MAGIC } from '../../web/src/links.js';

const env = (n, fill) => Uint8Array.from({ length: n }, (_, i) => (i === 0 ? 0x45 : fill));

test('a bundle gives back the envelopes it was made of, in order', () => {
  const list = [env(10, 1), env(300, 2), env(1, 3)];
  const b = packBundle(list);
  assert.ok(isBundle(b));
  assert.deepEqual(unpackBundle(b)?.map((e) => [...e]), list.map((e) => [...e]));
  // A file of one card is not a bundle: it stays as it always was.
  assert.equal(isBundle(Uint8Array.from([...MAGIC, ...env(5, 0)])), false);
});

test('a bundle that does not hold together is refused whole', () => {
  const b = packBundle([env(8, 1), env(8, 2)]);
  const bad = (/** @type {Uint8Array} */ x, why) => assert.equal(unpackBundle(x), null, why);
  bad(b.slice(0, b.length - 1), 'cut short');
  bad(Uint8Array.from([...b, 0]), 'a byte after the last envelope');
  const layout = b.slice(); layout[5] = 2; bad(layout, 'a layout it does not know');
  const none = b.slice(); none[6] = 0; none[7] = 0; bad(none, 'no cards');
  const more = b.slice(); more[7] = 3; bad(more, 'more cards said than there are');
  const long = b.slice(); long[8] = 0x7f; bad(long, 'a length past the end');
  const zero = b.slice(); zero.set([0, 0, 0, 0], 8); bad(zero, 'an empty envelope');
  const notEnv = b.slice(); notEnv[12] = 0x50; bad(notEnv, 'something else than an envelope');
  bad(Uint8Array.from([...MAGIC, 0x42]), 'only its start');
  bad(new Uint8Array(0), 'nothing');
  assert.throws(() => packBundle([]), 'no cards, no bundle');
  assert.throws(() => packBundle(Array.from({ length: MAX_CARDS + 1 }, () => env(2, 0))));
  assert.throws(() => packBundle([Uint8Array.from([1, 2])]), 'only envelopes go in');
});

test('any bytes at all: a bundle is read or refused, never anything else', () => {
  // A fixed seed, so a failure can be replayed.
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const good = packBundle([env(20, 1), env(9, 2), env(40, 3)]);
  for (let k = 0; k < 20000; k++) {
    const b = good.slice(0, rnd(good.length + 4));
    for (let i = rnd(4); i > 0; i--) if (b.length) b[rnd(b.length)] = rnd(256);
    const out = unpackBundle(b);
    assert.ok(out === null || (Array.isArray(out) && out.every((e) => e.length > 0 && e[0] === 0x45)));
  }
});
