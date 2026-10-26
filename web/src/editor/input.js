// @ts-check
// The fingers, the pen and the mouse on the canvas.
//
// Drawing must start the moment a finger lands — a pixel is often one tap —
// so, unlike the collection's arbiter (kit/gestures.js), a touch is a stroke
// from the start. Everything else is told apart afterwards:
//
//   a second finger   the stroke is taken back (it was the start of a pinch)
//                     and the fingers move and zoom the view;
//   a quick tap with  two fingers undoes, with three redoes;
//   a still press     (HOLD_MS) takes the stroke back and picks the colour
//                     under it;
//   a pen             while one is in use, touches of the palm are ignored.
//
// With a mouse: the left button draws, the right one (or Alt + left) picks,
// the middle one (or Space + left) moves the view; moving without a button
// shows where the next pixel would go.

const HOLD_MS = 450;
const STILL = 6; // px a finger may wander and still be still
const TAP_MS = 320;
const PEN_MS = 1000; // touches this soon after a pen are a palm

/** @typedef {{x: number, y: number}} Point */
/** @typedef {{move: (p: Point) => void, end: () => void, cancel: () => void}} Stroke */
/** @typedef {{start: (mid: Point, d: number) => void, move: (mid: Point, d: number) => void, end: () => void}} ViewGesture */

/**
 * @param {HTMLElement} el
 * @param {{
 *   draw: (p: Point, e: {button: number}) => Stroke|null,
 *   pick: (p: Point) => void,
 *   view: ViewGesture,
 *   taps: (fingers: number) => void,
 *   hover?: (p: Point|null) => void,
 *   panKey?: () => boolean,
 * }} o  points are in page coordinates
 */
export function drawInput(el, o) {
  /** @type {Map<number, {x: number, y: number, x0: number, y0: number}>} */
  const pts = new Map();
  /** @type {null | {kind: 'draw', id: number, s: Stroke|null, hold: number} | {kind: 'view', fingers: number, t0: number, moved: boolean, mid0: Point, d0: number} | {kind: 'done'}} */
  let g = null;
  let penAt = -Infinity;

  const mid = () => {
    const ps = [...pts.values()];
    return { x: ps.reduce((s, p) => s + p.x, 0) / ps.length, y: ps.reduce((s, p) => s + p.y, 0) / ps.length };
  };
  const spread = () => {
    const ps = [...pts.values()];
    return ps.length < 2 ? 0 : Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y);
  };
  const toView = () => {
    if (g?.kind === 'draw') {
      clearTimeout(g.hold);
      g.s?.cancel();
    }
    const m = mid();
    g = { kind: 'view', fingers: pts.size, t0: performance.now(), moved: false, mid0: m, d0: spread() };
    o.view.start(m, spread());
  };

  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'pen') penAt = performance.now();
    else if (e.pointerType === 'touch' && performance.now() - penAt < PEN_MS) return; // the palm
    try { el.setPointerCapture(e.pointerId); } catch { /* synthetic pointers */ }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY });
    const at = { x: e.clientX, y: e.clientY };

    if (e.pointerType === 'mouse') {
      if (g) return;
      if (e.button === 2 || (e.button === 0 && e.altKey)) { o.pick(at); g = { kind: 'done' }; return; }
      if (e.button === 1 || (e.button === 0 && o.panKey?.())) {
        g = { kind: 'view', fingers: 1, t0: performance.now(), moved: true, mid0: at, d0: 0 };
        o.view.start(at, 0);
        return;
      }
      if (e.button === 0) g = { kind: 'draw', id: e.pointerId, s: o.draw(at, { button: 0 }), hold: 0 };
      return;
    }
    if (pts.size === 1) {
      const s = o.draw(at, { button: 0 });
      const d = { kind: /** @type {const} */ ('draw'), id: e.pointerId, s, hold: 0 };
      d.hold = window.setTimeout(() => {
        if (g !== d) return;
        const p = pts.get(d.id);
        if (!p || Math.hypot(p.x - p.x0, p.y - p.y0) > STILL) return;
        d.s?.cancel();
        o.pick({ x: p.x, y: p.y });
        navigator.vibrate?.(10);
        g = { kind: 'done' };
      }, HOLD_MS);
      g = d;
    } else if (g?.kind === 'draw' || (g?.kind === 'view' && pts.size > g.fingers)) {
      // A second (or third) finger: it was never a stroke.
      const fingers = Math.max(pts.size, g.kind === 'view' ? g.fingers : 0);
      if (g.kind === 'view') o.view.end();
      toView();
      if (g?.kind === 'view') g.fingers = fingers;
    }
  });

  el.addEventListener('pointermove', (e) => {
    const p = pts.get(e.pointerId);
    if (!p) {
      if (e.pointerType === 'mouse' && !g) o.hover?.({ x: e.clientX, y: e.clientY });
      return;
    }
    p.x = e.clientX;
    p.y = e.clientY;
    if (g?.kind === 'draw' && e.pointerId === g.id) {
      if (Math.hypot(p.x - p.x0, p.y - p.y0) > STILL) clearTimeout(g.hold);
      for (const c of /** @type {PointerEvent[]} */ (e.getCoalescedEvents?.() ?? [e])) g.s?.move({ x: c.clientX, y: c.clientY });
    } else if (g?.kind === 'view') {
      const m = mid(), d = spread();
      if (Math.hypot(m.x - g.mid0.x, m.y - g.mid0.y) > STILL * 2 || Math.abs(d - g.d0) > STILL * 2) g.moved = true;
      o.view.move(m, d);
    }
  });

  const up = (/** @type {PointerEvent} */ e) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (g?.kind === 'draw' && e.pointerId === g.id) {
      clearTimeout(g.hold);
      if (e.type === 'pointercancel') g.s?.cancel();
      else g.s?.end();
      g = null;
    } else if (g?.kind === 'view') {
      if (pts.size) return; // the gesture ends with the last finger
      const v = g;
      g = null;
      o.view.end();
      if (!v.moved && v.fingers >= 2 && performance.now() - v.t0 < TAP_MS) o.taps(v.fingers);
    } else if (!pts.size) {
      g = null;
    }
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !pts.size) o.hover?.(null); });

  return {
    /** Whether something is under way: a stroke, a pinch. */
    get busy() { return !!g; },
  };
}
