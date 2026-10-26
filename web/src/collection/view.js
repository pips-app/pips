// @ts-check
// The collection screen, put together from its parts:
//
//   stage.js      cards on the zoom axis, and the gestures that move them
//   turn.js       the card that turns over at the last level
//   back.js       what is on its back
//   share.js      the share sheet and what it shows
//   moves.js      sending cards between places, the strip, undo
//   selection.js  choosing several cards
//   first-run.js  the empty collection
//   query.js      which cards, in what order
//   kit/*         bars, buttons, fields, sheets, the strip
//
// This file only decides what things mean: a pull up shares, a pull down
// sends the card to the archive (or back from it), and so on — and keeps
// the bars in step with where the person is.

import { h } from '../dom.js';
import { t } from '../i18n.js';
import { app, subscribe } from '../state.js';
import { getMeta, setMeta } from '../store.js';
import { frame, FRAME_SHADES } from '../ui/card.js';
import { go, hideTabs } from '../ui/shell.js';
import { loop, clamp } from '../kit/motion.js';
import { iconButton } from '../kit/icon-button.js';
import { segmented } from '../kit/segmented.js';
import { chips } from '../kit/chips.js';
import { searchField } from '../kit/search-field.js';
import { strip as makeStrip } from '../kit/strip.js';
import { actionBar } from '../kit/action-bar.js';
import { createStage } from './stage.js';
import { createTurn } from './turn.js';
import { cardBack } from './back.js';
import { createShareSheet } from './share.js';
import { createMoves, PLACE_TITLE } from './moves.js';
import { createSelection } from './selection.js';
import { firstRun } from './first-run.js';
import { select, tagCounts, toggleTag, words } from './query.js';
import { weekLabel, monthLabel } from './dates.js';

/** @typedef {import('./query.js').Place} Place */
/** @typedef {import('./stage.js').Item} Item */

/** The room the bar takes above the cards, and the tabs or the card's actions below. */
const TOP = 76, BOTTOM = 84;
/** A mouse here, rather than a finger: the buttons for what a pinch or a swipe does show. */
const MOUSE = typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches;

