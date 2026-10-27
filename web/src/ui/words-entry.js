// @ts-check
// Entering the 24 words: numbered cells, as they were shown to be written
// down. A space or Enter goes to the next cell; a word cut to four letters
// is written out in full when the cell is left; a pasted phrase fills the
// cells from where it was pasted. A cell that can no longer become a word
// is marked at once, not after the last one.

import { h } from '../dom.js';
import { t } from '../i18n.js';
import { wordBook, splitWords } from '../words.js';

const COUNT = 24;

/**
 * @param {readonly string[]} list the core's word list
 * @param {(s: {words: string[]|null, bad: number, named: number}) => void} onChange
 *   words: all 24, once each names a word; bad: the first cell (0-based)
 *   that names none, or -1; named: cells that name a word
 */
export function wordsEntry(list, onChange) {
  const book = wordBook(list);
  const cells = Array.from({ length: COUNT }, (_, k) => /** @type {HTMLInputElement} */ (h('input', {
    type: 'text', autocomplete: 'off', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false',
    enterkeyhint: k < COUNT - 1 ? 'next' : 'done', 'aria-label': t('words.cell', k + 1),
  })));
  const el = h('ol', { class: 'word-grid words-entry' }, cells.map((c, k) => h('li', {}, h('span', { 'aria-hidden': 'true' }, k + 1), c)));

  /** Marks a cell: wrong if it can no longer become a word (typing), or names none (left). @param {number} k @param {boolean} left */
  function mark(k, left) {
    const v = cells[k].value.trim();
    const bad = v !== '' && (left ? !book.resolve(v) : !book.possible(v));
    cells[k].classList.toggle('bad', bad);
    cells[k].parentElement?.classList.toggle('bad', bad);
    cells[k].setAttribute('aria-invalid', String(bad));
  }
  /** The cell left: a short form becomes the word. @param {number} k */
  function settle(k) {
    const w = book.resolve(cells[k].value);
    if (w) cells[k].value = w;
    mark(k, true);
  }
  function report() {
    const words = cells.map((c) => book.resolve(c.value));
    const bad = cells.findIndex((c) => c.classList.contains('bad'));
    onChange({
      words: words.every(Boolean) ? /** @type {string[]} */ (words) : null,
      bad, named: words.filter(Boolean).length,
    });
  }
  /** Words from cell k on; the focus goes to the cell after them. @param {number} k @param {string[]} words */
  function fill(k, words) {
    words.slice(0, COUNT - k).forEach((w, i) => { cells[k + i].value = w; settle(k + i); });
    cells[Math.min(k + words.length, COUNT - 1)].focus();
  }

  cells.forEach((c, k) => {
    c.addEventListener('input', () => {
      // Phone keyboards send no key events for a space: it is seen here.
      if (/\s/.test(c.value)) {
        const words = splitWords(c.value);
        if (words.length) fill(k, words);
        else c.value = '';
      } else mark(k, false);
      report();
    });
    c.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (k < COUNT - 1) cells[k + 1].focus();
        else c.blur();
      } else if (e.key === 'Backspace' && c.value === '' && k > 0) {
        e.preventDefault();
        cells[k - 1].focus();
      }
    });
    c.addEventListener('blur', () => { settle(k); report(); });
  });

  return {
    el,
    focus: () => cells[0].focus(),
    /** Tells again where the cells stand (shown again after something else). */
    refresh: report,
  };
}
