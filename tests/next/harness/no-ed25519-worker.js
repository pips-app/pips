// @ts-check
// The core's real worker in a browser without Ed25519 in WebCrypto: the
// key must then be kept as the old app kept it, and still sign the same.
const subtle = crypto.subtle;
const importKey = subtle.importKey.bind(subtle);
subtle.importKey = (/** @type {any[]} */ ...a) => (a[2]?.name === 'Ed25519'
  ? Promise.reject(new DOMException('no Ed25519 here, on purpose', 'NotSupportedError'))
  : /** @type {any} */ (importKey)(...a));
await import('/src/core/worker.js');
