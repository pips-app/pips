// Typing the recovery words: whole, cut to four letters, or pasted at once.
import test from 'node:test';
import assert from 'node:assert/strict';

const { wordBook, splitWords } = await import('../../web/src/words.js');

const book = wordBook(['abandon', 'ability', 'able', 'act', 'action', 'actor', 'zoo']);

test('a word, its first four letters, or nothing', () => {
  assert.equal(book.resolve('Ability '), 'ability');
  assert.equal(book.resolve('abil'), 'ability', 'four letters are enough');
  assert.equal(book.resolve('acti'), 'action');
  assert.equal(book.resolve('act'), 'act', 'a short word is typed whole');
  assert.equal(book.resolve('ab'), null, 'too short to tell');
  assert.equal(book.resolve('abilityx'), null);
  assert.equal(book.resolve(''), null);
});

test('a typo shows before the word is finished', () => {
  assert.ok(book.possible('abi'));
  assert.ok(book.possible(''));
  assert.ok(!book.possible('abx'));
  assert.ok(!book.possible('zoom'));
});

test('pasted text splits on any space', () => {
  assert.deepEqual(splitWords('  Able\tzoo\n act  '), ['able', 'zoo', 'act']);
  assert.deepEqual(splitWords('   '), []);
});
