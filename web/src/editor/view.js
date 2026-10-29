// @ts-check
// The editor screen, put together from its parts:
//
//   model.js           the picture and every change to it (undoable)
//   history.js         the undo tree under the model
//   canvas.js          the drawing surface
//   input.js           fingers, pen and mouse on it
//   raster.js          where each tool puts pixels
//   strokes.js         what each tool does with a finger
//   selection.js       the selection's box, its moves and turns
//   tools.js           the tool bar
//   palette.js         the colours under the canvas
//   frames.js          the frames strip
//   precise.js         the pad of the precise mode
//   settings.js        size, frame colour, delay, grid, mirror
//   *-sheet.js         palettes, a colour, the history
//   to-card.js         the picture as a card, when signed
//   ../budget.js       what a card may be, and how long it takes to pass on
//
// This file puts them together, keeps them in step with the picture,
// keeps the draft, and signs.

import { h, icon, byteLimit, shake } from '../dom.js';
import { t, date } from '../i18n.js';
import { app, addOwn } from '../state.js';
import { getMeta, setMeta } from '../store.js';
import { go, hideTabs, toast, ask } from '../ui/shell.js';
import { FRAME_SHADES } from '../ui/card.js';
import { bottomSheet } from '../kit/bottom-sheet.js';
import { clamp } from '../kit/motion.js';
import { blank, createModel, T, SIZES } from './model.js';
import { pickPicture } from './picture.js';
import { inside } from './raster.js';
import { parseHex, hex, fromRgb } from './color.js';
import { createCanvas } from './canvas.js';
import { drawInput } from './input.js';
import { toolBar } from './tools.js';
import { createStrokes } from './strokes.js';
import { createSelection } from './selection.js';
import { paletteGrid } from './palette.js';
import { framesStrip } from './frames.js';
import { precisePad } from './precise.js';
import { settingsPanel } from './settings.js';
import { palettesSheet } from './palettes-sheet.js';
import { colorSheet } from './color-sheet.js';
import { historySheet } from './history-sheet.js';
import { toCard } from './to-card.js';
import { issuable } from '../budget.js';
import { caught } from '../diagnostics.js';

/** @typedef {import('./tools.js').Tool} Tool */
/** @typedef {import('./tools.js').Shape} Shape */
/** @typedef {import('./raster.js').Cell} Cell */

const DRAFT = 'draft';
const HOLD_MS = 450;
const WIDE = '(min-width: 980px)';

/** @type {{id: number, name: string, colors: number[]}[]|null} */
let ready = null;
/** The core's built-in palettes, colours as numbers. */
function readyPalettes() {
  ready ??= app.core.palettes().map((/** @type {any} */ p) => ({ id: p.id, name: p.name, colors: p.colors.map((/** @type {number[]} */ c) => fromRgb(c[0], c[1], c[2])) }));
  return /** @type {{id: number, name: string, colors: number[]}[]} */ (ready);
}
/** A new canvas starts with the first built-in palette. */
const defaultPalette = () => ({ colors: readyPalettes()[0].colors, id: readyPalettes()[0].id });

