// The app around the cards: the error journal, developer mode, the profile,
// stored data from other versions, the camera, storage the browser takes
// away — and the monkey, which tries everything.
// Run after scripts/build-wasm.sh: `npm ci && npm test` in this folder.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { suite, tab, toast, textMatching, samples, words, cards, ownCard, still, until, toastAfter } from './helpers.mjs';

const env = suite();

test('a fault nobody caught is written down, told once, and can be read and sent', async () => {
  const p = await env.phone('pixelfox');
  const before = env.errors.length;
  const words = await p.evaluate(async () => (await import('/src/state.js')).app.identity.words());
  const boom = () => p.evaluate(() => { setTimeout(() => { throw new Error('boom in a test'); }); });
  assert.match(await toastAfter(p, boom), /Что-то пошло не так — это записано в журнал/);
  await boom(); // the same again: one entry, counted
  const counted = () => p.evaluate(async () => (await import('/src/diagnostics.js')).journal.entries[0]?.count === 2);
  await until(counted, 'the second fault counted');
  // Thrown on purpose: those, and only those, are not the page's faults.
  for (let i = env.errors.length - 1; i >= before; i--) if (env.errors[i].includes('boom in a test')) env.errors.splice(i, 1);

  // The toast leads to the journal.
  await p.click('.toast .text-btn');
  await p.locator('.overlay .journal-row').first().waitFor();
  assert.equal(await p.locator('.overlay .journal-row').count(), 1);
  assert.match(await p.textContent('.overlay .journal-row'), /Ошибка×2collection.*boom in a test/s);
  // The report, as it would go: facts and the entry — and nothing secret.
  await p.click('.journal-report summary');
  const text = await textMatching(p, '.journal-report pre', /boom/);
  assert.match(text, /^Pips — error report\nversion: pips-dev\n/);
  assert.match(text, /error ×2 \[collection\] boom in a test/);
  assert.ok(!text.includes(words.split(' ')[0] + ' ' + words.split(' ')[1]), 'no recovery words');
  assert.ok(!text.includes('pixelfox'), 'no nick');
  // It survives a restart (written a moment after it happened).
  await p.keyboard.press('Escape');
  await p.locator('.overlay').waitFor({ state: 'detached' });
  await until(() => p.evaluate(async () => (await (await import('/src/store.js')).getMeta('journal'))?.[0]?.count === 2), 'the journal written');
  await p.reload();
  await p.locator('nav.tabs').waitFor();
  await tab(p, 'me');
  assert.match(await textMatching(p, '.journal-group', /1 запись/), /1 запись, последняя —/);
  // Sent the device's way (here: the clipboard, or a file where there is none).
  await p.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  assert.match(await toastAfter(p, () => p.click('.journal-group >> text=Отправить отчёт')), /Отчёт (скопирован|сохранён файлом)/);
  // Cleared from its page.
  await p.click('.journal-group >> text=Открыть журнал');
  await p.click('.overlay >> text=Очистить журнал');
  assert.equal(await p.textContent('.overlay .sheet-body > p.hint'), 'Записей нет.');
  await p.click('.overlay .bar .icon-btn');
  assert.match(await textMatching(p, '.journal-group', /Ошибок не было/), /Ошибок не было/);
  await p.context().close();
});

