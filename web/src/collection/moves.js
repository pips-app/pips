// @ts-check
// Moving cards between places — the collection, the archive, the bin —
// and everything that goes with it: the flight onto the strip, the strip
// itself, the toast with one undo for a whole series, deleting for good.
//
// While cards fly, `busy.n` is above zero: the view takes no new touches
// and waits with redrawing the stage until they have landed.

import { h } from '../dom.js';
import { t } from '../i18n.js';
import { app, move, purge } from '../state.js';
import { artCanvas, FRAME_SHADES } from '../ui/card.js';
import { toast, ask } from '../ui/shell.js';
import { clamp, flight, REDUCED } from '../kit/motion.js';

/** @typedef {import('./query.js').Place} Place */
/** @typedef {import('./stage.js').Item} Item */

/** Each place's name. */
export const PLACE_TITLE = { collection: 'collection.title', archive: 'archive.title', trash: 'archive.trash' };
/** Where a card sent down goes from each place. */
export const DOWN = /** @type {const} */ ({ collection: 'archive', archive: 'collection', trash: 'collection' });
/** One undo covers moves made the same way while its toast is up. */
const SERIES_MS = 5000;

/**
 * @param {{
 *   stage: ReturnType<typeof import('./stage.js').createStage>,
 *   strip: ReturnType<typeof import('../kit/strip.js').strip>,
 *   host: HTMLElement, fly: HTMLElement, busy: {n: number},
 *   place: () => Place, sync: () => void,
 *   selection: ReturnType<typeof import('./selection.js').createSelection>,
 *   beforeFlight: () => void, pulling: () => boolean, stripMoved: (up: boolean) => void,
 * }} o stripMoved: the strip went up or down (the tab bar keeps out of its way)
 */
