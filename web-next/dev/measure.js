// @ts-check
// The phone's measuring page: starts the measuring worker, shows each step
// as it ends, and gives one line to send back. The limits in
// src/core/limits.js take a phone to be ten times slower than the desktop
// they were measured on; this page is how that guess becomes a number.

import { h, replace } from '../src/dom.js';

/** The worker, through this page's own Trusted Types policy (its CSP asks for one). */
const WORKER = new URL('./measure-worker.js', import.meta.url).href;
/** @type {any} */
const tt = /** @type {any} */ (globalThis).trustedTypes;
const policy = tt?.createPolicy('measure', {
  /** @param {string} s */
  createScriptURL(s) {
    if (s !== WORKER) throw new TypeError(`not the measuring worker: ${s}`);
    return s;
  },
});

/** A number of ms as the line shows it. @param {number} ms */
const ms = (ms) => (ms < 10 ? ms.toFixed(1) : String(Math.round(ms)));

const steps = h('ol', { class: 'msr-steps' });
const line = /** @type {HTMLTextAreaElement} */ (h('textarea', { class: 'msr-line', readonly: true, rows: 5, 'aria-label': 'Строка для отправки' }));
const copy = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'btn wide', disabled: true, onclick: async () => {
  try {
    await navigator.clipboard.writeText(line.value);
    copy.textContent = 'Скопировано';
  } catch {
    // No clipboard here: the text is selected, to copy by hand.
    line.select();
  }
} }, 'Скопировать строку'));
const start = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'btn key wide', onclick: () => run() }, 'Начать замер'));
const status = h('p', { class: 'hint', role: 'status' }, 'Займёт одну-две минуты. Не сворачивайте браузер: в фоне телефон замедляет страницу, и цифры будут неверны.');

document.body.append(h('main', { class: 'msr' },
  h('h1', {}, 'Замер Pips'),
  h('p', {}, 'Страница измеряет, сколько времени ядро Pips тратит на самые тяжёлые задания на этом телефоне. Ключ и карточки она не трогает и ничего не отправляет: результат — строка ниже, её нужно скопировать и прислать.'),
  start, status, steps, line, copy));

function run() {
  start.disabled = true;
  replace(steps);
  status.textContent = 'Идёт замер…';
  /** @type {string[]} */
  const parts = [`cores ${navigator.hardwareConcurrency ?? '?'}`, navigator.userAgent];
  const begun = performance.now();
  const w = new Worker(/** @type {string} */ (policy ? policy.createScriptURL(WORKER) : WORKER), { type: 'module' });
  w.onmessage = (e) => {
    const m = e.data;
    if (m.error) return finish(`Ошибка: ${m.error}`, parts.concat(`error ${m.error}`));
    if (m.done) return finish('Готово. Скопируйте строку и пришлите её.', parts);
    const text = m.skipped ? `${m.step}: нет (${m.skipped})`
      : m.step === 'boot' ? `boot ${ms(performance.now() - begun)} (core ${ms(m.ms)}) ms`
        : m.step === 'sealBackup' ? `sealBackup ${ms(m.perCard)} ms/card, ${ms(m.perMB)} ms/MB`
          : m.step === 'openBackup' ? `openBackup ${ms(m.perMB)} ms/MB (1×1), ${ms(m.perMBLarge)} ms/MB (largest)`
            : `${m.step} ${ms(m.ms)} ms`;
    parts.splice(parts.length - 1, 0, text);
    steps.append(h('li', {}, text));
  };
  w.onerror = (e) => { e.preventDefault(); finish(`Ошибка: ${e.message}`, parts.concat(`error ${e.message}`)); };
  w.postMessage('start');

  /** @param {string} said @param {string[]} all */
  function finish(said, all) {
    w.terminate();
    status.textContent = said;
    line.value = `pips-measure 1 | ${all.join(' | ')}`;
    copy.disabled = false;
    start.disabled = false;
  }
}
