# Pips — web app

A PWA in plain ES modules: no build step, no dependencies, no third-party
requests. Everything it loads comes from its own origin, which the
Content-Security-Policy in `index.html` enforces — the identity key lives in
this origin's IndexedDB, and that policy is what protects it.

## Run

```sh
scripts/build-wasm.sh       # the core, into web/pkg/
scripts/serve.sh            # http://localhost:8000 — opening index.html as a file does not work
```

Open http://localhost:8000. Without `web/pkg/`, on localhost only, the app
falls back to `src/stub-core.js`: same interface, **no real cryptography**, a
"DEV STUB" banner, and a separate database. Elsewhere it refuses to start
without the real core. Add `?dev` to the URL (or use the stub) to get the
"Add sample cards" button on the Me tab — on localhost only.

The published site is assembled by `scripts/build-site.sh` into `_site/`:
without `dev/` and the stub, and with the service worker's cache version and
file list filled in from what is actually published.

## Layout

```
index.html, manifest.webmanifest, sw.js   shell, install, offline cache
css/app.css                               tokens, base controls, the tab bar
css/kit/*.css                             one file per component of src/kit/
css/collection.css                        the collection screen
css/editor.css                            the editor
src/core.js                               loads the WASM core (or the dev stub)
src/qrscan.js                             QR reading: BarcodeDetector or pkg/pips_scan, on demand
src/store.js                              IndexedDB: meta + cards
src/state.js                              the one place that changes data
src/i18n.js                               ru / en strings, core errors in words
src/words.js                              the recovery words as typed: whole or four letters
src/budget.js                             what a card may be to be signed, drawn or imported
src/editions.js                           copy-number logs: joined, and the next number
src/journal.js, src/diagnostics.js        the error journal: what is kept, and wiring it to the page
src/version.js                            the version, written by scripts/build-site.sh
src/dom.js                                DOM without innerHTML, the icon set
src/kit/                                  the bricks: motion, gestures, buttons, fields, sheets
src/collection/                           the collection screen, built from the bricks
src/editor/                               the pixel editor: model, undo tree, tools, its parts
src/ui/                                   shell, card frame, qr, scan, the other tabs,
                                          import, edition, onboarding (with the words entry)
fonts/                                    Literata, IBM Plex Sans (OFL), self-hosted
```

## How the interface is built

Like the Rust crates, the interface is made of small parts that each do one
thing, with one way of fitting together:

- **A component is a function**: `make(options) → { el, …methods }`. It takes
  plain data and callbacks, returns its element and a few methods to change
  it (`update`, `set`, `show`), and never reaches into `state.js` or another
  screen. What a press *means* is the caller's business.
- **State changes in one place, as data.** The app's data changes only in
  `state.js`; a picture in the editor only through `editor/model.js`, where
  every change is a plain-data entry. That is what makes undo exact, lets a
  draft be kept with its whole history, and keeps views simple: they redraw
  from the state when told it changed.
- **Nothing done is lost.** Every change can be undone — strokes, frames, the
  palette, the size, even the title — and undo is a tree: a change made after
  an undo starts a branch beside the old one instead of erasing it.
- **Layers depend only downwards**:
  1. `css/app.css` tokens — colours, type, radii; `kit/motion.js` springs and
     easings. A component never invents its own value for these.
  2. `kit/motion.js`, `kit/gestures.js` — springs on one shared frame loop, and
     the touch arbiter: one owner per touch, everything else waits; a second
     finger anywhere makes a pinch. Plain logic, no app knowledge.
  3. Pure logic, tested under node in `tests/unit/`: `collection/layout.js`,
     `collection/query.js` (cards in, rectangles or lists out); in the editor
     `color.js`, `raster.js` (where tools put pixels), `history.js` (the undo
     tree), `model.js` (the picture and its changes), `to-card.js`,
     and the input arbiters; for both ways of making a card, `budget.js`
     (what a card may be to be signed, how long it takes to pass on).
  4. `kit/*` controls — icon button, segmented switch, chips, search field,
     top and bottom sheets, strip, action bar, identicon.
  5. Screen parts — `collection/stage.js` (the zoom axis), `turn.js` (the card
     that turns over), `back.js`, `share.js` (the share sheet), `moves.js`
     (sending cards between places, the strip, undo), `selection.js`,
     `first-run.js`; `editor/canvas.js`, `input.js` (a finger draws at once,
     so the editor has its own arbiter), `strokes.js` (what each tool does
     with a finger), `selection.js`, `tools.js`, `palette.js`,
     `frames.js`, `precise.js`, `settings.js` and the editor's sheets.
  6. Screens — `collection/view.js`, `editor/view.js` only put parts together
     and decide what gestures mean.
- **Every gesture has a button.** Pull up / down in the feed is the action bar's
  Share / Archive. With a mouse, − and + in the bar zoom, arrows at the
  feed's sides leaf through it, the wheel scrolls (ctrl+wheel zooms) and
  every move has a key. The browser tests use only buttons, clicks and keys.
- **Drawing reads no layout.** A frame only writes styles: sizes are
  measured when the layout changes, hits are found from the rectangles
  drawn last.
- **Extract on the second use**, not before: a part used once stays in its
  screen until another screen needs it.
- **Every number has a reason** written next to it: a constant is named, and
  says where it comes from (the format, a measurement, DECISIONS.md).
- **Fix causes, not symptoms.** A bug is understood before it is fixed, and
  the fix comes with a test that fails without it.

Received cards are stored as the payload bytes they arrived as; all text from
cards reaches the page as text nodes, never as markup; card links open only
after a confirmation that shows the host.