/** @param {{draw: () => void}} o what the first-run "draw" button does */
export function collectionView(o) {
  /** @type {import('./query.js').Filter} */
  const filter = { place: 'collection', owner: 'all', query: '', by: 'date' };
  /** Above zero while cards fly or the share sheet is open: no new touches. */
  const busy = { n: 0 };
  let editing = false, pulling = false;
  /** @type {Map<string, Item>} */
  const items = new Map();

  // ------------------------------------------------------------- the parts --
  const backBtn = iconButton({ icon: 'back', label: t('collection.back'), plain: true, onClick: () => back() });
  const archBtn = iconButton({ icon: 'archive', label: t('archive.title'), onClick: () => setPlace('archive') });
  const binBtn = iconButton({ icon: 'trash', label: t('archive.trash'), onClick: () => setPlace('trash') });
  const selBtn = h('button', { type: 'button', class: 'pill', onclick: () => (selection.active ? selection.stop() : selection.start()) });
  const title = h('h1');
  // The level's name doubles as a switch between weeks and months, so
  // the months are a tap away too, not only a pinch.
  const sub = /** @type {HTMLButtonElement} */ (h('button', {
    type: 'button', class: 'level-switch',
    onclick: () => { if (!selection.active && stage.level <= 1) stage.setLevel(stage.level === 0 ? 1 : 0); },
  }));
  const chip = h('button', { type: 'button', class: 'filter-chip', onclick: () => clearFilter() });
  // Closer and further, for a mouse: what spreading and pinching do.
  const zoomOut = iconButton({ icon: 'minus', label: t('zoom.out'), onClick: () => zoom(-1) });
  const zoomIn = iconButton({ icon: 'plus', label: t('zoom.in'), onClick: () => zoom(1) });
  const zoomBox = h('div', { class: 'zoom', hidden: !MOUSE }, zoomOut.el, zoomIn.el);
  const bar = h('header', { class: 'bar collection-bar' }, backBtn.el,
    h('div', { class: 'title' }, title, h('div', { class: 'sub' }, sub, chip)), zoomBox, archBtn.el, binBtn.el, selBtn);
  // Along the feed, for a mouse: what a swipe does.
  const prevBtn = iconButton({ icon: 'back', label: t('feed.prev'), onClick: () => { if (!busy.n) stage.step(-1); } });
  const nextBtn = iconButton({ icon: 'next', label: t('feed.next'), onClick: () => { if (!busy.n) stage.step(1); } });
  const feedNav = h('div', { class: 'feed-nav', hidden: true }, prevBtn.el, nextBtn.el);
  // These stand in for the fingers and have keys of their own, so a click
  // on them does not take the focus: Enter and Space keep their meaning.
  for (const b of [zoomOut, zoomIn, prevBtn, nextBtn]) {
    b.el.tabIndex = -1;
    b.el.addEventListener('mousedown', (e) => e.preventDefault());
  }

  const search = searchField({ placeholder: t('search.ph'), clearLabel: t('search.clear'), onInput: (v) => refilter(() => { filter.query = v; }) });
  const owner = segmented({
    label: t('owner.label'), value: filter.owner,
    options: [{ value: 'all', label: t('owner.all') }, { value: 'mine', label: t('owner.mine') }, { value: 'got', label: t('owner.got') }],
    onChange: (v) => refilter(() => { filter.owner = v; }),
  });
  const groupBtn = h('button', { type: 'button', class: 'group-btn', onclick: () => regroup() });
  const tagChips = chips({ label: t('tags.label'), onToggle: (tag) => setQuery(toggleTag(filter.query, tag)) });
  const none = h('p', { class: 'search-none' }, t('search.none'));
  const searchPanel = h('div', { class: 'search-panel' }, search.el, h('div', { class: 'search-opts' }, owner.el, groupBtn), tagChips.el, none);

  const host = h('div', { class: 'stage-host' });
  const fly = h('div', { class: 'fly-layer' });
  const placeEmpty = h('p', { class: 'place-empty' });
  const first = firstRun({ draw: o.draw, scan: () => go('receive') });
  const coach = h('div', { class: 'coach', hidden: true }, t(MOUSE ? 'collection.coach.desk' : 'collection.coach'));
  const strip = makeStrip();
  const sheet = createShareSheet({ busy, closed: () => sync() });
  const feedBar = actionBar({ label: t('collection.card'), compact: true });
  const selectBar = actionBar({ label: t('collection.select-title') });

  const el = h('section', { class: 'view collection-view' },
    host, placeEmpty, first.el, searchPanel, bar, fly, strip.el, feedNav, feedBar.el, selectBar.el, coach, ...sheet.els);

  // The safe-area insets in pixels, measured once per size.
  const probe = h('div', { class: 'safe-probe', 'aria-hidden': 'true' });
  let safe = { t: 0, b: 0 };
  const measure = () => {
    const cs = getComputedStyle(probe);
    safe = { t: parseFloat(cs.paddingTop) || 0, b: parseFloat(cs.paddingBottom) || 0 };
  };
  /** Read by the stage when it lays the cards out, never while drawing. @returns {import('./layout.js').Frame} */
  const frameOf = () => ({
    W: el.clientWidth || innerWidth, H: el.clientHeight || innerHeight,
    top: TOP + safe.t, bottom: BOTTOM + safe.b, lead: searchPanel.offsetHeight + 8,
  });
  el.append(probe);

  const stage = createStage({
    host, surface: el, frame: frameOf,
    by: () => filter.by,
    label: (level, g) => {
      const c = g.cards[0], n = g.cards.length;
      if (filter.by === 'author') return { title: c.author ? `@${c.author}` : '—', sub: level === 0 ? String(n) : t('collection.count', n) };
      return level === 0 ? { title: monthLabel(c.received), sub: String(n) } : { title: weekLabel(c.received), sub: t('collection.count', n) };
    },
    skip: '.bar, .search-panel, .action-bar, .top-sheet, .scrim, .strip, .first-run, .coach, .feed-nav',
    control: '.turn button, .turn textarea, .turn input',
    blocked: () => busy.n > 0,
    tap, hold, pull, turn: () => (stage.level === 3 ? turn.drag() : null),
    drawn, levelChanged,
  });
  const turn = createTurn({ host });
  const selection = createSelection({ el, cardEl: (id) => items.get(id)?.el, changed: () => paintChrome() });
  const moves = createMoves({
    stage, strip, host, fly, busy, selection,
    place: () => filter.place, sync,
    beforeFlight: () => { sheet.follow(0, true); sheet.drop(); },
    pulling: () => pulling,
  });

  // ------------------------------------------------------------- the cards --
  /** What the query functions need of an entry. @param {import('../state.js').Entry} e */
  const asItem = (e) => ({ e, state: e.rec.state, mine: e.rec.mine, received: e.rec.received, title: e.card.title ?? '', author: e.card.author ?? '', tags: e.rec.tags ?? [] });
  /** @param {import('../state.js').Entry} e */
  function itemFor(e) {
    let it = items.get(e.rec.digest);
    if (!it) {
      it = stage.item(e.rec.digest, frame(e), { received: e.rec.received, author: e.card.author ?? '' });
      items.set(e.rec.digest, it);
    }
    return it;
  }
  const entries = () => [...app.cards.values()];
  const inPlace = (/** @type {Place} */ p) => entries().filter((e) => e.rec.state === p);

  /** Brings the stage in line with the state. Waits while cards are flying. */
  function sync() {
    if (busy.n) return; // whoever holds `busy` syncs when done
    for (const id of items.keys()) if (!app.cards.has(id)) items.delete(id);
    const next = select(entries().map(asItem), filter).map((x) => itemFor(x.e));
    // First the panel, for the set about to show: its height (with or
    // without "nothing found") places the months.
    paintChrome(next.length);
    stage.reflow(next);
    turn.invalidate();
    paintChrome();
  }

  /** Changes the filter; the cards that stay glide, the others fade. @param {() => void} change */
  function refilter(change) {
    change();
    sync();
  }
  /** @param {string} q */
  function setQuery(q) {
    search.set(q);
    refilter(() => { filter.query = q; });
  }
  function clearFilter() {
    search.set('');
    owner.set('all');
    refilter(() => { filter.query = ''; filter.owner = 'all'; });
  }
  function regroup() {
    refilter(() => { filter.by = filter.by === 'date' ? 'author' : 'date'; });
    for (const s of stage.scroll) s.to = 0;
    stage.kick();
  }
  /** Opens the archive or the bin as a place of its own, or goes home. @param {Place} p */
  function setPlace(p) {
    if (busy.n || stage.busy || p === filter.place) return;
    selection.stop();
    if (stage.Z.to > 1) stage.setLevel(1);
    for (const s of stage.scroll) s.set(0);
    moves.showStrip(0);
    refilter(() => { filter.place = p; });
  }
  function back() {
    if (busy.n || stage.busy) return;
    if (stage.level >= 2) stage.setLevel(stage.level - 1);
    else setPlace('collection');
  }
  /** @param {1|-1} d */
  function zoom(d) {
    if (busy.n || stage.busy || selection.active || !stage.list.length) return;
    stage.zoom(d);
  }

  // --------------------------------------------------------------- gestures --
  /** @param {Item|null} c @param {number} level @param {{x: number, y: number}} at */
  function tap(c, level, at) {
    if (level <= 1) {
      if (!c) return;
      if (selection.active) return selection.toggle(c.id);
      stage.align(c);
      stage.setLevel(2);
    } else if (level === 2) {
      if (!c) return;
      const i = stage.list.indexOf(c);
      if (i === Math.round(stage.feed.v)) stage.setLevel(3);
      else { stage.feed.to = i; stage.kick(); }
    } else {
      // Pressed on its right half, the card turns with its right edge going
      // away; on its left half, the other way round — like a real one.
      const r = c?.rr;
      turn.flipOver(undefined, r && at.x < r.x + r.w / 2 ? -1 : 1);
    }
  }
  /** @param {Item} c */
  function hold(c) {
    selection.start();
    selection.toggle(c.id);
    navigator.vibrate?.(10);
    return true;
  }
  /** The feed card pulled up or down. @param {Item} c @returns {import('../kit/gestures.js').DragHandler} */
  function pull(c) {
    const H = el.clientHeight, canShare = filter.place !== 'trash';
    let stripDrawn = false;
    return {
      move(p) {
        pulling = true;
        const dy = p.dy;
        stage.dragY.set(dy < 0 ? (canShare ? dy * 0.6 : dy * 0.25) : dy);
        if (dy < 0 && canShare) {
          sheet.prepare(c.id);
          // The code waits until the card is lifted well up, then follows the finger.
          sheet.follow(clamp((-dy - 90) / (H * 0.2), 0, 1));
          moves.showStrip(0);
        } else {
          if (!stripDrawn) { moves.drawStrip(); stripDrawn = true; }
          moves.showStrip(clamp(dy / (H * 0.26), 0, 1));
          sheet.follow(0);
        }
        stage.kick();
      },
      end(_p, v) {
        pulling = false;
        const d = stage.dragY.v;
        if (canShare && (d < -150 || (v.y < -900 && d < -70))) { stage.dragY.to = 0; share(c); }
        else if (d > H * 0.2 || v.y > 900) moves.send([c], true);
        else {
          stage.dragY.to = 0;
          if (!sheet.open) { sheet.follow(0, true); sheet.drop(); }
          moves.showStrip(0, true);
        }
        stage.kick();
      },
    };
  }
  /** @param {Item} c */
  function share(c) {
    sheet.show(c.id);
    paintChrome();
  }

  // ----------------------------------------------------------------- chrome --
  let tabsAway = false, drawnLevel = -1;
  /** Things that follow the zoom every frame: cheap writes only. @param {number} z */
  function drawn(z) {
    const c = stage.current();
    // A finger on the back's pencil is a touch too: only a pinch or a
    // flight makes the back stop taking presses.
    turn.draw(z, c, build, !stage.pinching && !busy.n);
    const sv = Math.max(0, 1 - z * 2.2);
    searchPanel.style.opacity = String(sv);
    searchPanel.style.visibility = sv < 0.02 ? 'hidden' : '';
    searchPanel.style.pointerEvents = sv > 0.6 ? '' : 'none';
    searchPanel.style.transform = `translate3d(0,${stage.frame.top - stage.scroll[0].v}px,0)`;
    const inFeed = z > 1.6 && !busy.n && !stage.dragY.v && !!c;
    feedBar.show(inFeed);
    if (MOUSE) {
      const i = Math.round(stage.feed.to), n = stage.list.length;
      if (feedNav.hidden === inFeed) feedNav.hidden = !inFeed;
      if (prevBtn.el.disabled !== i <= 0) prevBtn.el.disabled = i <= 0;
      if (nextBtn.el.disabled !== i >= n - 1) nextBtn.el.disabled = i >= n - 1;
    }
    const away = z > 1.4 || selection.active || filter.place !== 'collection';
    if (away !== tabsAway) { tabsAway = away; if (!el.hidden) hideTabs(away); }
    const lv = Math.round(z);
    if (lv !== drawnLevel) { drawnLevel = lv; paintChrome(); }
  }

  /** @param {number} level */
  function levelChanged(level) {
    if (level >= 2) selection.stop();
    if (level < 3 && editing) setEditing(false);
    if (coachShown) { coachShown = false; coach.hidden = true; setMeta('coached', true); }
    paintChrome();
  }

  /** The bar, the panels and the actions, for the current state.
   * @param {number} [count] how many cards show (default: the stage's) */
  function paintChrome(count = stage.list.length) {
    const lv = Math.round(stage.Z.to), filtered = !!(filter.query || filter.owner !== 'all'), selecting = selection.active;
    const firstRun = filter.place === 'collection' && !inPlace('collection').length;
    title.textContent = selecting ? t('collection.select-title') : t(PLACE_TITLE[filter.place]);
    const levelName = lv >= 3 ? 'collection.card' : lv === 2 ? 'collection.feed' : filter.by === 'author' ? 'collection.by-authors' : lv === 0 ? 'collection.by-months' : 'collection.by-weeks';
    sub.textContent = selecting ? t('collection.selected', selection.size)
      : lv <= 1 ? `${t(levelName)} · ${filter.place === 'trash' ? t('collection.bin-note') : t('collection.count', stage.list.length)}` : t(levelName);
    sub.disabled = selecting || lv > 1;
    // The filter chip belongs to the levels it filters, not to one card.
    const showChip = filtered && lv >= 1 && lv <= 2 && !selecting && !firstRun;
    chip.hidden = !showChip;
    sub.hidden = showChip;
    chip.textContent = `${[filter.owner === 'all' ? '' : t(`owner.chip.${filter.owner}`), filter.query].filter(Boolean).join(' · ')}  ×`;
    backBtn.el.hidden = (lv < 2 && filter.place === 'collection') || selecting;
    archBtn.el.hidden = binBtn.el.hidden = selecting || filter.place !== 'collection';
    archBtn.count(inPlace('archive').length);
    binBtn.count(inPlace('trash').length);
    selBtn.hidden = (lv >= 2 && !selecting) || !stage.list.length;
    zoomBox.hidden = !MOUSE || selecting || firstRun || !stage.list.length;
    zoomOut.el.disabled = lv <= 0;
    zoomIn.el.disabled = lv >= 3;
    selBtn.textContent = t(selecting ? 'collection.done' : 'collection.select');
    groupBtn.textContent = t(filter.by === 'author' ? 'group.author' : 'group.date');
    tagChips.update(tagCounts(inPlace(filter.place).map(asItem)).map(([tag, n]) => ({ value: tag, text: `#${tag}`, count: n, on: words(filter.query).includes(`#${tag}`) })));
    none.hidden = !filtered || count > 0;
    first.el.hidden = !firstRun;
    if (firstRun) coach.hidden = true; else if (coachShown) coach.hidden = false;
    searchPanel.hidden = firstRun;
    placeEmpty.hidden = filter.place === 'collection' || inPlace(filter.place).length > 0;
    placeEmpty.textContent = t(filter.place === 'archive' ? 'place.archive.empty' : 'place.trash.empty');
    if (firstRun) first.paint();
    paintActions();
  }

  /** What can be done with the chosen cards, and with the card in front. */
  function paintActions() {
    const chosen = () => stage.list.filter((c) => selection.has(c.id));
    const ids = () => chosen().map((c) => c.id);
    selectBar.set(filter.place === 'collection'
      ? [{ id: 'trash', label: t('act.to-trash'), run: () => moves.toTrash(ids()) }, { id: 'archive', label: t('act.archive'), kind: 'key', run: () => moves.send(chosen(), false) }]
      : filter.place === 'archive'
        ? [{ id: 'trash', label: t('act.to-trash'), run: () => moves.toTrash(ids()) }, { id: 'collection', label: t('act.to-collection'), kind: 'key', run: () => moves.send(chosen(), false) }]
        : [{ id: 'purge', label: t('act.purge'), kind: 'warn', run: () => moves.purgeAll(ids()) }, { id: 'restore', label: t('act.restore'), kind: 'key', run: () => moves.restore(ids()) }]);
    selectBar.show(selection.active);

    const one = (/** @type {(c: Item) => void} */ f) => () => { const c = stage.current(); if (c && !busy.n) f(c); };
    const turnOver = one(() => { stage.setLevel(3); turn.flipOver(); });
    feedBar.set(filter.place === 'trash'
      ? [{ id: 'turn', label: t('act.turn'), icon: 'turn', run: turnOver },
        { id: 'restore', label: t('act.restore'), icon: 'restore', run: one((c) => moves.send([c], true)) },
        { id: 'purge', label: t('act.purge'), icon: 'trash', run: one((c) => moves.purgeAll([c.id])) }]
      : [{ id: 'share', label: t('act.share'), icon: 'share', run: one(share) },
        { id: 'turn', label: t('act.turn'), icon: 'turn', run: turnOver },
        ...(filter.place === 'archive' ? [{ id: 'trash', label: t('act.to-trash'), icon: /** @type {const} */ ('trash'), run: one((c) => moves.toTrash([c.id])) }] : []),
        { id: 'down', label: t(filter.place === 'archive' ? 'act.to-collection' : 'act.archive'), icon: filter.place === 'archive' ? 'restore' : 'archive', run: one((c) => moves.send([c], true)) }]);
  }

  // -------------------------------------------------------------- the twin --
  /** @type {null | ReturnType<typeof cardBack>} */
  let shownBack = null;
  /** @param {string} id */
  function build(id) {
    const e = /** @type {import('../state.js').Entry} */ (app.cards.get(id));
    shownBack?.stop();
    shownBack = cardBack(e, {
      editing, onEdit: setEditing,
      onTag: (tag) => { setQuery(`#${tag}`); stage.setLevel(0); },
      onAuthor: (nick) => { setQuery(nick); stage.setLevel(0); },
    });
    const back = shownBack.el;
    const s = FRAME_SHADES[e.card.frame] ?? FRAME_SHADES[0];
    back.style.setProperty('--shade', s.paper);
    back.style.setProperty('--shade-ink', s.ink);
    back.style.setProperty('--shade-dim', s.dim);
    return { front: frame(e), back };
  }
  /** @param {boolean} on */
  function setEditing(on) {
    if (editing === on) return;
    editing = on;
    shownBack?.setEditing(on);
    loop.kick();
  }

  // ----------------------------------------------------- keyboard, mouse --
  // Every gesture has a key too: Esc goes back, + and − zoom, the arrows
  // and Page keys move through the grid or along the feed, Space turns.
  document.addEventListener('keydown', (e) => {
    const tg = e.target;
    if (el.hidden || tg instanceof HTMLInputElement || tg instanceof HTMLTextAreaElement) return;
    // Enter and Space press the screen's own buttons; one elsewhere (the
    // tab that brought the person here) leaves them to the collection.
    if (tg instanceof HTMLButtonElement && el.contains(tg) && (e.key === 'Enter' || e.key === ' ')) return;
    if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector('.overlay, .dialog')) return;
    const lv = stage.level, page = stage.frame.H * 0.8;
    /** @type {Record<string, () => void>} */
    const keys = lv <= 1
      ? { ArrowUp: () => stage.scrollBy(-120), ArrowDown: () => stage.scrollBy(120), PageUp: () => stage.scrollBy(-page), PageDown: () => stage.scrollBy(page),
        Home: () => stage.scrollBy(-Infinity), End: () => stage.scrollBy(Infinity), Enter: () => zoom(1) }
      : { ArrowLeft: () => stage.step(-1), ArrowRight: () => stage.step(1), Home: () => stage.step(-Infinity), End: () => stage.step(Infinity),
        ...(lv === 2 ? { Enter: () => zoom(1) } : { ' ': () => turn.flipOver() }) };
    keys['+'] = keys['='] = () => zoom(1);
    keys['-'] = () => zoom(-1);
    keys.Escape = () => {
      if (sheet.open) return;
      if (editing) setEditing(false);
      else if (selection.active) selection.stop();
      else back();
    };
    const run = keys[e.key];
    if (!run || busy.n) return;
    e.preventDefault();
    run();
  });
  // The mouse's own back button goes back here, not away from the app.
  el.addEventListener('mouseup', (e) => { if (e.button === 3) { e.preventDefault(); back(); } });
  el.addEventListener('mousedown', (e) => { if (e.button === 3) e.preventDefault(); });
  addEventListener('resize', () => { measure(); stage.relayout(); });

  let coachShown = false;
  getMeta('coached').then((done) => { if (!done) { coachShown = true; coach.hidden = false; } });

  subscribe(() => { if (!el.hidden) sync(); });
  return {
    el,
    /** @param {{open?: string}} [arg] opens one card large: a card just received or made */
    show(arg) {
      measure();
      hideTabs(tabsAway);
      if (arg?.open) {
        const e = app.cards.get(arg.open);
        if (e) {
          filter.place = e.rec.state;
          if (!select([asItem(e)], filter).length) { filter.query = ''; filter.owner = 'all'; search.set(''); owner.set('all'); }
        }
      }
      sync();
      stage.relayout();
      const it = arg?.open ? items.get(arg.open) : null;
      if (it) {
        stage.feed.set(Math.max(0, stage.list.indexOf(it)));
        turn.reset();
        stage.Z.set(3);
        stage.kick();
      }
    },
    hide() { hideTabs(false); sheet.close(); },
  };
}
