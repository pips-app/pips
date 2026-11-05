// The app's text rule (web/src/text.js) against the core's: the same cases,
// the same limits. The app cleans what is typed so that the core, which
// decides, never has to refuse it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { plainText, finished, keepTyped, LIMITS } from '../../web/src/text.js';

const crate = new URL('../../crates/pips-format/', import.meta.url);

test('the cases the core is checked against: taken as they are, or cleaned', async () => {
  const lines = (await readFile(new URL('tests/data/plain-text.txt', crate), 'utf8')).split('\n').filter((l) => l && !l.startsWith('#') && !l.startsWith('='));
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

// The same fold as plain_text_fingerprint in crates/pips-format/tests/format.rs:
// every character in every context the rule tells apart. The app does not
// trim while typing, so the start is checked as a save would: by trim().
test('every character is taken or refused as the core does', async () => {
  const pinned = /^=\t(\w+)$/m.exec(await readFile(new URL('tests/data/plain-text.txt', crate), 'utf8'))?.[1];
  const contexts = [
    ['a', 'b'], ['', 'a'], ['\u{1F642}\u200D', ''], ['', '\u200D\u{1F642}'], ['', '\uFE0F'], ['\u0628\u200C', ''], ['', '\u200C\u0628'],
    ['\u{1F3F4}\u{E0067}', '\u{E007F}'], ['\u{1F642}\u200C', ''], ['\u2764', '\u200D\u{1F525}'], ['', '\u200D'], ['\u1820', '\u1820'],
    ['', '\uFE0F\u20E3'], ['\u1820', ''],
  ];
  let hash = 0x811c9dc5;
  for (let c = 0; c <= 0x10ffff; c++) {
    if (c >= 0xd800 && c <= 0xdfff) continue;
    const ch = String.fromCodePoint(c);
    let bits = 0;
    contexts.forEach(([before, after], i) => {
      const s = before + ch + after;
      if (plainText(s) === s && s.trim() === s) bits |= 1 << i;
    });
    hash = Math.imul(hash ^ bits, 0x01000193) >>> 0;
  }
  assert.equal(hash.toString(16).padStart(8, '0'), pinned);
});

test('cleaning takes out only what is refused, and leaves what it typed between', () => {
  assert.equal(plainText('al​ice'), 'alice');
  assert.equal(plainText('‮ecila'), 'ecila');
  assert.equal(plainText('a\u200D\u200Db'), 'ab', 'joiners with nothing to join');
  assert.equal(plainText('a\uFE0F\u200D\u{1F642}'), 'a\u{1F642}', 'a joiner whose neighbour went goes too');
  assert.equal(plainText('\u{1F642}\u200D\u200B\u{1F642}'), '\u{1F642}\u200D\u{1F642}', 'what was between goes, the join stays');
  assert.equal(plainText('\u{1F469}\u200D'), '\u{1F469}', 'a joiner at the end, as a cut leaves it');
  assert.equal(plainText('\u0645\u06CC\u200C', true), '\u0645\u06CC\u200C', 'a half-space being typed waits for the letter after it');
  assert.equal(plainText('a\u200C', true), 'a', '…where a letter after it could join');
  assert.equal(finished('\u0645\u06CC\u200C '), '\u0645\u06CC', 'and goes if none came');
  assert.equal(finished('\u0D28\u0D4D\u200D'), '\u0D28\u0D4D\u200D', 'a chillu ends a word');
  assert.equal(plainText('a\uD800b'), 'ab', 'a lone surrogate, which would be saved as U+FFFD');
  assert.equal(plainText('\u{1F3F4}\u{E0067}\u{E0062}'), '\u{1F3F4}', 'a flag cut short stays bare');
  const long = 'a\u200B'.repeat(200_000);
  const t0 = performance.now();
  assert.equal(plainText(long), 'a'.repeat(200_000));
  assert.ok(performance.now() - t0 < 2000, 'one pass, however hostile the paste');
  assert.equal(plainText('\u{1F469}‍\u{1F4BB}'), '\u{1F469}‍\u{1F4BB}', 'an emoji whole');
  assert.equal(plainText('Лис '), 'Лис ', 'a space typed before the next word stays');
  assert.equal(keepTyped('\u{1F98A}'.repeat(30), 60, 24, 'chars').value, '\u{1F98A}'.repeat(24), 'characters, not UTF-16 units');
});

test('a half-space is typed as any letter: one at a time, through the field\'s cleaning', () => {
  let v = '';
  for (const ch of '\u0645\u06CC\u200C\u062E\u0648\u0627\u0647\u0645') v = keepTyped(v + ch, v.length + ch.length, 24, 'chars').value;
  assert.equal(v, '\u0645\u06CC\u200C\u062E\u0648\u0627\u0647\u0645');
  assert.equal(finished(v), v);
});

test('a full field refuses what is typed, where it is typed, and the caret stays after it', () => {
  // A letter typed in the middle of a full title: the title stays whole.
  const full = 'Ж'.repeat(32);
  assert.deepEqual(keepTyped(full.slice(0, 10) + 'Ы' + full.slice(10), 11, 32, 'chars'), { value: full, caret: 10 });
  // A paste longer than the room: its tail goes, not the text after it.
  assert.deepEqual(keepTyped('ab' + 'xyz' + 'cd', 5, 6, 'chars'), { value: 'abxycd', caret: 4 });
  // Bytes for an address: a Cyrillic letter is two.
  assert.deepEqual(keepTyped('@abcд', 5, 5, 'bytes'), { value: '@abc', caret: 4 });
  // Cleaned on the way, the caret moved back by what was taken out before it.
  assert.deepEqual(keepTyped('al\u200Bice', 4, 24, 'chars'), { value: 'alice', caret: 3 });
  assert.deepEqual(keepTyped('alice', 5, 24, 'chars'), { value: 'alice', caret: 5 }, 'nothing to do');
});

test('the limits are the core\'s', async () => {
  const src = await readFile(new URL('src/lib.rs', crate), 'utf8');
  const limit = (name) => Number(new RegExp(`pub const ${name}: usize = (\\d+);`).exec(src)?.[1]);
  assert.deepEqual(LIMITS, { title: limit('MAX_TITLE'), name: limit('MAX_AUTHOR'), handle: limit('MAX_HANDLE'), link: limit('MAX_LINK') });
});