test('the browser itself refuses markup that is not one of the app\'s icons, and scripts that are not its own', async () => {
  const p = await env.phone('trustfox');
  await p.locator('.first-run').waitFor();
  assert.ok(await p.locator('svg.i').count() > 0, 'the icons are drawn');
  const r = await p.evaluate(async () => {
    const { trusted } = await import('/src/dom.js');
    const refused = (/** @type {() => unknown} */ f) => { try { f(); return false; } catch (e) { return e instanceof TypeError; } };
    const div = document.createElement('div');
    return {
      enforced: 'trustedTypes' in window,
      plainString: refused(() => { div.innerHTML = '<img src=x>'; }),
      otherMarkup: refused(() => trusted.createHTML('<img src=x>')),
      otherScript: refused(() => trusted.createScriptURL('https://example.com/x.js')),
      anotherPolicy: refused(() => /** @type {any} */ (window).trustedTypes?.createPolicy('more', { createHTML: (/** @type {string} */ s) => s })),
    };
  });
  if (r.enforced) {
    assert.equal(r.plainString, true, 'a plain string into innerHTML');
    assert.equal(r.anotherPolicy, true, 'a second policy');
    // The refusals met on purpose, as this browser reports them in the
    // console: each words them its own way (Chromium names the trusted
    // type, Firefox the policy directive), so only this phone's messages
    // about them are taken away — anything else still fails the run.
    const met = env.errors.filter((/** @type {string} */ e) => e.startsWith('trustfox:') && /trusted|require-trusted-types-for|Content[- ]Security/i.test(e));
    for (const e of met) env.errors.splice(env.errors.indexOf(e), 1);
  }
  assert.equal(r.otherMarkup, !!r.enforced, 'other markup through the policy');
  assert.equal(r.otherScript, !!r.enforced, 'another site\'s script through the policy');
  await p.context().close();
});

test('developer mode opens only for its phrase, and its samples come and go as a set', async () => {
  const p = await env.phone('pixelfox');
  await ownCard(p, 'Моя', env.dir);
  await tab(p, 'me');
  const group = p.locator('section.view:visible .group.developer');
  await group.locator('> *').first().waitFor();
  assert.equal(await group.locator('button').count(), 0, 'no tools, only the folded gate');
  await group.locator('summary').click();
  for (const wrong of ['i am a developer', 'I am a developer ', 'I am a develope']) {
    await group.locator('input').fill(wrong); // the gate answers as it is typed
    assert.equal(await group.locator('.dev-gate').count(), 1, `not for «${wrong}»`);
  }
  await group.locator('input').fill('I am a developer');
  await group.locator('text=Добавить образцы').waitFor();
  // Asked first: «Cancel» adds nothing.
  await group.locator('text=Добавить образцы').click();
  await p.click('.dialog button:text-is("Отмена")');
  assert.equal(await cards(p), 1);
  await tab(p, 'collection');
  await tab(p, 'me');
  await samples(p);
  assert.equal(await cards(p), 19);
  // Taken away as a set: the person's own card stays.
  await tab(p, 'me');
  await group.locator('text=Убрать образцы (18)').click();
  assert.match(await toastAfter(p, () => p.click('.dialog button:text-is("Да")')), /Удалено образцов: 18/);
  assert.equal(await cards(p), 1);
  // Off again: back behind the phrase.
  await group.locator('text=Выключить режим разработчика').click();
  await group.locator('.dev-gate').waitFor();
  await p.context().close();
});

test('the profile keeps itself as it is typed, and the scanner frame turns the camera on', async () => {
  const p = await env.phone('quill');
  await tab(p, 'me');
  const field = (label) => p.locator(`section.view:visible .field:has(label:text-is("${label}")) input`);
  await field('Ник').fill('quill2');
  await p.locator('.saved-mark.on').waitFor();
  assert.equal(await p.textContent('.idcard b'), 'quill2', 'the card at the top follows');
  await p.selectOption('section.view:visible select.net', 'bluesky');
  await field('Соцсеть').fill('quill.bsky');
  await field('Ссылка').fill('Quill.ART/Shop');
  await field('Ссылка').blur(); // leaving a field keeps it at once
  const profile = () => p.evaluate(async () => (await import('/src/state.js')).app.profile);
  await until(async () => (await profile()).link === 'quill.art/Shop', 'the link kept');
  assert.deepEqual(await profile(), { nick: 'quill2', handle: { network: 'bluesky', text: 'quill.bsky' }, link: 'quill.art/Shop' });
  // An empty name: no network is kept, whatever the list shows.
  await field('Соцсеть').fill('');
  await until(async () => (await profile()).handle === null, 'an empty name keeps no network');
  assert.equal(await p.locator('section.view:visible button:text-is("Сохранить")').count(), 0, 'nothing to press');
  assert.equal(await p.locator('section.view:visible button:text-is("Сменить ключ")').count(), 1);

  // The scanner: no separate button; the frame is the way to the camera.
  await tab(p, 'receive');
  assert.equal(await p.locator('section.view:visible .btn:text-is("Включить камеру")').count(), 0);
  await p.click('section.view:visible .scanner-start');
  assert.match(await textMatching(p, 'section.view:visible .scanner-start', /Нет доступа к камере/), /Нет доступа к камере.*настройках браузера/, 'no camera here: said in the frame');
  assert.ok(await p.isVisible('section.view:visible .scanner-start'), 'and the frame still offers to try again');
  // The words stay inside the corners, however many lines they take.
  const inside = await p.evaluate(() => {
    const c = document.querySelector('section.view:not([hidden]) .scanner .corners').getBoundingClientRect();
    const s = document.querySelector('section.view:not([hidden]) .scanner-start small').getBoundingClientRect();
    return s.left >= c.left && s.right <= c.right && s.top >= c.top && s.bottom <= c.bottom;
  });
  assert.ok(inside, 'the note inside the corners');
  await p.context().close();
});

