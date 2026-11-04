// The editor's arithmetic: colours, tools, the undo tree, the picture and
// what it becomes as a card. No browser needed.
import test from 'node:test';
import assert from 'node:assert/strict';

const { parseHex, hex, toHsv, fromHsv, nearest, ramp } = await import('../../web/src/editor/color.js');
const { line, rect, ellipse, fill, mirror, corner, span, within, lift, flip, turn, place, dithered } = await import('../../web/src/editor/raster.js');
const { budget, LIMIT, issuable, MAX_EDGE } = await import('../../web/src/budget.js');
const { createHistory } = await import('../../web/src/editor/history.js');
const { blank, createModel, composite, upgradeDraft, T, MAX_HOLD, MAX_FRAMES } = await import('../../web/src/editor/model.js');
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
  // A fraction or NaN would never be reached: refused, not walked forever.
  assert.throws(() => line({ x: 1, y: 1 }, { x: 3.5, y: 2 }), RangeError);
  assert.throws(() => line({ x: 1, y: 1 }, { x: NaN, y: 2 }), RangeError);
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

test('undo tree: a step forgotten to keep within the limit cannot be gone to, and nothing moves', () => {
  const log = [];
  const h = createHistory({ apply: (e, dir) => log.push(dir * e), sizeOf: () => 10, limit: 30 });
  h.push(1, { label: 'a' });
  const old = h.current;
  for (let i = 2; i <= 6; i++) h.push(i, { label: 'b' });
  const here = h.current;
  log.length = 0;
  assert.equal(h.goTo(old), false, 'forgotten: said so (it used to undo towards it forever)');
  assert.equal(h.current, here);
  assert.deepEqual(log, [], 'nothing undone or redone');
  const kept = h.line().at(-2);
  assert.equal(h.goTo(kept), true, 'a step still kept is reached as before');
  assert.equal(h.current, kept);
});

test('the picture: strokes, frames, palette and size are all undoable', () => {
  const m = createModel(blank(4, PAL));
  const s = m.stroke(0, 0);
  s.set(0, 2);
  s.set(5, 2);
  s.commit('pen');
  assert.equal(m.doc.frames[0][0][5], 2);
  m.addFrame(0);
  assert.equal(m.doc.frames.length, 2);
  m.setPalette([0xc4392f, 0xffffff], null);
  assert.equal(m.doc.frames[1][0][5], 0, 'red found again in the new palette');
  m.resize(8);
  assert.equal(m.doc.size, 8);
  assert.equal(m.doc.frames[0][0][2 * 8 + 2], 0, 'the picture stays in the middle');
  m.setTitle('Г');
  m.setTitle('Гр'); // typed in one go
  for (let k = 0; k < 5; k++) m.undo();
  assert.equal(m.doc.size, 4);
  assert.equal(m.doc.frames.length, 1);
  assert.equal(m.doc.frames[0][0][5], T);
  assert.equal(m.doc.title, '');
  assert.equal(m.history.canUndo, false);
  while (m.history.canRedo) m.redo();
  assert.equal(m.doc.title, 'Гр');
  assert.equal(m.doc.size, 8);
});

test('a cancelled stroke leaves nothing, not even a step', () => {
  const m = createModel(blank(4, PAL));
  const s = m.stroke(0, 0);
  s.set(3, 1);
  s.cancel();
  assert.equal(m.doc.frames[0][0][3], T);
  assert.equal(m.history.canUndo, false);
});

