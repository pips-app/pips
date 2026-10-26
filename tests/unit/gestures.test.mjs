// The touch arbiter, driven by made-up pointer events: no browser needed.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window ??= globalThis;
globalThis.document ??= /** @type {any} */ ({ activeElement: null });
const { gestures } = await import('../../web/src/kit/gestures.js');

/** A surface that records its listeners, and fingers to press on it. */
function surface(o) {
  const on = {};
  const el = { addEventListener: (type, f) => { on[type] = f; }, setPointerCapture() {} };
  const log = [];
  const g = gestures(/** @type {any} */ (el), {
    control: '.control',
    tap: (p) => log.push(['tap', p.x, p.y]),
    hold: () => { log.push(['hold']); },
    drag: (p) => {
      log.push(['drag', p.dx, p.dy]);
      return { move: (q) => log.push(['move', q.dx, q.dy]), end: (_q, v) => log.push(['end', Math.sign(v.x), Math.sign(v.y)]) };
    },
    pinch: { start: (i) => log.push(['pinch', Math.round(i.d0)]), move: (i) => log.push(['zoom', Math.round(i.d)]), end: () => log.push(['pinch-end']) },
    ...o,
  });
  const target = (cls) => ({ closest: (sel) => (cls && sel.split(',').map((s) => s.trim()).includes(`.${cls}`) ? {} : null) });
  const ev = (type, id, x, y, cls) => on[type]({ type, pointerId: id, clientX: x, clientY: y, target: target(cls) });
  return { g, log, down: (id, x, y, cls) => ev('pointerdown', id, x, y, cls), move: (id, x, y) => ev('pointermove', id, x, y), up: (id, x, y) => ev('pointerup', id, x, y) };
}

test('a press without moving is a tap', () => {
  const s = surface();
  s.down(1, 10, 10);
  s.move(1, 13, 12); // within the slop
  s.up(1, 13, 12);
  assert.deepEqual(s.log, [['tap', 13, 12]]);
  assert.equal(s.g.busy, false);
});

test('a drag owns the touch, and its end carries the finger\'s speed', () => {
  const s = surface();
  s.down(1, 100, 100);
  for (let x = 90; x >= 40; x -= 10) s.move(1, x, 100);
  s.up(1, 40, 100);
  assert.deepEqual(s.log[0], ['drag', -10, 0]);
  assert.ok(s.log.some((e) => e[0] === 'move' && e[1] === -60));
  // The speed must still be known at the end (it once was read too late, as zero).
  assert.deepEqual(s.log.at(-1), ['end', -1, 0]);
});

test('a second finger turns any touch into a pinch; the first one lets go', () => {
  const s = surface();
  s.down(1, 100, 100);
  s.move(1, 120, 100);
  s.down(2, 300, 100);
  s.move(2, 340, 100);
  s.up(2, 340, 100);
  s.up(1, 120, 100);
  const kinds = s.log.map((e) => e[0]);
  assert.deepEqual(kinds, ['drag', 'move', 'end', 'pinch', 'zoom', 'pinch-end']);
  assert.equal(s.log[3][1], 180);
  assert.equal(s.log[4][1], 220);
  assert.equal(s.g.busy, false);
});

test('a finger on a control is the control\'s; a second finger still pinches', () => {
  const s = surface();
  s.down(1, 50, 50, 'control');
  s.move(1, 90, 50);
  s.up(1, 90, 50);
  assert.deepEqual(s.log, [], 'no drag and no tap for the surface');
  s.down(1, 50, 50, 'control');
  s.down(2, 150, 50);
  assert.deepEqual(s.log, [['pinch', 100]]);
});

test('only the finger that owns a drag moves it', () => {
  const s = surface({ pinch: undefined });
  s.down(1, 0, 0);
  s.move(1, 20, 0);
  s.down(2, 500, 500); // no pinch here: this finger is ignored
  s.move(2, 600, 600);
  s.move(1, 30, 0);
  s.up(2, 600, 600);
  s.up(1, 30, 0);
  assert.deepEqual(s.log.filter((e) => e[0] === 'move').map((e) => e[1]), [20, 30]);
});

test('while blocked, new touches are ignored', () => {
  const s = surface({ blocked: () => true });
  s.down(1, 10, 10);
  s.up(1, 10, 10);
  assert.deepEqual(s.log, []);
});

test('a still finger becomes a hold, and then no tap follows', async () => {
  const s = surface();
  s.down(1, 10, 10);
  await new Promise((r) => setTimeout(r, 480));
  s.up(1, 10, 10);
  assert.deepEqual(s.log, [['hold']]);
});
