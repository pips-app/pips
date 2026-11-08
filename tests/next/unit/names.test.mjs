// From tests/unit/authors.test.mjs, against web-next/src/rules/names.js.
// Names against keys: the same name with another key is said, whatever
// case or look-alike letters it is written in.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { nameKey, shortKey, knownNames, clash } = await import(new URL('../../../web-next/src/rules/names.js', import.meta.url).href);

const KITSU = 'aa'.repeat(32), OTHER = 'bb'.repeat(32), ME = 'cc'.repeat(32);
/** A collection entry: a card by `name` signed with `hex`, sent by `from` if given. */
const entry = (name, hex, from = null) => ({ card: { author: name }, rec: { from }, author: hex ? { hex } : null });

test('names read the same across case, full-width letters and look-alike Cyrillic and Greek', () => {
  for (const same of ['Kitsu', 'KITSU', 'kitsu', 'ｋｉｔｓｕ', 'kіtsu' /* Cyrillic і */, 'кitsu' /* Cyrillic к */, 'KΙTSU' /* Greek Ι */, 'КITSU' /* Cyrillic К */]) {
    assert.equal(nameKey(same), 'kitsu', same);
  }
  assert.equal(nameKey('ВАС'), nameKey('bac'), 'capitals that look Latin');
  assert.equal(nameKey('вас'), nameKey('BAC'), 'and their lower case with them');
  assert.equal(nameKey('Мария'), nameKey('мария'), 'a Cyrillic name keeps matching itself in any case');
  assert.notEqual(nameKey('kitsu'), nameKey('kitsy'));
  assert.notEqual(nameKey('вася'), nameKey('baca'), 'я has no Latin twin');
});

test('a short key is written as the core writes it', () => {
  assert.equal(shortKey('33' + '2e' + 'bc' + 'd7' + '00'.repeat(28)), '33·2e·bc·d7');
});

test('a known name with another key is said; the same key, an unknown name or no name is not', () => {
  const known = knownNames([entry('kitsu', KITSU), entry('mossfern', OTHER, { nick: 'pixelfox', key: ME })]);
  const own = { name: 'pixelfox', hex: ME };
  assert.equal(clash({ name: 'kitsu', hex: KITSU }, known, own), null, 'the same key');
  assert.deepEqual(clash({ name: 'Kitsu', hex: OTHER }, known, own), { own: false, other: 'aa·aa·aa·aa' }, 'another key');
  assert.deepEqual(clash({ name: 'кitsu', hex: OTHER }, known, own), { own: false, other: 'aa·aa·aa·aa' }, 'a look-alike letter');
  assert.equal(clash({ name: 'newfox', hex: OTHER }, known, own), null, 'a name not seen before');
  assert.equal(clash({ name: '', hex: OTHER }, known, own), null, 'no name');
});

test('the person\'s own name with another key is said; with theirs it is not', () => {
  const own = { name: 'pixelfox', hex: ME };
  const known = knownNames([]);
  assert.deepEqual(clash({ name: 'PixelFox', hex: OTHER }, known, own), { own: true });
  assert.equal(clash({ name: 'pixelfox', hex: ME }, known, own), null);
});

test('senders count as well as artists, and two artists who share a name are told apart on both their cards', () => {
  const known = knownNames([entry('kitsu', KITSU), entry('kitsu', OTHER), entry('lumen', ME, { nick: 'kitsu', key: ME })]);
  const own = { name: '', hex: 'dd'.repeat(32) };
  assert.equal(clash({ name: 'kitsu', hex: KITSU }, known, own)?.own, false, 'the first kitsu');
  assert.equal(clash({ name: 'kitsu', hex: OTHER }, known, own)?.own, false, 'the second kitsu');
  assert.equal(clash({ name: 'kitsu', hex: ME }, known, own)?.own, false, 'a sender who calls themself kitsu');
});

test('random names: the comparing form is stable, blind to case, and a name never clashes with itself', () => {
  const letters = ['a', 'K', 'к', 'М', 'ο', 'Ο', 'ж', 'ｋ', '1', ' ', 'É', 'é'];
  let s = 7;
  const pick = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return letters[(s >>> 8) % letters.length]; };
  for (let round = 0; round < 2000; round++) {
    const name = Array.from({ length: 1 + (round % 12) }, pick).join('');
    const k = nameKey(name);
    assert.equal(nameKey(k), k, `stable: ${name}`);
    assert.equal(nameKey(name.toUpperCase()), nameKey(name.toLowerCase()), `case: ${name}`);
    const known = knownNames([entry(name, KITSU)]);
    assert.equal(clash({ name, hex: KITSU }, known, { name: '', hex: ME }), null, 'its own name and key');
    assert.deepEqual(clash({ name: name.toUpperCase(), hex: OTHER }, known, { name: '', hex: ME }), { own: false, other: shortKey(KITSU) }, `the same name, another key: ${name}`);
  }
});