test('as a card: built-in palettes cost a number, others only the colours used', () => {
  const m = createModel(blank(4, PAL));
  const s = m.stroke(0, 0);
  s.set(0, 2);
  s.commit('pen');
  let c = /** @type {any} */ (toCard(m.doc, { nick: 'a', handle: null, link: '' })).card;
  assert.deepEqual(c.palette, { builtin: 7 });
  assert.equal(c.opaque, false);
  assert.equal(c.pixels[0], 2);
  assert.equal(c.pixels[1], 0, 'empty cells are index 0');
  // The first colour drawn, with empty cells too: colours go inline.
  const s2 = m.stroke(0, 0);
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

test('the pen: corners come out of a curve, never out of what was already drawn', async () => {
  const { createStrokes } = await import('../../web/src/editor/strokes.js');
  const setup = (axes = { x: false, y: false }, pen = 'solid') => {
    const m = createModel(blank(8, PAL));
    const strokes = createStrokes({
      model: m, pick() {}, selection: /** @type {any} */ ({}),
      now: () => ({ frame: 0, layer: 0, color: 1, shape: 'line', pen, mirror: axes.x || axes.y, axes }),
    });
    const at = (/** @type {number} */ x, /** @type {number} */ y) => m.doc.frames[0][0][y * 8 + x];
    return { m, strokes, at };
  };
  const draw = (/** @type {any} */ strokes, /** @type {number[][]} */ cells) => {
    const hnd = strokes.start({ x: cells[0][0], y: cells[0][1] }, 'pen');
    for (const [x, y] of cells.slice(1)) hnd.move({ x, y });
    hnd.end();
  };

  // A staircase: the cells that only turn a corner go (pixel-perfect).
  let { strokes, at } = setup();
  draw(strokes, [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2]]);
  assert.deepEqual([at(0, 0), at(1, 0), at(1, 1), at(2, 1), at(2, 2)], [1, T, 1, T, 1]);

  // Along a line and back, then off it: the line keeps every cell.
  ({ strokes, at } = setup());
  draw(strokes, [[0, 3], [1, 3], [2, 3], [3, 3], [2, 3], [2, 4]]);
  assert.deepEqual([at(0, 3), at(1, 3), at(2, 3), at(3, 3)], [1, 1, 1, 1], 'no hole where the finger turned back');

  // Crossing an earlier part of the stroke at a corner: no hole there either.
  ({ strokes, at } = setup());
  draw(strokes, [[1, 1], [2, 1], [3, 1], [3, 2], [3, 3], [2, 3], [2, 2], [2, 1], [1, 1], [1, 0]]);
  assert.equal(at(2, 1), 1, 'the cell where the stroke crossed itself');

  // With the mirror, the same holds for the mirrored half.
  ({ strokes, at } = setup({ x: true, y: false }));
  draw(strokes, [[0, 3], [1, 3], [2, 3], [1, 3], [1, 4]]);
  assert.deepEqual([at(1, 3), at(6, 3)], [1, 1]);

  // The square pen keeps every cell: a corner drawn on purpose stays.
  ({ strokes, at } = setup(undefined, 'square'));
  draw(strokes, [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2]]);
  assert.deepEqual([at(0, 0), at(1, 0), at(1, 1), at(2, 1), at(2, 2)], [1, 1, 1, 1, 1]);
});

test('a card back into a picture: the same card again, smaller ones centred, others refused', async () => {
  const { fromCard } = await import('../../web/src/editor/from-card.js');
  const rgbOf = (c) => [c >> 16, (c >> 8) & 255, c & 255];
  const builtin = (id) => (id === 7 ? PAL.colors.map(rgbOf) : undefined);
  const by = { nick: 'a', handle: null, link: '' };
  const m = createModel(blank(16, PAL));
  const s = m.stroke(0, 0);
  s.set(0, 2);
  s.set(17, 3);
  s.commit('pen');
  m.setTitle?.('Гриб');
  for (const draw of [() => {}, () => { const t = m.stroke(0, 0); t.set(5, 0); t.commit('pen'); }]) {
    draw(); // the second time the first colour is drawn too: the card's colours go inline
    const card = /** @type {any} */ (toCard(m.doc, by)).card;
    const doc = fromCard(card, builtin);
    assert.ok(doc);
    assert.equal(doc.size, 16);
    const again = /** @type {any} */ (toCard(doc, by)).card;
    assert.deepEqual([...again.pixels], [...card.pixels], 'the same cells');
    assert.deepEqual(again.palette, card.palette, 'the same palette');
    assert.equal(again.opaque, card.opaque);
  }
  // A 40-cell card: in the middle of the 48 canvas.
  const small = { width: 40, height: 40, opaque: true, palette: { inline: [[0, 0, 0], [255, 255, 255]] }, frames: 1, delay_ms: 0, pixels: new Uint8Array(1600).fill(1), title: 'x', frame: 2 };
  const d = fromCard(small, builtin);
  assert.equal(d.size, 48);
  assert.equal(d.frames[0][0][0], T, 'the border is empty');
  assert.equal(d.frames[0][0][4 * 48 + 4], 1, 'the picture starts 4 cells in');
  assert.equal(d.shade, 2);
  // Not square: the whole of it, in the middle of the canvas that holds it.
  const wide = fromCard({ ...small, width: 10, height: 8, pixels: new Uint8Array(80).fill(1) }, builtin);
  assert.equal(wide.size, 16);
  assert.deepEqual([wide.frames[0][0][3 * 16 + 2], wide.frames[0][0][4 * 16 + 3], wide.frames[0][0][11 * 16 + 12]], [T, 1, 1], 'from (3, 4) to (12, 11)');
  assert.equal(wide.frames[0][0].filter((v) => v === 1).length, 80, 'every cell of it');
  // Larger than the largest canvas: crop first.
  assert.equal(fromCard({ ...small, width: 128, height: 128 }, builtin), null);
  assert.equal(fromCard({ ...small, width: 80, height: 8 }, builtin), null);
});

