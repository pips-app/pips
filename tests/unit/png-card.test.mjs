import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync, crc32 as zcrc } from 'node:zlib';
import { withEnvelope, envelopeIn, isPng, crc32 } from '../../web/src/png-card.js';

/** A real 2×2 PNG, as any program writes it. */
function tinyPng() {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zcrc(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(2, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const rows = Buffer.from([0, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255, 255]);
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]));
}

test('PNG CRC-32 is the standard one', () => {
  const b = new Uint8Array(Buffer.from('IEND'));
  assert.equal(crc32(b), zcrc(Buffer.from('IEND')));
});

test('a card goes into a picture and comes out the same; the picture stays a PNG', () => {
  const png = tinyPng();
  const env = new Uint8Array([0x45, 1, 2, 3, 250, 0, 7]);
  const out = withEnvelope(png, env);
  assert.ok(isPng(out));
  assert.deepEqual([...envelopeIn(out)], [...env]);
  assert.equal(Buffer.from(out.subarray(out.length - 8, out.length - 4)).toString(), 'IEND', 'the end stays the end');
  assert.deepEqual([...out.subarray(0, png.length - 12)], [...png.subarray(0, png.length - 12)], 'the picture itself is untouched');
  // A second card replaces the first: one card per picture.
  const again = withEnvelope(out, new Uint8Array([0x45, 9]));
  assert.deepEqual([...envelopeIn(again)], [0x45, 9]);
  assert.equal(again.length, png.length + 12 + 1 + 2);
  assert.equal(envelopeIn(png), null, 'a plain picture holds no card');
});

test('a damaged or foreign file holds no card, and never throws', () => {
  const out = withEnvelope(tinyPng(), new Uint8Array([0x45, 1, 2, 3]));
  for (let i = 8; i < out.length; i++) {
    const bad = out.slice();
    bad[i] ^= 0x10;
    const r = envelopeIn(bad);
    assert.ok(r === null || r.length === 3, `a flip at ${i}`);
    if (r) assert.notDeepEqual([...r], [1, 2, 3].map((x) => x ^ 0x10), 'a changed card is never taken');
  }
  for (let n = 0; n < out.length; n += 7) assert.equal(envelopeIn(out.subarray(0, n)), null, `cut at ${n}`);
  assert.equal(envelopeIn(new Uint8Array([1, 2, 3])), null);
  let seed = 7;
  for (let k = 0; k < 300; k++) {
    const junk = Uint8Array.from({ length: 64 + (k % 50) }, () => (seed = (seed * 1103515245 + 12345) & 0xff));
    junk.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.equal(envelopeIn(junk), null);
  }
  assert.throws(() => withEnvelope(new Uint8Array([1, 2, 3]), new Uint8Array([0x45])), /not a PNG/);
});