export function editorView() {
  const model = createModel(blank(32, defaultPalette()));
  const state = {
    frame: 0, color: 4, // the first built-in palette's ink
    tool: /** @type {Tool} */ ('pen'), shape: /** @type {Shape} */ ('line'), pen: /** @type {import('./tools.js').PenMode} */ ('solid'),
    mirror: false, axes: { x: true, y: false }, precise: false, onion: true, grid: true,
    playing: false, shown: 0,
  };
  /** @type {{x: number, y: number}} */
  let cursor = { x: 0, y: 0 };

  // ---------------------------------------------------------- the parts --
  const canvas = createCanvas();
  const title = byteLimit(/** @type {HTMLInputElement} */ (h('input', { class: 'ed-title', placeholder: t('ed.title.ph'), autocomplete: 'off', 'aria-label': t('ed.title') })), 32);
  const byline = h('i', {});
  const card = h('div', { class: 'frame ed-card' }, h('div', { class: 'face front' }, canvas.el, h('div', { class: 'cap' }, title, byline)));

  const close = h('button', { type: 'button', class: 'ib plain', 'aria-label': t('ed.close'), title: t('ed.close'), onclick: () => go('collection') }, icon('back'));
  const meter = h('button', { type: 'button', class: 'ed-meter', onclick: () => explainBudget() });
  const undoBtn = holdButton('undo', () => undo(), () => history.show());
  const redoBtn = holdButton('redo', () => redo(), () => history.show());
  const sign = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'pill key ed-sign', onclick: () => signCard() }, t('ed.sign')));
  const bar = h('header', { class: 'bar ed-bar' }, close, meter, undoBtn, redoBtn, sign);

  const frames = framesStrip({
    select: (f) => { stop(); openFrame(f); },
    add: () => { stop(); model.addFrame(state.frame); },
    play: () => (state.playing ? stop() : play()),
    menu: (f) => frameMenu(f),
    onion: () => { state.onion = !state.onion; paint(); },
  });
  const palette = paletteGrid({
    pick: (i) => { state.color = i; if (state.tool === 'eraser' || state.tool === 'pick') state.tool = 'pen'; paint(); },
    edit: (i) => colors.show(i, model.doc.colors[i]),
    add: () => colors.show(null, model.doc.colors[state.color] ?? 0x808080),
    open: () => palettes.show(),
    name: (d) => paletteName(d),
  });
  const tools = toolBar({
    tool: (tl) => { stop(); state.tool = tl; paint(); },
    shape: (s) => { state.shape = s; state.tool = 'shapes'; paint(); },
    pen: (m) => { state.pen = m; state.tool = 'pen'; paint(); },
    mirror: () => { state.mirror = !state.mirror; paint(); },
    precise: () => { state.precise = !state.precise; cursor = { x: model.doc.size / 2, y: model.doc.size / 2 }; paint(); },
    more: () => more.show(),
  });
  const pad = precisePad({
    move: (dx, dy) => {
      cursor = { x: clamp(cursor.x + dx, 0, model.doc.size - 0.01), y: clamp(cursor.y + dy, 0, model.doc.size - 0.01) };
      const c = cursorCell();
      canvas.reveal(c); // zoomed in, the view follows the cursor
      canvas.cursor(c);
      held?.move(c);
      coords.textContent = `x ${c.x} · y ${c.y}`;
    },
    // The big button does what the chosen tool does: a pixel, a fill, a
    // shape dragged from where it is pressed to where it is let go.
    press: (erase) => { stop(); held = strokes.start(cursorCell(), erase ? 'eraser' : state.tool); },
    release: () => { held?.end(); held = null; },
    pick: () => pickAt(cursorCell()),
  });
  const coords = h('span', { class: 'ed-coords' });
  /** @type {null | {move: (c: Cell) => void, end: () => void, cancel: () => void}} */
  let held = null;
  const settings = settingsPanel({
    size: (n) => resize(n),
    shade: (i) => model.setShade(i),
    delay: (ms) => model.setDelay(ms),
    grid: (on) => { state.grid = on; canvas.grid(on); },
    axes: (a) => { state.axes = a; state.mirror = true; paint(); },
    fresh: () => fresh(),
    picture: () => { more.close(); pickPicture((doc) => load(doc, t('ed.from-picture'))); },
  });
  const historyBtn = h('button', { type: 'button', class: 'btn', onclick: () => { more.close(); history.show(); } }, icon('history'), t('ed.history'));
  settings.el.append(historyBtn);

  const more = bottomSheet({ label: t('ed.more') });
  const palettes = palettesSheet({ palettes: () => readyPalettes(), model });
  const colors = colorSheet({ model, chosen: (i) => { state.color = i; paint(); } });
  const history = historySheet({ model });
  const frameSheet = bottomSheet({ label: t('ed.frame.menu') });

  const aside = h('aside', { class: 'ed-aside' });
  const wrap = h('div', { class: 'ed-card-wrap' }, card, coords);
  canvas.mount(wrap, card);
  // The frames' strip and the selection's actions share one place, one on
  // top of the other: it is as tall as the taller, whichever shows.
  const strip = h('div', { class: 'ed-place' }, frames.el);
  const main = h('div', { class: 'ed-main' }, wrap, strip);
  const el = h('section', { class: 'view ed-view' },
    bar, h('div', { class: 'ed-body' }, tools.el, main, h('div', { class: 'ed-lower' }, palette.el, pad.el), aside),
    ...more.els, ...palettes.els, ...colors.els, ...history.els, ...frameSheet.els);

  // Settings beside the canvas on a wide screen, behind "More" on a phone.
  const wide = typeof matchMedia === 'function' ? matchMedia(WIDE) : null;
  const placeSettings = () => (wide?.matches ? aside : more.body).append(settings.el);
  wide?.addEventListener('change', placeSettings);
  placeSettings();

  /** A button that does one thing on a tap and another when held. @param {'undo'|'redo'} ic @param {() => void} tap @param {() => void} long */
  function holdButton(ic, tap, long) {
    let timer = 0, fired = false;
    const b = h('button', { type: 'button', class: 'ib', onclick: () => { if (!fired) tap(); } }, icon(ic));
    b.addEventListener('pointerdown', () => { fired = false; timer = window.setTimeout(() => { fired = true; navigator.vibrate?.(10); long(); }, HOLD_MS); });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => clearTimeout(timer));
    // A long press is also a context menu on some phones: one of the two, never both.
    b.addEventListener('contextmenu', (e) => { e.preventDefault(); clearTimeout(timer); if (!fired) { fired = true; long(); } });
    return b;
  }

  // ------------------------------------------------------------ drawing --
  const cursorCell = () => ({ x: Math.floor(cursor.x), y: Math.floor(cursor.y) });
  const selection = createSelection({ model, frame: () => state.frame, changed: () => paintSelection() });
  const strokes = createStrokes({
    model, selection, pick: (c) => pickAt(c),
    now: () => ({ frame: state.frame, color: state.color, shape: state.shape, pen: state.pen, mirror: state.mirror, axes: state.axes }),
  });
  // The selection's actions take a place that is already there, so the
  // canvas never moves when a box appears: the frames' strip, or, in the
  // precise mode (no strip), the top of the pad, over its hint.
  const placeSelBar = () => {
    if (state.precise) pad.top.append(selection.bar);
    else strip.append(selection.bar);
  };
  placeSelBar();

  /** The pipette: an empty cell picks the eraser. @param {Cell} c */
  function pickAt(c) {
    if (!inside(c, model.doc.size)) return;
    const v = model.doc.frames[state.frame][c.y * model.doc.size + c.x];
    if (v === T) state.tool = 'eraser';
    else {
      state.color = v;
      if (state.tool === 'pick' || state.tool === 'eraser') state.tool = 'pen';
    }
    paint();
  }
  /** Another frame: the selection stays with the one it was on. @param {number} f */
  function openFrame(f) {
    selection.clear();
    state.frame = clamp(f, 0, model.doc.frames.length - 1);
    paint();
  }
  function paintSelection() {
    canvas.box(selection.box);
    el.classList.toggle('selecting', !!selection.box);
  }

  /** Where the mouse (or a finger) last was over the canvas, for the cursor. @type {{x: number, y: number}|null} */
  let pointer = null;
  /** The cursor of the next pixel follows the pointer, and stays right when the view moves under it. */
  const follow = () => { if (!state.precise) canvas.cursor(pointer && canvas.cellAt(pointer)); };
  const input = drawInput(wrap, {
    skip: '.ed-title',
    draw: (p) => {
      if (state.playing) { stop(); return null; }
      if (state.precise) {
        // The canvas itself places the cursor in the precise mode.
        const c = canvas.cellAt(p);
        cursor = { x: clamp(c.x + 0.5, 0, model.doc.size - 0.01), y: clamp(c.y + 0.5, 0, model.doc.size - 0.01) };
        canvas.cursor(cursorCell());
        return null;
      }
      const s = strokes.start(canvas.cellAt(p), state.tool);
      return s && { move: (q) => s.move(canvas.cellAt(q)), end: s.end, cancel: s.cancel };
    },
    pick: (p) => pickAt(canvas.cellAt(p)),
    view: canvas.view(),
    taps: (n) => (n === 2 ? undo() : redo()),
    point: (p) => { pointer = p; follow(); },
    panKey: () => spaceDown,
  });

  // A mouse wheel zooms around the pointer, a notch a step; a trackpad's
  // two-finger scroll moves the view, its pinch zooms.
  wrap.addEventListener('wheel', (e) => {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1, dy = e.deltaY * unit, dx = e.deltaX * unit;
    const at = { x: e.clientX, y: e.clientY };
    if (e.ctrlKey || e.metaKey) canvas.zoomBy(Math.exp(-dy * 0.01), at);
    else if (e.deltaMode !== 0 || Math.abs(dy) >= 50) canvas.zoomBy(dy < 0 ? 1.25 : 0.8, at);
    else canvas.panBy(dx, dy);
    pointer = at;
    follow();
  }, { passive: false });

  // ---------------------------------------------------------- undo, redo --
  /** Says what was undone or redone, and lights up the cells it changed
   * (the frame it was on is opened by the change itself). @param {any} n @param {string} what */
  function shown(n, what) {
    if (!n) return;
    stop();
    if (n.entry?.k === 'px') canvas.flash(n.entry.i);
    toast(t(what, t(n.label)));
  }
  const undo = () => { if (!input.busy) shown(model.undo(), 'ed.undone'); };
  const redo = () => { if (!input.busy) shown(model.redo(), 'ed.redone'); };

  // ----------------------------------------------------------- playback --
  let raf = 0, last = 0;
  function play() {
    if (model.doc.frames.length < 2) return;
    state.playing = true;
    state.shown = state.frame;
    last = performance.now();
    const tick = (/** @type {number} */ now) => {
      if (!state.playing) return;
      if (now - last >= model.doc.delay) {
        last = now;
        state.shown = (state.shown + 1) % model.doc.frames.length;
        canvas.paint(model.doc, state.shown, { onion: null, paper: paper() });
        frames.show(model.doc, state.shown);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    paint();
  }
  function stop() {
    if (!state.playing) return;
    state.playing = false;
    cancelAnimationFrame(raf);
    paint();
  }

  // ------------------------------------------------------------- frames --
  /** What can be done with the open frame. @param {number} f */
  function frameMenu(f) {
    const n = model.doc.frames.length;
    /** @param {any} ic @param {string} label @param {() => void} run @param {boolean} [off] */
    const item = (ic, label, run, off = false) => h('button', { type: 'button', class: 'btn ed-menu-item', disabled: off, onclick: () => { frameSheet.close(); run(); } }, icon(ic), label);
    frameSheet.retitle(t('ed.frame.open', f + 1, n));
    frameSheet.body.replaceChildren(
      item('copy', t('ed.frame.copy'), () => model.addFrame(f), n >= 64),
      item('back', t('ed.frame.left'), () => model.moveFrame(f, f - 1), f === 0),
      item('next', t('ed.frame.right'), () => model.moveFrame(f, f + 1), f === n - 1),
      item('eraser', t('ed.frame.clear'), () => model.clearFrame(f)),
      item('trash', t('ed.frame.remove'), () => model.removeFrame(f), n < 2));
    frameSheet.show();
  }

  // ------------------------------------------------------------- canvas --
  /** @param {number} n */
  async function resize(n) {
    if (n === model.doc.size) return;
    if (model.cropsAt(n) && !(await ask(t('ed.size.crop', n), { yes: t('ed.size.yes') }))) return settings.set(model.doc);
    model.resize(n);
  }
  function fresh() {
    more.close();
    load(blank(32, defaultPalette()), t('ed.fresh'));
  }
  /**
   * A new picture on the canvas — blank, from a file, from a card — as
   * one step: the one before is a tap away. @param {import('./model.js').Doc} doc @param {string} said
   */
  function load(doc, said) {
    stop();
    model.replace(doc);
    state.frame = 0;
    state.color = Math.min(4, model.doc.colors.length - 1);
    toast(said, { label: t('toast.undo'), run: () => undo() });
  }

  // ------------------------------------------------------------ the card --
  /** @param {import('./model.js').Doc} d */
  const paletteName = (d) => (d.builtin != null
    ? readyPalettes().find((p) => p.id === d.builtin)?.name ?? '—'
    : t('ed.pal.own-n', d.colors.length));
  const paper = () => parseHex(FRAME_SHADES[model.doc.shade]?.paper ?? '#f6f3eb') ?? 0xf6f3eb;
  const by = () => app.profile;

  let measure = 0;
  /** @type {ReturnType<typeof issuable>['cost']|null} */
  let cost = null;
  /** @type {ReturnType<typeof issuable>['refused']} */
  let refused = null;
  /** The size of the signed card, a moment after the last change. */
  function weigh() {
    clearTimeout(measure);
    measure = window.setTimeout(() => {
      const r = toCard(model.doc, by());
      const c = 'card' in r ? issuable(r.card, app.core.shareSize(r.card)) : null;
      cost = c?.cost ?? null;
      refused = c?.refused ?? null;
      paintMeter();
    }, 150);
  }
  function paintMeter() {
    meter.className = `ed-meter ${cost?.level ?? 'over'}`;
    meter.replaceChildren(icon('scan'), h('span', {}, !cost ? t('ed.budget.colors')
      : cost.level === 'over' ? t('ed.budget.over', cost.seconds)
        : t('ed.budget', cost.codes, cost.seconds)));
    meter.setAttribute('aria-label', `${t('ed.budget.label')}: ${meter.textContent}`);
    sign.disabled = !cost || !!refused;
  }
  function explainBudget() {
    if (!cost) return toast(t('ed.budget.colors.why'));
    toast(cost.level === 'one' ? t('ed.budget.one.why', cost.bytes)
      : cost.level === 'loop' ? t('ed.budget.loop.why', cost.bytes, cost.codes, cost.seconds)
        : t('ed.budget.over.why', cost.bytes));
  }

  async function signCard() {
    stop();
    // Nothing drawn, in any frame: nothing to sign — said, not done.
    if (model.doc.frames.every((f) => f.every((v) => v === T))) {
      shake(canvas.el);
      return toast(t('ed.empty'));
    }
    const r = toCard(model.doc, by());
    if (!('card' in r)) return toast(t('ed.budget.colors.why'));
    // A card keeps its name for good, with everyone it reaches: ask for one
    // where it is written, rather than sign it nameless.
    if (!r.card.title) {
      title.focus();
      shake(title);
      return toast(t('card.need-title'));
    }
    try {
      const added = await addOwn(app.identity.signCard(r.card));
      await setMeta(DRAFT, null);
      model.reset(blank(32, defaultPalette()));
      go('collection', { open: added.digest });
      toast(t('import.saved'));
    } catch (e) {
      caught(e, 'editor');
      toast(`${t('err.generic')}: ${/** @type {any} */ (e)?.message ?? e}`);
    }
  }

  // ------------------------------------------------------------ keeping --
  let saving = 0;
  /** The draft, with its whole history, a moment after each change. */
  function keep() {
    clearTimeout(saving);
    saving = window.setTimeout(() => {
      setMeta(DRAFT, { v: 1, doc: { ...model.doc }, history: model.history.save(), frame: state.frame, color: state.color }).catch(() => {});
    }, 600);
  }
  model.listen((c) => {
    // A stroke being drawn: only its frame's picture, cheaply, on every move.
    if (c.live) {
      if (c.frame === state.frame && !state.playing) canvas.paint(model.doc, state.frame, layers());
      frames.draw(model.doc, c.frame);
      return;
    }
    if (c.frame >= 0 && c.frame !== state.frame) state.frame = c.frame;
    paint(c.whole || c.frame < 0 ? 'all' : [c.frame]);
    keep();
  });

  // -------------------------------------------------------------- paint --
  /** What lies beneath the open frame: the one before it, faintly. */
  const layers = () => {
    const n = model.doc.frames.length;
    return { onion: state.onion && n > 1 ? (state.frame + n - 1) % n : null, paper: paper() };
  };
  /** Everything, from the picture and the state. @param {number[]|'all'} [dirty] frames whose pictures changed */
  function paint(dirty = []) {
    const d = model.doc;
    state.frame = clamp(state.frame, 0, d.frames.length - 1);
    state.color = clamp(state.color, 0, d.colors.length - 1);
    const s = FRAME_SHADES[d.shade] ?? FRAME_SHADES[0];
    card.style.setProperty('--shade', s.paper);
    card.style.setProperty('--shade-ink', s.ink);
    card.style.setProperty('--shade-dim', s.dim);
    if (!state.playing) canvas.paint(d, state.frame, layers());
    if (document.activeElement !== title) title.value = d.title;
    byline.textContent = `${app.profile.nick ? `@${app.profile.nick}` : '—'} · ${date(Date.now(), { day: '2-digit', month: '2-digit' })}`;
    frames.set(d, state.frame, { playing: state.playing, shown: state.playing ? state.shown : state.frame, onion: state.onion, delay: d.delay }, dirty);
    palette.set(d, state.color);
    tools.set({ tool: state.tool, shape: state.shape, pen: state.pen, mirror: state.mirror, precise: state.precise });
    if (state.tool !== 'select') selection.clear();
    settings.set(d);
    settings.setAxes(state.axes);
    const puts = state.tool === 'pen' || state.tool === 'fill' || state.tool === 'shapes';
    pad.mode(t(`ed.precise.${state.tool}`), puts ? hex(d.colors[state.color] ?? 0) : null);
    if (el.classList.contains('precise') !== state.precise) {
      el.classList.toggle('precise', state.precise);
      placeSelBar();
    }
    canvas.el.classList.toggle('playing', state.playing);
    if (state.precise) {
      cursor = { x: clamp(cursor.x, 0, d.size - 0.01), y: clamp(cursor.y, 0, d.size - 0.01) };
      const c = cursorCell();
      canvas.cursor(c);
      coords.textContent = `x ${c.x} · y ${c.y}`;
    } else coords.textContent = '';
    const u = model.history.undoStep, r = model.history.redoStep;
    undoBtn.toggleAttribute('disabled', !u);
    redoBtn.toggleAttribute('disabled', !r);
    undoBtn.title = `${u ? t('ed.undo.what', t(u.label)) : t('ed.undo')} · ${t('ed.hold-history')}`;
    redoBtn.title = `${r ? t('ed.redo.what', t(r.label)) : t('ed.redo')} · ${t('ed.hold-history')}`;
    undoBtn.setAttribute('aria-label', u ? t('ed.undo.what', t(u.label)) : t('ed.undo'));
    redoBtn.setAttribute('aria-label', r ? t('ed.redo.what', t(r.label)) : t('ed.redo'));
    history.refresh();
    weigh();
  }

  title.addEventListener('input', () => model.setTitle(title.value));

  // ----------------------------------------------------------- keyboard --
  let spaceDown = false;
  const TOOL_KEYS = /** @type {Record<string, Tool>} */ ({ b: 'pen', e: 'eraser', g: 'fill', u: 'shapes', s: 'select', i: 'pick' });
  const ARROWS = /** @type {Record<string, [number, number]>} */ ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] });
  document.addEventListener('keydown', (e) => {
    if (el.hidden || document.querySelector('.dialog') || [more, palettes, colors, history, frameSheet].some((s) => s.open)) return;
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
    // Enter and Space press a button reached with the keyboard (Tab); after
    // a click its focus is not shown, and Space still pans, Enter still plays.
    const pressed = e.target instanceof Element && e.target.matches(':focus-visible') && !!e.target.closest('button, a[href], select, summary');
    if (pressed && (e.key === 'Enter' || e.key === ' ')) return;
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); redo(); return; }
    if (mod && k === 'a' && !typing) { e.preventDefault(); state.tool = 'select'; paint(); selection.all(); return; }
    if (typing || mod || e.altKey) return;
    if (e.key === ' ') { spaceDown = true; e.preventDefault(); return; }
    if (selection.box && ARROWS[e.key]) selection.nudge(...ARROWS[e.key]);
    else if (selection.box && (e.key === 'Delete' || e.key === 'Backspace')) selection.erase();
    else if (selection.box && e.key === 'Escape') selection.clear();
    else if (TOOL_KEYS[k]) { stop(); state.tool = TOOL_KEYS[k]; paint(); }
    else if (k === 'd') { state.pen = state.pen === 'dither' ? 'solid' : 'dither'; state.tool = 'pen'; paint(); }
    else if (k === 'm') { state.mirror = !state.mirror; paint(); }
    else if (e.key === ',' || e.key === '[') openFrame(state.frame - 1);
    else if (e.key === '.' || e.key === ']') openFrame(state.frame + 1);
    else if (e.key === 'Enter') { if (state.playing) stop(); else play(); }
    else if (e.key === '+' || e.key === '=') canvas.zoomBy(1.25, centre());
    else if (e.key === '-') canvas.zoomBy(0.8, centre());
    else if (e.key === '0') canvas.fit();
    else if (/^[1-9]$/.test(e.key) && Number(e.key) <= model.doc.colors.length) { state.color = Number(e.key) - 1; paint(); }
    else if (e.key === 'Escape') { if (tools.closeKinds()) { /* the menu goes, the editor stays */ } else if (state.playing) stop(); else if (state.precise) { state.precise = false; paint(); } else go('collection'); }
    else return;
    e.preventDefault();
    follow(); // a zoom moves the canvas under a still mouse
  });
  document.addEventListener('keyup', (e) => { if (e.key === ' ') spaceDown = false; });
  const centre = () => {
    const r = canvas.el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  addEventListener('resize', () => canvas.relayout());

  let loaded = false; // the draft, if there is one, is taken up on the first show

  return {
    el,
    /** @param {{doc?: import('./model.js').Doc, said?: string}} [arg] a picture to start from */
    async show(arg) {
      hideTabs(true);
      if (!loaded) {
        loaded = true;
        const d = await getMeta(DRAFT).catch(() => null);
        if (d?.v === 1 && SIZES.includes(d.doc?.size)) {
          state.frame = d.frame ?? 0;
          state.color = d.color ?? 0;
          model.reset({ ...d.doc, frames: d.doc.frames.map((/** @type {any} */ f) => Uint8Array.from(f)) }, d.history);
        }
      }
      if (arg?.doc) load(arg.doc, arg.said ?? t('ed.from-card'));
      requestAnimationFrame(() => { canvas.relayout(); paint('all'); });
    },
    hide() {
      stop();
      hideTabs(false);
      for (const s of [more, palettes, colors, history, frameSheet]) if (s.open) s.close();
    },
  };
}
