# web-next — the new app

The web app written again, beside the one in `web/`, layer by layer
(`docs/REWRITE.md`: the plan, the stages, where we are). Not published yet:
the site is packed from `web/` alone. The rules of `web/README.md` and
`AGENTS.md` hold here too; what is new is below.

## What is here

| File | What it does |
| --- | --- |
| `index.html` | The page. Its CSP allows nothing that is not named, each thing with its reason. |
| `src/main.js` | The start: language, the core's client, the frame of a screen. |
| `src/trust.js` | The one Trusted Types policy: script URLs of the app's own workers, nothing else. |
| `src/core/worker.js` | The core's worker: the WebAssembly runs here, never on the page. |
| `src/core/serve.js` | The worker's side: one message a job, one answer each; a panic ends the worker. |
| `src/core/ops.js` | The jobs the worker does, by name: the core's functions the app may call. |
| `src/core/keys.js` | The person's key, in the worker: made, checked, kept hidden from the page (WebCrypto), restored, signing. |
| `src/core/client.js` | The page's side: jobs one at a time, each with a limit; a stopped worker is replaced. |
| `src/core/limits.js` | The limits, each from a measurement (`tests/next/measure.mjs`). |
| `src/state.js` | The app's state: asks the core what a card is, the rules what follows, and stores it; views read it and listen. |
| `src/store.js` | Storage (IndexedDB `pips-next`): cards and settings; a connection closed or taken over by the browser handled (from `web/`). |
| `src/schema.js` | The database's layout, step by step; a released step is never edited. |
| `src/rules/cards.js` | What happens to a card — arriving, moved, binned, noted, tagged — as plain functions over records. |
| `src/rules/editions.js` | Numbered copies: the log joined, the next number, the run. |
| `src/rules/names.js` | A name seen with another key, said (from `web/`). |
| `src/rules/pending.js` | What changed since the last backup. |
| `src/rules/backup.js` | A backup restored onto the device: nothing kept is lost or overwritten. |
| `src/errors.js` | One model of errors: every code has words; a mistake of the app is said as one. |
| `src/i18n.js` | The words, Russian and English, with the same keys and arguments. |
| `src/dom.js` | Building DOM without HTML (from `web/`). |
| `css/app.css` | Styles; the tokens come over from `web/css/` with the screens. |

## Running

```sh
scripts/build-wasm.sh           # the core, into web/pkg and web-next/pkg
cd tests/next && npm ci && npm test        # and BROWSER=firefox / webkit
npx --yes -p typescript@5.9.3 tsc -p web-next/jsconfig.json   # strict
```

## Rules beyond web/

- **The page never loads the core.** Anything the core does goes through
  `core/client.js`; a job is named in `core/ops.js` and limited in
  `core/limits.js` (by measurement, or the general limit).
- **Every error has a code, every code has words** (`error.<code>` in
  `i18n.js`); `tests/next/unit/errors.test.mjs` checks it against the
  core's own list.
- **Tests check what a person sees**: roles, names, text. Where no button
  reaches a layer yet, a page under `tests/next/harness/` drives it — never
  the app's modules from a human journey's test.
- **Rules are plain functions** (`src/rules/`): no storage, no core, no
  clock of their own. Each is tested on examples and on random inputs
  (`tests/next/unit/rules.test.mjs`; `RULES_SEED` repeats a case,
  `RULES_ROUNDS` runs more).
- **Type checking is strict** (`"strict": true`).