test('holds: a frame lasts several ticks, in the card as frames alike, and back as one', async () => {
  const { fromCard } = await import('../../web/src/editor/from-card.js');
  const builtin = (id) => (id === 7 ? PAL.colors.map((c) => [c >> 16, (c >> 8) & 255, c & 255]) : undefined);
  const by = { nick: 'a', handle: null, link: '' };
  const m = createModel(blank(4, PAL));
  const s = m.stroke(0, 0);
  s.set(0, 1);
  s.commit('pen');
  m.addFrame(0);
  const t = m.stroke(1, 0);
  t.set(1, 2);
  t.commit('pen');
  assert.ok(m.setHold(0, 3));
  m.setHold(0, 4); // a few taps on "longer": one step
  assert.deepEqual(m.doc.holds, [4, 1]);
  assert.equal(m.ticks(), 5);
  const card = /** @type {any} */ (toCard(m.doc, by)).card;
  assert.equal(card.frames, 5, 'the first frame four times, then the second');
  const n = 16;
  assert.deepEqual([0, 1, 2, 3, 4].map((k) => card.pixels[k * n + 1]), [0, 0, 0, 0, 2]);
  const back = fromCard(card, builtin);
  assert.deepEqual([back.frames.length, back.holds], [2, [4, 1]], 'frames alike in a row: one that lasts');
  // A copy lasts as long as its frame; the card's 64 frames, holds counted, are the limit.
  m.addFrame(0);
  assert.deepEqual(m.doc.holds, [4, 4, 1]);
  assert.equal(m.canHold(0, MAX_HOLD + 1), false);
  while (m.ticks() + m.doc.holds[0] <= MAX_FRAMES) m.addFrame(0);
  assert.ok(m.ticks() <= MAX_FRAMES);
  assert.equal(m.addFrame(0), false, 'no room for another four');
  m.undo();
  assert.equal(m.doc.frames.length, m.doc.holds.length);
  // Moving frames moves how long they last with them.
  const mm = createModel(blank(4, PAL));
  mm.addFrame(0);
  mm.setHold(1, 2);
  mm.moveFrame(1, 0);
  assert.deepEqual(mm.doc.holds, [2, 1]);
  mm.undo();
  assert.deepEqual(mm.doc.holds, [1, 2]);
  // One frame only: a still card, however long it was said to last.
  const still = createModel(blank(4, PAL));
  still.doc.holds[0] = 3;
  assert.equal(/** @type {any} */ (toCard(still.doc, by)).card.frames, 1);
});

