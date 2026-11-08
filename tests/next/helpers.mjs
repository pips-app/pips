// @ts-check
// What every test of the new app shares: a server for web-next/ and one
// browser per test file. BROWSER=firefox or BROWSER=webkit runs the same
// tests in that engine; CI runs all three, and each one counts.
//
// The harness pages under harness/ are served at /__test__/: they drive one
// layer of the app (the core's client, say) where no button reaches it yet.
// They never ship: the site is packed from web-next/ alone.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from 'playwright';

const APP = fileURLToPath(new URL('../../web-next/', import.meta.url));
const HARNESS = fileURLToPath(new URL('./harness/', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

export const engineName = process.env.BROWSER ?? 'chromium';
const engine = { chromium, firefox, webkit }[engineName];
if (!engine) throw new Error(`BROWSER=${engineName}: chromium, firefox or webkit`);

/** Serves web-next/ at the root and harness/ at /__test__/. */
async function serve() {
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname));
    const [base, rest] = path.startsWith(`${sep}__test__${sep}`) ? [HARNESS, path.slice('/__test__/'.length)] : [APP, path];
    const file = join(base, rest.endsWith(sep) || rest === '' ? join(rest, 'index.html') : rest);
    if (!file.startsWith(base)) return res.writeHead(403).end();
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[/** @type {keyof TYPES} */ (extname(file))] ?? 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(undefined)));
  const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
  return { url: `http://127.0.0.1:${port}/`, close: () => new Promise((ok) => server.close(ok)) };
}

/**
 * One browser and server for a test file. Every error a page writes is
 * kept; `close()` fails the test with them, so no test passes over an
 * error it did not expect. A test that expects one takes it with
 * `expectError()`.
 */
export async function setup() {
  const site = await serve();
  const browser = await engine.launch();
  /** @type {string[]} */
  const errors = [];
  /** @type {RegExp[]} */
  const expected = [];
  return {
    url: site.url,
    /** A fresh page at `path`. @param {string} path */
    async page(path = '') {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ru-RU' });
      const p = await ctx.newPage();
      p.on('pageerror', (e) => errors.push(e.message));
      p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      await p.goto(new URL(path, site.url).href);
      return p;
    },
    /** An error the test causes on purpose. @param {RegExp} pattern */
    expectError(pattern) { expected.push(pattern); },
    async close() {
      await browser.close();
      await site.close();
      const unexpected = errors.filter((e) => !expected.some((x) => x.test(e)));
      if (unexpected.length) throw new Error(`errors on the page:\n${unexpected.join('\n')}`);
    },
  };
}