test('stored data: an older layout is upgraded in place, a newer one is never hidden behind an empty app', async () => {
  // A collection as the last version left it: layout 1, records without tags.
  const a = await env.phone('oldfox');
  await tab(a, 'me');
  await samples(a);
  const dump = await a.evaluate(async () => {
    const s = await import('/src/state.js');
    const st = await import('/src/store.js');
    return { name: s.app.stub ? 'pips-dev-stub' : 'pips', seed: [...(await st.getMeta('seed'))], profile: await st.getMeta('profile'), cards: (await st.allCards()).map((r) => ({ ...r, payload: [...r.payload], cert: r.cert && [...r.cert] })) };
  });
  const ctx = a.context();
  const b = await ctx.browser().newContext({ viewport: { width: 390, height: 844 }, locale: 'ru-RU' });
  const p = await b.newPage();
  env.watch(p, 'oldfox again');
  await p.goto(`${env.url}sw.js`); // the same site, without the app (a plain text page)
  await p.evaluate((d) => new Promise((ok, fail) => {
    const req = indexedDB.open(d.name, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore('meta'); req.result.createObjectStore('cards', { keyPath: 'digest' }); };
    req.onsuccess = () => {
      const t = req.result.transaction(['meta', 'cards'], 'readwrite');
      t.objectStore('meta').put(new Uint8Array(d.seed), 'seed');
      t.objectStore('meta').put(d.profile, 'profile');
      for (const r of d.cards) {
        const { tags, ...old } = r; // what layout 1 could hold: no tags
        t.objectStore('cards').put({ ...old, payload: new Uint8Array(r.payload), cert: r.cert && new Uint8Array(r.cert) });
      }
      t.oncomplete = () => { req.result.close(); ok(); };
      t.onerror = () => fail(t.error);
    };
  }), dump);
  await p.goto(env.url);
  await p.locator('nav.tabs').waitFor();
  const after = await p.evaluate(async (name) => {
    const s = await import('/src/state.js');
    const st = await import('/src/store.js');
    const db = await new Promise((ok) => { const r = indexedDB.open(name); r.onsuccess = () => ok(r.result); });
    const v = db.version;
    db.close();
    return { version: v, cards: s.app.cards.size, tagged: (await st.allCards()).every((r) => Array.isArray(r.tags)), nick: s.app.profile.nick };
  }, dump.name);
  assert.deepEqual(after, { version: 2, cards: 18, tagged: true, nick: 'oldfox' });

  // Another tab with a newer app takes the data: this one steps aside, and says so.
  const q = await b.newPage();
  await q.goto(`${env.url}sw.js`);
  await q.evaluate((name) => new Promise((ok) => { const r = indexedDB.open(name, 3); r.onsuccess = () => { r.result.close(); ok(); }; }), dump.name);
  assert.match(await p.textContent('.halt'), /В другой вкладке открыта новая версия/);
  // And now this app finds data newer than it knows: it says so instead of starting empty.
  await p.goto(env.url);
  assert.match(await p.locator('.halt').textContent(), /уже записаны более новой версией/);
  assert.equal(await p.locator('nav.tabs').count(), 0, 'no empty app over the data');
  // Journaled as it should be (main.js): the one error this page was made to meet.
  const met = env.errors.filter((e) => e.startsWith('oldfox again:'));
  assert.deepEqual(met.filter((e) => !/newer_data/.test(e)), [], 'no error but the one this page was made to meet');
  assert.equal(met.length, 1, 'that one, journaled');
  env.errors.splice(env.errors.indexOf(met[0]), 1);
  await b.close();
  await ctx.close();
});