test('layers: drawn on one at a time, shown and signed together, hidden ones left out', () => {
  const by = { nick: 'a', handle: null, link: '' };
  const m = createModel(blank(4, PAL));
  const s = m.stroke(0, 0);
  s.set(0, 1);
  s.set(1, 1);
  s.commit('pen');
  const l = m.addLayer(0);
  assert.equal(l, 1);
  assert.equal(m.doc.layers.length, 2);
  m.addFrame(0); // a copy of every layer
  assert.equal(m.doc.frames[1].length, 2);
  const t = m.stroke(0, 1);
  t.set(1, 2); // over the bottom layer's cell
  t.set(2, 2);
  t.commit('pen');
  assert.deepEqual([...composite(m.doc, 0)].slice(0, 4), [1, 2, 2, T], 'the top layer over the bottom one, empty cells see through');
  assert.equal(m.doc.frames[0][0][1], 1, 'the bottom layer kept its cell');
  let card = /** @type {any} */ (toCard(m.doc, by)).card;
  assert.deepEqual([...card.pixels].slice(0, 4), [1, 2, 2, 0]);
  m.setHidden(1, true);
  card = /** @type {any} */ (toCard(m.doc, by)).card;
  assert.deepEqual([...card.pixels].slice(0, 4), [1, 1, 0, 0], 'a hidden layer is not in the card');
  assert.equal(m.canMerge(1), false, 'nothing shown to merge');
  m.setHidden(1, false);
  // Order: the top one moved under, the bottom one shows through.
  m.moveLayer(1, 0);
  assert.deepEqual([...composite(m.doc, 0)].slice(0, 3), [1, 1, 2]);
  m.undo();
  // Merged down: one layer, the picture as it was shown.
  assert.ok(m.mergeDown(1));
  assert.equal(m.doc.layers.length, 1);
  assert.deepEqual([...m.doc.frames[0][0]].slice(0, 4), [1, 2, 2, T]);
  m.undo();
  assert.deepEqual([m.doc.layers.length, m.doc.frames[0][0][1], m.doc.frames[0][1][1]], [2, 1, 2], 'undone: both layers again');
  // A layer deleted and brought back, with its cells in every frame.
  m.removeLayer(1);
  assert.equal(m.doc.frames[0].length, 1);
  m.undo();
  assert.equal(m.doc.frames[0][1][2], 2);
  // Resize, palette and crop look at every layer.
  assert.ok(m.cropsAt(16) === false && m.uses(2));
  m.resize(8);
  assert.equal(m.doc.frames[0][1][2 * 8 + 2 + 2], 2);
  // Layers keep their names (numbers) when they move; a new one gets the next.
  m.addLayer(1);
  assert.deepEqual(m.doc.layers.map((x) => x.n), [1, 2, 3]);
});

test('a draft kept before layers is taken up with its history', () => {
  const old = {
    v: 1, frame: 0, color: 1,
    doc: { size: 2, frames: [[1, 255, 255, 255]], colors: PAL.colors, builtin: 7, title: '', shade: 0, delay: 160 },
    history: { tree: { e: null, l: '', f: -1, t: 0, x: 0, k: [{ e: { k: 'px', f: 0, i: [0], b: [255], a: [1] }, l: 'ed.h.pen', f: 0, t: 1, x: -1, k: [] }] }, at: [0] },
  };
  const d = upgradeDraft(old);
  assert.equal(d.v, 2);
  const m = createModel(blank(2, PAL));
  m.reset({ ...d.doc, frames: d.doc.frames.map((f) => f.map((c) => Uint8Array.from(c))) }, d.history);
  assert.equal(m.doc.frames[0][0][0], 1);
  m.undo();
  assert.equal(m.doc.frames[0][0][0], T, 'the old step undoes on the one layer');
  assert.equal(upgradeDraft(d), d, 'a draft as it is now is left as it is');
});

test('any mix of layer and frame changes keeps the picture whole, and undoes and redoes exactly', () => {
  // A fixed seed: the same steps on every run, so a failure can be replayed.
  let seed = 20261102;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const snap = (d) => JSON.stringify({ ...d, frames: d.frames.map((f) => f.map((c) => [...c])) });
  for (let run = 0; run < 120; run++) {
    const m = createModel(blank(8, PAL));
    const start = snap(m.doc);
    for (let k = 0; k < 40; k++) {
      const F = m.doc.frames.length, L = m.doc.layers.length, f = rnd(F), l = rnd(L);
      const op = rnd(12);
      if (op === 0) { const s = m.stroke(f, l); for (let i = 0; i < 3; i++) s.set(rnd(64), 1 + rnd(3)); s.commit('pen'); }
      else if (op === 1) m.addLayer(l);
      else if (op === 2) m.removeLayer(l);
      else if (op === 3) m.moveLayer(l, rnd(L));
      else if (op === 4) m.setHidden(l, !m.doc.layers[l].hidden);
      else if (op === 5) { if (m.canMerge(l)) m.mergeDown(l); }
      else if (op === 6) m.addFrame(f);
      else if (op === 7) m.removeFrame(f);
      else if (op === 8) m.moveFrame(f, rnd(F));
      else if (op === 9) { const n = 1 + rnd(MAX_HOLD); if (m.canHold(f, n)) m.setHold(f, n); }
      else if (op === 10) m.clearFrame(f, l);
      else m.resize([8, 16][rnd(2)]);
      const d = m.doc, where = `run ${run}, step ${k}, change ${op}`;
      assert.ok(d.layers.length >= 1 && d.layers.length <= 8 && d.frames.length >= 1, where);
      assert.ok(d.frames.every((fr) => fr.length === d.layers.length && fr.every((c) => c.length === d.size * d.size)), `every frame has a cel per layer: ${where}`);
      assert.ok(d.holds.length === d.frames.length && d.holds.every((h) => h >= 1 && h <= MAX_HOLD) && m.ticks() <= MAX_FRAMES, `holds: ${where}`);
    }
    const end = snap(m.doc);
    for (let i = 0; i < 100; i++) m.undo();
    assert.equal(snap(m.doc), start, `undone to the start: run ${run}`);
    for (let i = 0; i < 100; i++) m.redo();
    assert.equal(snap(m.doc), end, `redone to the end: run ${run}`);
  }
});

