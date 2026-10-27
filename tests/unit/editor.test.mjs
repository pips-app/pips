// The editor's arithmetic: colours, tools, the undo tree, the picture and
// what it becomes as a card. No browser needed.
import test from 'node:test';
import assert from 'node:assert/strict';

const { parseHex, hex, toHsv, fromHsv, nearest, ramp } = await import('../../web/src/editor/color.js');
const { line, rect, ellipse, fill, mirror, corner, span, within, lift, flip, turn, place, dithered } = await import('../../web/src/editor/raster.js');
const { budget, LIMIT, issuable, MAX_EDGE } = await import('../../web/src/budget.js');
const { createHistory } = await import('../../web/src/editor/history.js');
const { blank, createModel, T } = await import('../../web/src/editor/model.js');
const { toCard } = await import('../../web/src/editor/to-card.js');

const PAL = { colors: [0xf7f3ea, 0x17151f, 0xc4392f, 0x3b5fa8], id: 7 };

test('colours: hex both ways, hsv round trip, nearest, ramp', () => {
  assert.equal(parseHex('#E0645A'), 0xe0645a);
  assert.equal(parseHex('e64'), 0xee6644);
  assert.equal(parseHex('nope'), null);
  assert.equal(hex(0x0a0b0c), '#0a0b0c');
  for (const c of [0xe0645a, 0x000000, 0xffffff, 0x3b5fa8, 0x8cc24a]) {
    const { h, s, v } = toHsv(c);
    assert.equal(fromHsv(h, s, v), c);
  }
  assert.equal(nearest(0xc0402f, PAL.colors), 2);
  const r = ramp(0xe0645a);
  assert.equal(r.length, 6);
  assert.equal(r[3], 0xe0645a);
  assert.ok(toHsv(r[0]).v < toHsv(r[2]).v && toHsv(r[5]).v >= toHsv(r[4]).v, 'dark to light');
});

test('tools: lines, boxes, ellipses, fill, mirror, corners', () => {
  assert.deepEqual(line({ x: 0, y: 0 }, { x: 3, y: 1 }).length, 4);
  assert.deepEqual(line({ x: 2, y: 2 }, { x: 2, y: 2 }), [{ x: 2, y: 2 }]);
  assert.equal(rect({ x: 0, y: 0 }, { x: 3, y: 3 }, false).length, 12);
  assert.equal(rect({ x: 3, y: 3 }, { x: 0, y: 0 }, true).length, 16);
  // An ellipse is symmetric both ways, filled or not.
  for (const filled of [false, true]) {
    const e = ellipse({ x: 0, y: 0 }, { x: 9, y: 5 }, filled);
    const has = new Set(e.map((c) => `${c.x},${c.y}`));
    for (const c of e) {
      assert.ok(has.has(`${9 - c.x},${c.y}`) && has.has(`${c.x},${5 - c.y}`));
    }
  }
  const buf = new Uint8Array(16).fill(0);
  buf[5] = buf[6] = buf[9] = buf[10] = 1; // a 2×2 block in a 4×4 canvas
  assert.equal(fill(buf, 4, { x: 0, y: 0 }).length, 12);
  assert.deepEqual(fill(buf, 4, { x: 1, y: 1 }).sort(), [10, 5, 6, 9].sort());
  assert.deepEqual(mirror({ x: 1, y: 2 }, 8, { x: true, y: true }), [{ x: 1, y: 2 }, { x: 6, y: 2 }, { x: 1, y: 5 }, { x: 6, y: 5 }]);
  assert.ok(corner({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }));
  assert.ok(!corner({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }));
});

test('budget: one code, a loop, too long', () => {
  assert.deepEqual(budget(400), { bytes: 400, codes: 1, seconds: 2, level: 'one' });
  const b = budget(2000);
  assert.equal(b.codes, 10);
  assert.equal(b.level, 'loop');
  assert.ok(b.seconds >= 5 && b.seconds <= 7);
  assert.equal(budget(LIMIT + 1).level, 'over');
});