test('storage that fails to open stops the app with the reason; storage refused on purpose keeps it in memory, and says so', async () => {
  // A collection on the device; then the browser's storage fails this once.
  const a = await env.phone('storefox');
  await a.addInitScript(() => {
    indexedDB.open = () => { throw new DOMException('the disk said no', 'UnknownError'); };
  });
  await a.reload();
  assert.match(await a.locator('.halt').textContent(), /Хранилище не открылось/);
  assert.equal(await a.locator('nav.tabs').count(), 0, 'no empty first run over a collection');
  const met = env.errors.filter((e) => e.startsWith('storefox:'));
  assert.ok(met.length && met.every((e) => /store_unavailable|storage would not open/.test(e)), met.join('\n'));
  for (const e of met) env.errors.splice(env.errors.indexOf(e), 1);
  await a.context().close();
  // A private window that refuses storage: the app runs in memory, and Profile says so.
  const p = await env.blank('privatefox');
  await p.locator('text=Создать ключ').waitFor(); // started: a reload now cuts nothing short
  await p.addInitScript(() => {
    indexedDB.open = () => { throw new DOMException('not here', 'InvalidStateError'); };
  });
  await p.reload();
  await p.click('text=Создать ключ');
  await p.check('.check input');
  await p.click('text=Дальше');
  await p.fill('.field input', 'privatefox');
  await p.click('text=Готово');
  await p.locator('nav.tabs').waitFor();
  await tab(p, 'me');
  await p.locator('section.view:visible >> text=Хранилище браузера недоступно').waitFor();
  await p.context().close();
});

test('a camera granted after the scanner was left is switched off at once', async () => {
  const p = await env.phone('camfox');
  // A browser that takes its time to ask: the camera comes 600 ms after it was requested.
  await p.evaluate(() => {
    const w = /** @type {any} */ (window);
    navigator.mediaDevices.getUserMedia = () => {
      w.asked = (w.asked ?? 0) + 1; // counted as asked, not as it comes
      return new Promise((ok) => setTimeout(() => {
        const c = document.createElement('canvas');
        c.width = c.height = 64;
        c.getContext('2d').fillRect(0, 0, 64, 64);
        const s = c.captureStream(5);
        w.tracks = (w.tracks ?? []).concat(s.getTracks());
        ok(s);
      }, 600));
    };
  });
  await tab(p, 'receive');
  await p.click('section.view:not([hidden]) .scanner-start');
  await p.click('section.view:not([hidden]) .scanner-start'); // twice, impatiently
  await tab(p, 'collection'); // and away before the camera came
  // The camera comes late; the moment it does, it is switched off.
  const camera = () => p.evaluate(() => /** @type {any} */ (window).tracks?.map((t) => t.readyState) ?? []);
  await until(async () => (await camera()).length > 0, 'the camera granted');
  await until(async () => (await camera()).every((s) => s === 'ended'), 'the camera switched off');
  assert.equal(await p.evaluate(() => /** @type {any} */ (window).asked), 1, 'asked for the camera once');
  const states = await camera();
  assert.ok(states.every((s) => s === 'ended'), `no camera left on: ${states}`);
  await p.context().close();
});

/**
 * Closes the app's storage connection from underneath it, as a browser does
 * on its own (Firefox on Android, after a while in the background): the
 * app's own connection is found as it next starts a transaction, closed,
 * and told so with the close event a browser fires. The same in every
 * engine. Chromium's DevTools used to do it for real by clearing the
 * site's storage; in the Chromium of Playwright 1.64 that clear goes on
 * erasing the data after it closes the connection, and aborts the
 * reopening too — the site's data being wiped, not a connection closed.
 * @param {import('playwright').Page} p
 */
