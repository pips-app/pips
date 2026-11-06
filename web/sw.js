// Offline cache for the app shell. A new VERSION replaces every cached
// file at once, so a release never mixes old and new modules: a new worker
// waits until no page of the old version is open (the next start) or the
// person takes it at once, which reloads the page — so a running page never
// loads a later module from the new cache.
// All three lines are rewritten by scripts/build-site.sh: the version from
// the commit, the list from the files actually published, and the SHA-256
// of each (base64), as published. Kept valid here so the file still works
// as is: with no hashes, nothing is served from the cache.
const VERSION = 'pips-dev';
const FILES = ['./', 'index.html'];
/** @type {Record<string, string>} */
const HASHES = {};

// Past the browser's HTTP cache (cache: 'reload'): GitHub Pages lets files
// be kept ten minutes, and two releases closer than that would otherwise
// fill the new version's cache with the last one's files.
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))));
});

// The person chose to take the new version now (main.js reloads the page).
self.addEventListener('message', (e) => {
  if (e.data === 'take-over') self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    // Only our own old versions: other apps may share this origin (a
    // github.io site hosts every project of its owner) and their caches.
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('pips-') && k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Cache first: the app works the same with or without a network. Only
// same-origin GETs are ever handled; there is nothing else to fetch.
//
// A cached file is served only from this version's own cache, and only if
// it is byte for byte the file published. Every site on the origin can
// write to every cache here (a github.io address hosts all its owner's
// projects), and caches.match would search theirs too: without the check,
// one of them could put its own index.html in our place and have it served
// to this app from then on, offline or not. A file that fails the check is
// fetched again and, if that one is right, put back; with no network it is
// not served at all.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(fromCache(e.request, url).then((hit) => hit ?? fromNetwork(e.request, url)));
});

/** The published name of a file, as FILES and HASHES spell it. @param {URL} url */
function published(url) {
  const path = url.pathname.slice(new URL(self.registration.scope).pathname.length);
  return path === '' ? './' : decodeURIComponent(path);
}

/** Whether a response is exactly the published file. @param {Response} r @param {URL} url */
async function intact(r, url) {
  const want = HASHES[published(url)];
  if (!want) return false;
  const got = new Uint8Array(await crypto.subtle.digest('SHA-256', await r.clone().arrayBuffer()));
  return btoa(String.fromCharCode(...got)) === want;
}

/** @param {Request} request @param {URL} url @returns {Promise<Response|undefined>} */
async function fromCache(request, url) {
  const hit = await (await caches.open(VERSION)).match(request, { ignoreSearch: true });
  return hit && (await intact(hit, url)) ? hit : undefined;
}

/** @param {Request} request @param {URL} url */
async function fromNetwork(request, url) {
  const r = await fetch(request);
  // A published file that was missing or changed in the cache is put back.
  if (r.ok && (await intact(r, url))) await (await caches.open(VERSION)).put(published(url), r.clone());
  return r;
}
