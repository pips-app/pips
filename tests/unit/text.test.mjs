// The app's text rule (web/src/text.js) against the core's: the same cases,
// the same limits. The app cleans what is typed so that the core, which
// decides, never has to refuse it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { plainText, fitChars, LIMITS } from '../../web/src/text.js';

const crate = new URL('../../crates/pips-format/', import.meta.url);

test('the cases the core is checked against: taken as they are, or cleaned', async () => {
  const lines = (await readFile(new URL('tests/data/plain-text.txt', crate), 'utf8')).split('\n').filter((l) => l && !l.startsWith('#'));
  assert.ok(lines.length > 20);
  for (const line of lines) {
    const [mark, text] = [line[0], line.slice(2)];
    // The app does not trim or count (that is the field's limit, and the
    // save's trim): a refused case is one it changes, unless only its ends
    // or its length are what the core refuses.
    const plain = plainText(text) === text;
    const ends = text.trim() !== text, long = Array.from(text).length > 32;
    if (mark === '+') assert.ok(plain && !ends && !long, `taken as it is: ${JSON.stringify(text)}`);
    else assert.ok(!plain || ends || long, `refused or cleaned: ${JSON.stringify(text)}`);
  }
});

test('cleaning takes out only what is refused, and leaves what it typed between', () => {
  assert.equal(plainText('al​ice'), 'alice');
  assert.equal(plainText('‮ecila'), 'ecila');
  assert.equal(plainText('a‍‍b'), 'ab', 'joiners with nothing to join');
  assert.equal(plainText('\u{1F469}‍\u{1F4BB}'), '\u{1F469}‍\u{1F4BB}', 'an emoji whole');
  assert.equal(plainText('Лис '), 'Лис ', 'a space typed before the next word stays');
  assert.equal(fitChars('\u{1F98A}'.repeat(30), 24), '\u{1F98A}'.repeat(24), 'characters, not UTF-16 units');
});

test('the limits are the core\'s', async () => {
  const src = await readFile(new URL('src/lib.rs', crate), 'utf8');
  const limit = (name) => Number(new RegExp(`pub const ${name}: usize = (\\d+);`).exec(src)?.[1]);
  assert.deepEqual(LIMITS, { title: limit('MAX_TITLE'), name: limit('MAX_AUTHOR'), handle: limit('MAX_HANDLE'), link: limit('MAX_LINK') });
});