async function takeStorageAway(p) {
  await p.evaluate(async () => {
    const proto = IDBDatabase.prototype, open = proto.transaction;
    /** @type {IDBDatabase | null} */
    let found = null;
    proto.transaction = function (...a) { found ??= this; return open.apply(this, a); };
    await (await import('/src/store.js')).getMeta('language'); // any read: it goes through the connection
    proto.transaction = open;
    if (!found) throw new Error('the app opened no transaction');
    found.close();
    found.dispatchEvent(new Event('close'));
  });
}

test('storage closed by the browser underneath the app: opened again, nothing fails', async () => {
  const p = await env.phone('pixelfox');
  await tab(p, 'me');
  await takeStorageAway(p);
  await tab(p, 'collection');
  await tab(p, 'me'); // the profile reads storage as it draws: the error in a real report
  await p.locator('section.view:visible .group').first().waitFor();
  assert.deepEqual(await p.evaluate(async () => (await import('/src/diagnostics.js')).journal.entries.map((e) => e.text)), [], 'nothing went wrong');
  await p.context().close();
});

// Seeded random use of the whole app — taps on whatever can be pressed,
// keys, drags — as a hurried or curious person would. It looks for what no
// scripted journey thought of: any page error, any fault written in the
// journal (both reach the console, which the hook after the tests checks),
// and anything left open that Escape does not close. Same seed, same steps;
// another seed (MONKEY_SEED=…), another walk — every failure names its seed.
test('a monkey loose in the app finds nothing wrong', { timeout: 300_000 }, async () => {
  const p = await env.phone('monkey');
  await tab(p, 'me');
  await samples(p);
  p.on('filechooser', () => {}); // a picker opened by a tap is left unanswered
  const SEED = Number(process.env.MONKEY_SEED ?? 4);
  let seed = SEED;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const KEYS = ['Escape', '+', '-', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', ' ', 'Tab', 'z', 'Delete'];
  // Not these: they end the session (a new key), undo the setup (samples,
  // developer mode), or open the browser's own window (reading the
  // clipboard: Firefox asks with a menu of its own, outside the page).
  const SPARE = /Сменить ключ|Удалить насовсем|Выключить|Очистить|Убрать образцы|Вставить ссылку из буфера/;
  // What it did, step by step: said if a step never comes back, instead of
  // a silent hang — with what the page was like then, whether a fresh page
  // of the same browser answers (the app's hang, or the browser's), and
  // whether letting go of the mouse brings it back. With PIPS_TEST_OUT set
  // (the repeated rounds set it), every step goes to a file there too, to
  // replay the same day: the samples' places follow the date.
  const done = [];
  /** @type {object[]} */
  const steps = [];
  let at = { x: 0, y: 0 };
  const state = () => p.evaluate(({ x, y }) => {
    const e = document.elementFromPoint(x, y), path = [];
    for (let a = e; a && path.length < 4; a = a.parentElement) path.push(`${a.tagName.toLowerCase()}${typeof a.className === 'string' && a.className ? `.${a.className.trim().split(/\s+/).join('.')}` : ''}`);
    const drags = /** @type {any} */ (window).__drags;
    return `under ${x},${y}: ${path.join(' < ')}; selected: «${String(getSelection()).slice(0, 40)}»; screen: ${document.querySelector('section.view:not([hidden])')?.className}; native drags: ${drags.length ? drags.slice(-2).join(' / ') : 'none'}`;
  }, at);
  const late = (ms, what) => new Promise((_, no) => setTimeout(() => no(new Error(what)), ms));
  const fresh = async () => {
    const q = await p.context().newPage();
    try { return (await q.evaluate(() => 1 + 1)) === 2 ? 'a fresh page answers' : 'a fresh page answers wrong'; } finally { q.close().catch(() => {}); }
  };
  const within = (/** @type {Promise<unknown>} */ step) => Promise.race([step, late(15_000, 'hung')]).catch(async (e) => {
    if (e?.message !== 'hung') throw e;
    const t0 = Date.now();
    const page = await Promise.race([state().then((x) => `${x} (answered in ${Date.now() - t0} ms)`), late(20_000, 'the page does not answer in 20 s')]).catch((x) => x.message);
    const other = await Promise.race([fresh(), late(5000, 'a fresh page does not answer either')]).catch((x) => x.message);
    const after = await Promise.race([p.mouse.up().then(state), late(3000, 'still nothing')]).catch((x) => x.message);
    if (process.env.PIPS_TEST_OUT) await writeFile(join(process.env.PIPS_TEST_OUT, `monkey-${process.env.BROWSER ?? 'chromium'}-${Date.now()}.json`), JSON.stringify({ steps, page, other, after }, null, 1));
    throw new Error(`seed ${SEED}: a step hung; the last ones: ${done.slice(-6).join(' · ')}. Then: ${page}; ${other}; after letting go of the mouse: ${after}\nsteps: ${JSON.stringify(steps.slice(-30))}`);
  });
  const { width: W, height: H } = /** @type {{width: number, height: number}} */ (p.viewportSize());
  for (let step = 0; step < 250; step++) {
    const k = rnd(10);
    try {
      if (k < 6) {
        const targets = await within(p.evaluate(() => [...document.querySelectorAll('button, [role="button"], summary, a[href], input[type="checkbox"], .on-stage, canvas, .ed-frame')]
          .map((e) => {
            const r = e.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, top = document.elementFromPoint(x, y);
            const ok = r.width > 4 && r.height > 4 && x > 0 && y > 0 && x < innerWidth && y < innerHeight && !(/** @type {any} */ (e).disabled) && top && (top === e || e.contains(top));
            return ok ? { x, y, n: String(e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 40) } : null;
          }).filter((v) => v !== null)));
        const fair = /** @type {{x: number, y: number, n: string}[]} */ (targets).filter((v) => !SPARE.test(v.n));
        if (!fair.length) continue;
        const tp = fair[rnd(fair.length)];
        done.push(`tap «${tp.n}»`);
        steps.push({ tap: tp });
        at = tp;
        await within(p.mouse.click(tp.x, tp.y));
      } else if (k < 8) {
        const key = KEYS[rnd(KEYS.length)];
        done.push(`key ${key}`);
        steps.push({ key });
        await within(p.keyboard.press(key));
      } else {
        // It ends on the screen, as a finger does. Let go outside the window,
        // Firefox now and then loses the release, and the driver's next press
        // lands on a button it thinks is still down: the step hangs (twice
        // and three times in sixty rounds, never in Chromium). A person's
        // mouse let go out there is released by the system.
        const inside = (/** @type {number} */ v, /** @type {number} */ max) => Math.min(Math.max(v, 1), max - 1);
        const x = 40 + rnd(W - 80), y = 120 + rnd(H - 260), to = { x: inside(x + rnd(240) - 120, W), y: inside(y + rnd(400) - 200, H) };
        done.push(`drag at ${x},${y}`);
        steps.push({ drag: { x, y }, to });
        at = { x, y };
        await within((async () => {
          await p.mouse.move(x, y);
          await p.mouse.down();
          await p.mouse.move(to.x, to.y, { steps: 5 });
          await p.mouse.up();
        })());
      }
      await p.waitForTimeout(60 + rnd(250));
    } catch (e) {
      // The page changing under a step (a sheet closing, the view swapped
      // while targets were read) is not a finding; anything else is.
      if (!/Execution context was destroyed|Cannot find context with specified id/.test(String(/** @type {any} */ (e)?.message))) throw e;
    }
  }
  for (let i = 0; i < 6; i++) { await p.keyboard.press('Escape'); await still(p); }
  const open = await p.evaluate(() => [...document.querySelectorAll('[role="dialog"], .overlay, .scrim')].filter((e) => {
    const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && r.top < innerHeight - 2 && r.bottom > 2 && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05 && !e.closest('[hidden]');
  }).map((e) => e.className));
  assert.deepEqual(open, [], `seed ${SEED}: Escape closes whatever was left open`);
  await p.context().close();
});