test('what may be signed: the same rule for drawn and imported cards', () => {
  assert.equal(issuable({ width: 64, height: 64 }, 900).refused, null);
  assert.equal(issuable({ width: 64, height: 65 }, 900).refused, 'too_big', 'a side over the app canvas');
  assert.equal(issuable({ width: 32, height: 32 }, LIMIT + 1).refused, 'too_slow');
  assert.equal(issuable({ width: MAX_EDGE * 2, height: 8 }, LIMIT + 1).refused, 'too_big', 'size first');
});

test('undo tree: nothing done is lost', () => {
  const log = [];
  const h = createHistory({ apply: (e, dir) => log.push(dir * e), sizeOf: () => 1 });
  h.push(1, { label: 'a' });
  h.push(2, { label: 'b' });
  h.undo();
  assert.deepEqual(log, [-2]);
  h.push(3, { label: 'c' }); // a new branch beside "b"
  assert.equal(h.canRedo, false);
  assert.deepEqual(h.line().map((n) => n.label), ['', 'a', 'c']);
  const b = h.root.kids[0].kids[0];
  assert.equal(b.label, 'b');
  h.goTo(b); // back to the abandoned branch
  assert.deepEqual(log, [-2, -3, 2]);
  assert.equal(h.current, b);
  h.undo();
  assert.equal(h.redoStep?.label, 'b', 'redo follows the branch last taken');
});

test('undo tree: merging, the limit, saving', () => {
  let t = 0;
  const h = createHistory({ apply: () => {}, sizeOf: () => 10, join: (a, b) => a + b, limit: 30, now: () => t });
  h.push(1, { label: 'x', merge: 'title' });
  t += 500;
  h.push(2, { label: 'x', merge: 'title' });
  assert.equal(h.line().length, 2, 'typed in one go: one step');
  assert.equal(h.current.entry, 3);
  t += 5000;
  h.push(4, { label: 'x', merge: 'title' });
  assert.equal(h.line().length, 3, 'after a pause: a new step');
  h.push(5, { label: 'y' });
  h.push(6, { label: 'z' });
  assert.ok(h.bytes <= 30, 'oldest steps forgotten');
  assert.equal(h.line().at(-1).label, 'z');
  const copy = createHistory({ apply: () => {}, sizeOf: () => 10 });
  copy.load(JSON.parse(JSON.stringify(h.save())));
  assert.deepEqual(copy.line().map((n) => n.label), h.line().map((n) => n.label));
  assert.equal(copy.current.label, 'z');
});

test('the picture: strokes, frames, palette and size are all undoable', () => {
  const m = createModel(blank(4, PAL));
  const s = m.stroke(0);
  s.set(0, 2);
  s.set(5, 2);
  s.commit('pen');
  assert.equal(m.doc.frames[0][5], 2);
  m.addFrame(0);
  assert.equal(m.doc.frames.length, 2);
  m.setPalette([0xc4392f, 0xffffff], null);
  assert.equal(m.doc.frames[1][5], 0, 'red found again in the new palette');
  m.resize(8);
  assert.equal(m.doc.size, 8);
  assert.equal(m.doc.frames[0][2 * 8 + 2], 0, 'the picture stays in the middle');
  m.setTitle('Г');
  m.setTitle('Гр'); // typed in one go
  for (let k = 0; k < 5; k++) m.undo();
  assert.equal(m.doc.size, 4);
  assert.equal(m.doc.frames.length, 1);
  assert.equal(m.doc.frames[0][5], T);
  assert.equal(m.doc.title, '');
  assert.equal(m.history.canUndo, false);
  while (m.history.canRedo) m.redo();
  assert.equal(m.doc.title, 'Гр');
  assert.equal(m.doc.size, 8);
});

test('a cancelled stroke leaves nothing, not even a step', () => {
  const m = createModel(blank(4, PAL));
  const s = m.stroke(0);
  s.set(3, 1);
  s.cancel();
  assert.equal(m.doc.frames[0][3], T);
  assert.equal(m.history.canUndo, false);
});

