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
import { clamp, flight } from '../kit/motion.js';

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
 *   beforeFlight: () => void, pulling: () => boolean,
 * }} o
 */
export function createMoves(o) {
  const { stage, strip } = o;
  /** Latest arrivals of each place, newest first, for the strip. */
  const recents = /** @type {Record<Place, string[]>} */ ({ collection: [], archive: [], trash: [] });
  /** @type {null | {from: Place, to: Place, ids: Set<string>, at: number}} */
  let series = null;
  // The strip is up while a card is pulled down, while cards fly to it and
  // a moment after they landed — unless another pull or flight took it on.
  let stripTimer = 0;

  /** @param {number} f @param {boolean} [anim] */
  function showStrip(f, anim = false) {
    clearTimeout(stripTimer);
    strip.reveal(f, anim);
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
    const now = performance.now(), start = now + (pulled ? 0 : 160);
    const dur = 620, gap = list.length <= 6 ? 190 : Math.max(60, 1100 / list.length);
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
    stage.kick();
    setTimeout(() => {
      stage.dragY.set(0);
      o.busy.n--;
      o.selection.stop();
      o.sync();
      moved(list.map((c) => c.id), from, to);
      stripTimer = window.setTimeout(() => { if (!o.pulling() && !o.busy.n) strip.reveal(0, true); }, 1300);
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
      run: () => { if (series === s) series = null; relocate([...s.ids], s.from); },
    });
  }

  /** Moves cards without a flight: they fade out here, or in. @param {string[]} ids @param {Place} to */
  async function relocate(ids, to) {
    o.busy.n++;
    for (const id of ids) await move(id, to);
    o.busy.n--;
    o.sync();
  }

  return {
    send, relocate, drawStrip, showStrip,
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
      for (const id of ids) await purge(id);
      o.busy.n--;
      o.selection.stop();
      o.sync();
      toast(t('moved.purged', ids.length));
    },
  };
}
