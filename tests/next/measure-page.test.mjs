// @ts-check
// The phone's measuring page (web-next/dev/measure.html), published with
// the preview: it runs to the end in each engine, under its own CSP, and
// gives a line with every step to send back.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.mjs';

/** @type {Awaited<ReturnType<typeof setup>>} */
let env;
before(async () => { env = await setup(); });
after(() => env.close());

test('the measuring page runs every step and gives one line to send', async () => {
  const p = await env.page('dev/measure.html');
  await p.getByRole('button', { name: 'Начать замер' }).click();
  await p.getByRole('status').filter({ hasText: /Готово|Ошибка/ }).waitFor({ timeout: 110_000 });
  const line = await p.getByRole('textbox', { name: 'Строка для отправки' }).inputValue();
  assert.doesNotMatch(line, /error/);
  for (const step of ['boot', 'shareSize', 'render', 'openEnvelope', 'importPicture upscaled', 'importPicture noise', 'sealBackup', 'openBackup']) {
    assert.match(line, new RegExp(`\\| ${step} `), step);
  }
  assert.equal(await p.getByRole('button', { name: 'Скопировать строку' }).isEnabled(), true);
  await p.context().close();
});