test('as a card: built-in palettes cost a number, others only the colours used', () => {
  const m = createModel(blank(4, PAL));
  const s = m.stroke(0);
  s.set(0, 2);
  s.commit('pen');
  let c = /** @type {any} */ (toCard(m.doc, { nick: 'a', handle: null, link: '' })).card;
  assert.deepEqual(c.palette, { builtin: 7 });
  assert.equal(c.opaque, false);
  assert.equal(c.pixels[0], 2);
  assert.equal(c.pixels[1], 0, 'empty cells are index 0');
  // The first colour drawn, with empty cells too: colours go inline.
  const s2 = m.stroke(0);
  s2.set(1, 0);
  s2.commit('pen');
  c = /** @type {any} */ (toCard(m.doc, { nick: 'a', handle: null, link: '' })).card;
  assert.equal(c.palette.inline.length, 3);
  assert.equal(c.pixels[1], 1);
  assert.equal(c.pixels[0], 2);
  assert.equal(c.pixels[2], 0);
});

test('selections: a box, lifted, mirrored, turned and put down', () => {
  assert.deepEqual(span({ x: 5, y: -2 }, { x: 1, y: 9 }, 8), { x0: 1, y0: 0, x1: 5, y1: 7 });
  assert.ok(within({ x0: 1, y0: 1, x1: 2, y1: 2 }, { x: 2, y: 1 }));
  // 4×4 canvas: a 3×2 piece "abc / def" at (1,1).
  const buf = new Uint8Array(16).fill(255);
  [[1, 1, 1], [2, 1, 2], [3, 1, 3], [1, 2, 4], [2, 2, 5], [3, 2, 6]].forEach(([x, y, v]) => { buf[y * 4 + x] = v; });
  const p = lift(buf, 4, { x0: 1, y0: 1, x1: 3, y1: 2 });
  assert.deepEqual([p.w, p.h, [...p.cells]], [3, 2, [1, 2, 3, 4, 5, 6]]);
  assert.deepEqual([...flip(p, 'x').cells], [3, 2, 1, 6, 5, 4]);
  assert.deepEqual([...flip(p, 'y').cells], [4, 5, 6, 1, 2, 3]);
  const q = turn(p); // clockwise: "da / eb / fc"
  assert.deepEqual([q.w, q.h, [...q.cells]], [2, 3, [4, 1, 5, 2, 6, 3]]);
  assert.deepEqual([...turn(turn(turn(turn(p)))).cells], [...p.cells], 'four turns: as it was');
  // Put down hanging over the edge: what falls off is lost, empty cells cover nothing.
  const holey = { w: 2, h: 1, cells: Uint8Array.from([7, 255]) };
  assert.deepEqual(place(holey, 3, 0, 4, 255), [{ i: 3, v: 7 }]);
  assert.ok(dithered({ x: 0, y: 0 }) && !dithered({ x: 1, y: 0 }) && dithered({ x: 1, y: 1 }));
});

test('copy numbers: two logs of one card are joined, never chosen between', async () => {
  const { joinLogs, nextNumber } = await import('../../web/src/editions.js');
  const a = { of: 10, issued: [{ edition: 1, nick: 'a', holder: 'k1', day: 1 }, { edition: 2, nick: 'b', holder: 'k2', day: 2 }] };
  // An older backup, and a second phone that issued №3 the backup lacks.
  const b = { of: 10, issued: [{ edition: 1, nick: 'a', holder: 'k1', day: 1 }, { edition: 3, nick: 'c', holder: 'k3', day: 3 }] };
  const j = joinLogs(a, b);
  assert.deepEqual(j.issued.map((i) => i.edition), [1, 2, 3]);
  assert.equal(j.of, 10);
  assert.equal(nextNumber(j), 4, 'one past the highest, not the count');
  assert.equal(nextNumber({ of: 0, issued: [{ edition: 5, nick: '', holder: 'x', day: 0 }] }), 6);
  assert.equal(nextNumber({ of: 0, issued: [] }), 1);
  // The same number to two people (two phones, one key): both are kept.
  const twice = joinLogs(a, { of: 10, issued: [{ edition: 2, nick: 'z', holder: 'k9', day: 2 }] });
  assert.equal(twice.issued.length, 3);
  assert.equal(joinLogs(undefined, b).of, 10, 'a run fixed by the other log');
  assert.equal(joinLogs({ of: 0, issued: [] }, b).of, 10);
});
