// @ts-check
// A person's phone in the new app, through its buttons: a new key made and
// kept, a name given. And another person's phone (harness/artist.js), whose
// cards arrive. Shared by the tests of the first run and of cards between phones.
/** @typedef {import('playwright').Page} Page */
/** @typedef {Awaited<ReturnType<typeof import('./helpers.mjs').setup>>} Env */

/** The 24 words as the screen shows them, in order. @param {Page} p */
export async function readWords(p) {
  const cells = await p.getByRole('list', { name: 'Ваши 24 слова' }).getByRole('listitem').allInnerTexts();
  return cells.map((c) => c.replace(/^\d+\s*/, '').trim());
}

/** The places of the words asked back, from the fields' names. @param {Page} p */
export async function asked(p) {
  await p.getByRole('heading', { name: 'Проверим запись' }).waitFor();
  const names = await p.getByRole('textbox').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
  return names.map((n) => Number(n.replace(/\D+/g, '')));
}

/**
 * A new phone, through the first run with a new key; its words and the
 * name given. `path`: where it opens (a link with a card in it).
 * @param {Env} env @param {string} nick @param {string} [path]
 */
export async function newKey(env, nick, path = '') {
  const p = await env.page(path);
  await p.getByRole('button', { name: 'Создать ключ' }).click();
  await p.getByRole('heading', { name: 'Ваши 24 слова' }).waitFor();
  const words = await readWords(p);
  await p.getByRole('button', { name: 'Я записал(а) — проверить' }).click();
  for (const n of await asked(p)) await p.getByLabel(`Слово № ${n}`, { exact: true }).fill(words[n - 1].slice(0, 4));
  await p.getByRole('button', { name: 'Дальше', exact: true }).click();
  await p.getByRole('heading', { name: 'Ключ на месте' }).waitFor();
  await p.getByRole('button', { name: 'Дальше: как вас подписывать' }).click();
  await p.getByLabel('Как вас подписывать?').fill(nick);
  await p.getByRole('button', { name: 'Готово' }).click();
  await p.getByRole('heading', { name: 'Профиль' }).waitFor();
  return { p, words };
}

/**
 * Another person, with a key of their own, whose cards arrive.
 * @param {Env} env @param {string} nick
 */
export async function artist(env, nick) {
  const p = await env.page('__test__/artist.html');
  await p.waitForFunction(() => /** @type {any} */ (window).harness);
  await p.evaluate((n) => /** @type {any} */ (window).artist(n), nick);
  /** @template T @param {string} f @param {...any} args @returns {Promise<T>} */
  const call = (f, ...args) => p.evaluate(([f, args]) => /** @type {any} */ (window)[f](...args.map((a) => (Array.isArray(a) && a.every((x) => typeof x === 'number') ? Uint8Array.from(a) : a))), /** @type {const} */ ([f, args]));
  return {
    p,
    /** A new card's envelope, as bytes. @param {string} title @param {number} [side] @param {number} [seed] */
    envelope: async (title, side, seed) => /** @type {number[]} */ ([...Object.values(await call('envelope', title, side, seed))]),
    /** @param {number[]} env @param {string} nick */
    passOn: async (env, nick) => /** @type {number[]} */ ([...Object.values(await call('passOn', env, nick))]),
    /** @param {string} text @param {number} [module] */
    codePicture: (text, module) => /** @type {Promise<number[]>} */ (call('codePicture', text, module)),
    /** @param {number[]} env */
    codeTexts: (env) => /** @type {Promise<string[]>} */ (call('codeTexts', env)),
    /** @param {number[][]} envs */
    pipsFile: (envs) => /** @type {Promise<number[]>} */ (p.evaluate((e) => /** @type {any} */ (window).pipsFile(e.map((x) => Uint8Array.from(x))), envs)),
    /** @param {number[]} env */
    link: (env) => /** @type {Promise<string>} */ (call('link', env)),
    paperKey: () => /** @type {Promise<string>} */ (call('paperKey')),
  };
}

/** Bytes as a file to choose. @param {string} name @param {number[]} bytes @param {string} [mimeType] */
export const asFile = (name, bytes, mimeType = 'application/octet-stream') => ({ name, mimeType, buffer: Buffer.from(bytes) });

/**
 * Chooses files with the button named `button`, as a person would.
 * @param {Page} p @param {string} button @param {ReturnType<typeof asFile>[]} files
 */
export async function choose(p, button, files) {
  const [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.getByRole('button', { name: button, exact: true }).click()]);
  await chooser.setFiles(files);
}

/**
 * The message an action brings: waits for the line of messages to say
 * something new after `action`, and gives it.
 * @param {Page} p @param {() => Promise<unknown>} action
 */
export async function toldAfter(p, action) {
  // Any change of its words or of its being shown, from now on, is the answer.
  await p.locator('.shell-tell').evaluate((el) => {
    const s = /** @type {HTMLElement} */ (el);
    s.dataset.answered = 'no';
    const watch = new MutationObserver(() => { s.dataset.answered = 'yes'; watch.disconnect(); });
    watch.observe(s, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'class'] });
  });
  await action();
  await p.locator('.shell-tell[data-answered="yes"]:not([hidden])').waitFor();
  return (await p.locator('.shell-tell span').innerText()).trim();
}

/** The cards in the profile's list, as their lines. @param {Page} p */
export async function cards(p) {
  await p.getByRole('button', { name: 'Профиль' }).click();
  await p.getByRole('heading', { name: 'Профиль' }).waitFor();
  const list = p.getByRole('list', { name: 'Коллекция' });
  if (!(await list.count())) return [];
  return (await list.getByRole('listitem').allInnerTexts()).map((s) => s.replace(/\s+/g, ' ').trim());
}