export function createMoves(o) {
  const { stage, strip } = o;
  /** Latest arrivals of each place, newest first, for the strip. */
  const recents = /** @type {Record<Place, string[]>} */ ({ collection: [], archive: [], trash: [] });
  /** @type {null | {from: Place, to: Place, ids: Set<string>, at: number}} */
  let series = null;
  // The strip is up while a card is pulled down, while cards fly to it and
  // a moment after they landed. Then it is due to go down: at once, or as
  // soon as nothing holds it — a finger pulling a card (its release decides
  // anew), or cards on their way somewhere (an undo, a delete). A due
  // descent is never dropped, only put off: once missed, nothing else would
  // take the strip down.
  let stripTimer = 0;
  let stripUp = false, stripDue = false;

  /** @param {number} f @param {boolean} [anim] */
  function showStrip(f, anim = false) {
    clearTimeout(stripTimer);
    stripDue = false; // whoever shows or hides it now decides what comes next
    strip.reveal(f, anim);
    if (stripUp !== f > 0) { stripUp = f > 0; o.stripMoved(stripUp); }
  }
  /** Takes the strip down if it is due and nothing holds it. */
  function settleStrip() {
    if (stripDue && !o.pulling() && !o.busy.n) showStrip(0, true);
  }
  /** Lets go of `busy` taken for a move: the screen catches up, and the strip may go. */
  function release() {
    o.busy.n--;
    if (stripUp) drawStrip(); // the cards it shows may have moved again
    o.sync();
    settleStrip();
  }

  /** @param {number} [room] @param {string} [landed] @param {Place} [target] */
  function drawStrip(room = 0, landed, target = DOWN[o.place()]) {
    const there = [...app.cards.values()].filter((e) => e.rec.state === target);
    if (!recents[target].length) recents[target] = there.sort((a, b) => b.rec.received - a.rec.received).slice(0, 8).map((e) => e.rec.digest);
    const ids = recents[target].filter((id) => app.cards.get(id)?.rec.state === target || id === landed);
    strip.draw(ids.map((id) => ({
      id,
      make: () => {
        const e = /** @type {import('../state.js').Entry} */ (app.cards.get(id));
        const m = h('div', { class: 'mini-paper' }, artCanvas(e.card, id));
        m.style.setProperty('--shade', (FRAME_SHADES[e.card.frame] ?? FRAME_SHADES[0]).paper);
        return m;
      },
    })), {
      room, landed, title: t(PLACE_TITLE[target]), count: there.length ? t('collection.count', there.length) : '',
      empty: t(target === 'archive' ? 'strip.archive.empty' : 'strip.collection.empty'),
    });
  }

  /**
   * Cards rise and fly into the strip one after another, each landing on
   * its first place while the others move along; the rest close up.
   * @param {Item[]} list @param {boolean} pulled
   */
  function send(list, pulled) {
    if (!list.length) return;
    o.busy.n++;
    const from = o.place(), to = DOWN[from], inFeed = stage.Z.v > 1.5;
    o.beforeFlight();
    drawStrip();
    showStrip(1, true);
    // With less motion asked for, the cards are simply there: no lift, no arc, no queue.
    const now = performance.now(), start = now + (pulled || REDUCED ? 0 : 160);
    const dur = REDUCED ? 1 : 620, gap = REDUCED ? 0 : list.length <= 6 ? 190 : Math.max(60, 1100 / list.length);
    list.forEach((c, k) => {
      const r0 = c.el.getBoundingClientRect(), t0 = start + k * gap;
      const path = flight({ x: r0.left, y: r0.top, w: r0.width }, () => strip.slot(0), { start: t0, dur });
      o.fly.append(c.el); // above the strip: the card lands on it, not under it
      if (inFeed) {
        // The neighbours close the gap while it flies, so nothing jumps at the end.
        c.collapse = { t0: t0 + 90, dur: 470 };
        const i = stage.list.indexOf(c);
        if (i === stage.list.length - 1 && i > 0) setTimeout(() => { stage.feed.to = i - 1; stage.kick(); }, 90);
      }
      c.flying = {
        at: (tt) => {
          const p = path.at(tt);
          // Picked from the grid, a card first lifts a little.
          const lift = pulled ? 0 : Math.sin(clamp((tt - now) / 160, 0, 1) * Math.PI / 2) * (1 - p.t);
          return { x: p.x, y: p.y - lift * 10, w: p.w * (1 + lift * 0.06), cap: inFeed ? Math.max(0, 1 - p.t * 2) : 0 };
        },
      };
      // Near the end the strip moves along to make room…
      setTimeout(() => drawStrip(1), t0 + dur * 0.7 - now);
      // …and on touching down the card becomes the first of the strip.
      setTimeout(() => {
        c.flying = null;
        c.collapse = null;
        c.fade.set(0);
        o.host.append(c.el);
        recents[to] = [c.id, ...recents[to].filter((x) => x !== c.id)].slice(0, 8);
        o.selection.forget(c.id);
        move(c.id, to);
        stage.reflow(stage.list.filter((x) => x !== c));
        drawStrip(0, c.id, to);
      }, t0 + dur - now);
    });
    // The pull belonged to the card that now flies (from where the finger
    // left it); kept on, it would move whichever card comes to the middle.
    stage.dragY.set(0);
    stage.kick();
    setTimeout(() => {
      o.busy.n--;
      o.selection.stop();
      o.sync();
      moved(list.map((c) => c.id), from, to);
      stripTimer = window.setTimeout(() => { stripDue = true; settleStrip(); }, 1300);
    }, start - now + (list.length - 1) * gap + dur + 40);
  }

  /**
   * Says what moved, with one undo for the whole series: cards sent the
   * same way one after another, while the toast is still up, come back
   * together. @param {string[]} ids @param {Place} from @param {Place} to
   */
  function moved(ids, from, to) {
    const now = performance.now();
    if (series && series.from === from && series.to === to && now - series.at < SERIES_MS) for (const id of ids) series.ids.add(id);
    else series = { from, to, ids: new Set(ids), at: now };
    series.at = now;
    const s = series;
    toast(t(`moved.${to}`, s.ids.size), {
      label: t('toast.undo'),
      run: async () => {
        if (series === s) series = null;
        await relocate([...s.ids], s.from);
        // In the feed, the card that came back is the one in the middle again.
        const back = stage.list.findIndex((c) => s.ids.has(c.id));
        if (back >= 0 && stage.Z.v > 1.5) { stage.feed.to = back; stage.kick(); }
      },
    });
  }

  /** Moves cards without a flight: they fade out here, or in. @param {string[]} ids @param {Place} to */
  async function relocate(ids, to) {
    o.busy.n++;
    // A failed write must not leave the screen waiting for a move that ended.
    try {
      for (const id of ids) await move(id, to);
    } finally {
      release();
    }
  }

  return {
    send, relocate, drawStrip, showStrip, settleStrip,
    /** Into the bin, from where they are. @param {string[]} ids */
    async toTrash(ids) {
      const from = o.place();
      await relocate(ids, 'trash');
      o.selection.stop();
      moved(ids, from, 'trash');
    },
    /** From the bin back to the collection. @param {string[]} ids */
    async restore(ids) {
      await relocate(ids, 'collection');
      o.selection.stop();
      moved(ids, 'trash', 'collection');
    },
    /** For good, after asking. @param {string[]} ids */
    async purgeAll(ids) {
      if (!(await ask(t('confirm.purge-n', ids.length), { yes: t('ask.delete'), danger: true }))) return;
      o.busy.n++;
      try {
        for (const id of ids) await purge(id);
      } finally {
        release();
      }
      o.selection.stop();
      toast(t('moved.purged', ids.length));
    },
  };
}