test('every tool with the mirror on: a picture symmetric on its axes, on the chosen layer alone, undone whole', async () => {
  const { createStrokes } = await import('../../web/src/editor/strokes.js');
  const N = 8;
  const symmetric = (/** @type {Uint8Array} */ c, /** @type {{x: boolean, y: boolean}} */ ax) => {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const v = c[y * N + x];
      if (ax.x && c[y * N + (N - 1 - x)] !== v) return false;
      if (ax.y && c[(N - 1 - y) * N + x] !== v) return false;
    }
    return true;
  };
  const kinds = [
    { tool: 'pen', pen: 'solid' }, { tool: 'pen', pen: 'square' }, { tool: 'pen', pen: 'dither' }, { tool: 'eraser' }, { tool: 'fill' },
    ...['line', 'rect', 'rect-fill', 'ellipse', 'ellipse-fill'].map((shape) => ({ tool: 'shapes', shape })),
  ];
  for (const axes of [{ x: true, y: false }, { x: false, y: true }, { x: true, y: true }]) {
    for (const k of kinds) {
      const m = createModel(blank(N, PAL));
      // Something on the bottom layer, not symmetric at all: it must stay as it is.
      const s0 = m.stroke(0, 0);
      for (const i of [0, 9, 10, 27]) s0.set(i, 2);
      s0.commit('pen');
      m.addLayer(0);
      // The top layer: full of one colour for the eraser to take from, a wall to fill up to for the fill.
      if (k.tool === 'eraser') { const s = m.stroke(0, 1); for (let i = 0; i < N * N; i++) s.set(i, 3); s.commit('fill'); }
      if (k.tool === 'fill') { const s = m.stroke(0, 1); for (let i = 0; i < N; i++) { s.set(i * N + 3, 1); s.set(i * N + 4, 1); } s.commit('pen'); }
      const bottom = [...m.doc.frames[0][0]], before = [...m.doc.frames[0][1]];
      const strokes = createStrokes({
        model: m, pick() {}, selection: /** @type {any} */ ({}),
        now: () => ({ frame: 0, layer: 1, color: 2, shape: /** @type {any} */ (k.shape ?? 'line'), pen: /** @type {any} */ (k.pen ?? 'solid'), mirror: true, axes }),
      });
      const name = `${k.tool}${k.pen ? `/${k.pen}` : ''}${k.shape ? `/${k.shape}` : ''} on ${axes.x ? 'x' : ''}${axes.y ? 'y' : ''}`;
      const hnd = strokes.start({ x: 1, y: 1 }, /** @type {any} */ (k.tool));
      if (hnd) { for (const c of [{ x: 2, y: 1 }, { x: 2, y: 2 }, { x: 1, y: 3 }]) hnd.move(c); hnd.end(); }
      assert.ok(symmetric(m.doc.frames[0][1], axes), `${name}: the layer drawn on is symmetric`);
      assert.notDeepEqual([...m.doc.frames[0][1]], before, `${name}: something was drawn`);
      assert.deepEqual([...m.doc.frames[0][0]], bottom, `${name}: the other layer is untouched`);
      m.undo();
      assert.deepEqual([...m.doc.frames[0][1]], before, `${name}: one undo takes it all back`);
    }
  }
});
