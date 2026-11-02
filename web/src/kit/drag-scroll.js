// @ts-check
// A row that scrolls sideways follows a mouse dragged across it, the way it
// follows a finger on a touch screen: the content stays under the pointer,
// and a throw carries on and slows down. Touch and pens keep the browser's
// own scrolling, the wheel and the keys still work as they did.
//
// A press that moves less than SLOP is a click, as before; one that moved
// further is a drag, and the click it would end in is not passed on — a
// frame or a card is not chosen by letting go of a drag over it.

import { loop, REDUCED } from './motion.js';

/** Further than a hand trembles on a click, short of any intended drag. */
const SLOP = 5;
/** The throw is how fast the last part of the drag went (as the feed, collection/stage.js). */
const WINDOW_MS = 100;
/** Held still this long before letting go: no throw. */
const STILL_MS = 50;
/** How quickly a throw slows down: the share of speed kept after one second. */
const FRICTION = 0.02;
/** Slower than this (px/s) is at rest. */
const REST = 20;

/** @param {HTMLElement} el an element that scrolls on x */
export function dragScroll(el) {
  /** @type {number | null} */
  let id = null;
  let x0 = 0, s0 = 0, moved = false, swallow = false, speed = 0;
  /** @type {[number, number][]} time, x */
  let trail = [];
  /** @type {(() => void) | null} */
  let stopGlide = null;

  const halt = () => { stopGlide?.(); stopGlide = null; };

  el.addEventListener('pointerdown', (e) => {
    swallow = false;
    halt();
    if (e.pointerType !== 'mouse' || e.button !== 0 || el.scrollWidth <= el.clientWidth) return;
    id = e.pointerId;
    x0 = e.clientX;
    s0 = el.scrollLeft;
    moved = false;
    trail = [[e.timeStamp, e.clientX]];
  });

  el.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    const dx = e.clientX - x0;
    if (!moved) {
      if (Math.abs(dx) < SLOP) return;
      moved = true;
      el.setPointerCapture(e.pointerId);
      el.classList.add('drag-scrolling');
    }
    el.scrollLeft = s0 - dx;
    trail.push([e.timeStamp, e.clientX]);
    while (trail.length > 2 && e.timeStamp - trail[0][0] > WINDOW_MS) trail.shift();
  });

  /** @param {PointerEvent} e */
  function end(e) {
    if (e.pointerId !== id) return;
    id = null;
    if (!moved) return;
    el.classList.remove('drag-scrolling');
    swallow = e.type === 'pointerup';
    const [t0, xa] = trail[0], [t1, xb] = trail[trail.length - 1];
    const still = e.timeStamp - t1 > STILL_MS;
    speed = still || t1 <= t0 ? 0 : -((xb - xa) / (t1 - t0)) * 1000;
    if (REDUCED || Math.abs(speed) < REST) return;
    stopGlide = loop.add((dt) => {
      const before = el.scrollLeft;
      el.scrollLeft = before + speed * dt;
      speed *= Math.pow(FRICTION, dt);
      // At an end, or slow enough: done, and off the loop.
      const going = Math.abs(speed) >= REST && el.scrollLeft !== before;
      if (!going) halt();
      return going;
    });
    loop.kick();
  }
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  // The click a drag ends in: not a press of what lies under it.
  el.addEventListener('click', (e) => {
    if (!swallow) return;
    swallow = false;
    e.stopPropagation();
    e.preventDefault();
  }, true);
  // Another way of scrolling takes over from a throw.
  el.addEventListener('wheel', halt, { passive: true });
}
