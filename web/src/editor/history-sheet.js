// @ts-check
// The undo history as a list: every step on the current line, newest at the
// top, the present one marked. A tap goes there — undoing or redoing
// everything between. Where something else was once done instead (a branch
// left by an undo and a new change), the step offers the other way too:
// nothing done is ever lost.

import { h, icon } from '../dom.js';
import { t } from '../i18n.js';
import { bottomSheet } from '../kit/bottom-sheet.js';

/** "just now", "5 min", "2 h". @param {number} ms */
function ago(ms) {
  const m = Math.round(ms / 60000);
  if (m < 1) return t('ed.h.now');
  if (m < 60) return t('ed.h.min', m);
  return t('ed.h.hours', Math.round(m / 60));
}

/** @param {{model: ReturnType<typeof import('./model.js').createModel>}} o */
export function historySheet(o) {
  const sheet = bottomSheet({ label: t('ed.history') });
  const list = h('ol', { class: 'ed-history', reversed: true });
  sheet.body.append(list);

  function paint() {
    const hst = o.model.history, cur = hst.current, now = Date.now();
    const line = hst.line();
    const rows = line.map((n) => {
      const here = n === cur;
      const past = line.indexOf(n) <= line.indexOf(cur);
      const sibs = n.parent ? n.parent.kids : [];
      const other = sibs.length > 1 ? sibs[(sibs.indexOf(n) + 1) % sibs.length] : null;
      return h('li', { class: `${here ? 'here' : ''} ${past ? '' : 'ahead'}` },
        h('button', { type: 'button', class: 'ed-step', 'aria-current': here ? 'step' : null, onclick: () => o.model.goTo(n) },
          h('b', {}, n.parent ? t(n.label) : t('ed.h.start')),
          h('small', {}, [n.frame >= 0 ? t('ed.h.frame', n.frame + 1) : '', n.parent ? ago(now - n.t) : ''].filter(Boolean).join(' · '))),
        other ? h('button', {
          type: 'button', class: 'ed-branch', title: t('ed.h.branch', sibs.length), 'aria-label': t('ed.h.branch', sibs.length),
          onclick: () => o.model.goTo(other),
        }, icon('turn'), h('span', {}, `${sibs.indexOf(n) + 1}/${sibs.length}`)) : null);
    });
    list.replaceChildren(...rows.reverse());
    list.querySelector('.here')?.scrollIntoView?.({ block: 'nearest' });
  }

  return {
    els: sheet.els,
    show() { paint(); sheet.show(); },
    close: () => sheet.close(),
    /** After a change: the list follows while it is open. */
    refresh() { if (sheet.open) paint(); },
    get open() { return sheet.open; },
  };
}
