// The editor's fingers, pen and mouse, driven by made-up pointer events.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window ??= globalThis;
const { drawInput } = await import('../../web/src/editor/input.js');

/** A canvas that records its listeners, and fingers to press on it. */
function surface() {
  const on = {};
  const el = { addEventListener: (type, f) => { on[type] = f; }, setPointerCapture() {} };
  const log = [];
  const input = drawInput(/** @type {any} */ (el), {
    draw: (p) => {
      log.push(['draw', p.x]);
      return { move: (q) => log.push(['move', q.x]), end: () => log.push(['end']), cancel: () => log.push(['cancel']) };
    },
    pick: (p) => log.push(['pick', p.x]),
    view: { start: () => log.push(['view']), move: () => {}, end: () => log.push(['view-end']) },
    taps: (n) => log.push(['taps', n]),
  });
  const ev = (type, id, x, y, kind = 'touch', extra = {}) => on[type]({ type, pointerId: id, pointerType: kind, clientX: x, clientY: y, button: 0, ...extra });
  return {
    input, log,
    down: (id, x, y, kind, extra) => ev('pointerdown', id, x, y, kind, extra),
    move: (id, x, y, kind) => ev('pointermove', id, x, y, kind),
    up: (id, x, y, kind) => ev('pointerup', id, x, y, kind),
  };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('a finger draws from the moment it lands', () => {
  const s = surface();
  s.down(1, 10, 10);
  s.move(1, 30, 10);
  s.up(1, 30, 10);
  assert.deepEqual(s.log, [['draw', 10], ['move', 30], ['end']]);
  assert.equal(s.input.busy, false);
});

test('a second finger takes the stroke back; a quick two-finger tap undoes', () => {
  const s = surface();
  s.down(1, 10, 10);
  s.down(2, 100, 10);
  s.up(2, 100, 10);
  s.up(1, 10, 10);
  assert.deepEqual(s.log, [['draw', 10], ['cancel'], ['view'], ['view-end'], ['taps', 2]]);
});

test('three fingers tapped together redo', () => {
  const s = surface();
  s.down(1, 10, 10);
  s.down(2, 100, 10);
  s.down(3, 50, 80);
  for (const id of [1, 2, 3]) s.up(id, 0, 0);
  assert.deepEqual(s.log.at(-1), ['taps', 3]);
});

test('a pinch that moves is no tap', () => {
  const s = surface();
  s.down(1, 10, 10);
  s.down(2, 100, 10);
  s.move(2, 200, 10);
  s.up(2, 200, 10);
  s.up(1, 10, 10);
  assert.ok(!s.log.some((e) => e[0] === 'taps'));
});

test('a still press picks the colour instead of drawing', async () => {
  const s = surface();
  s.down(1, 40, 40);
  await wait(500);
  s.up(1, 40, 40);
  assert.deepEqual(s.log, [['draw', 40], ['cancel'], ['pick', 40]]);
});

test('while a pen draws, the palm is ignored', () => {
  const s = surface();
  s.down(1, 10, 10, 'pen');
  s.down(2, 300, 300, 'touch');
  s.up(1, 10, 10, 'pen');
  assert.deepEqual(s.log, [['draw', 10], ['end']]);
});

test('the mouse: left draws, right picks, middle moves the view', () => {
  const s = surface();
  s.down(1, 10, 10, 'mouse', { button: 2 });
  s.up(1, 10, 10, 'mouse');
  s.down(1, 10, 10, 'mouse', { button: 1 });
  s.up(1, 10, 10, 'mouse');
  s.down(1, 20, 10, 'mouse');
  s.up(1, 20, 10, 'mouse');
  assert.deepEqual(s.log, [['pick', 10], ['view'], ['view-end'], ['draw', 20], ['end']]);
});
