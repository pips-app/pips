// Card links: where they point, and finding the card in an address.
import test from 'node:test';
import assert from 'node:assert/strict';

const { linkBase, cardInAddress, PUBLISHED } = await import('../../web/src/links.js');

test('links point at this copy of the app over https, else at the published one', () => {
  assert.equal(linkBase({ protocol: 'https:', origin: 'https://pips-app.github.io', pathname: '/pips/' }), 'https://pips-app.github.io/pips/');
  assert.equal(linkBase({ protocol: 'https:', origin: 'https://x.example', pathname: '/pips/index.html' }), 'https://x.example/pips/');
  assert.equal(linkBase({ protocol: 'http:', origin: 'http://127.0.0.1:8000', pathname: '/' }), PUBLISHED);
  assert.ok(PUBLISHED.startsWith('https://') && !PUBLISHED.includes('#'), 'what the core accepts as a base');
});

test('the card in an address, and the address without it', () => {
  assert.deepEqual(cardInAddress('https://a.example/pips/#RVhh'), { link: 'https://a.example/pips/#RVhh', rest: 'https://a.example/pips/' });
  assert.equal(cardInAddress('https://a.example/pips/'), null);
  assert.equal(cardInAddress('https://a.example/pips/#'), null, 'an empty fragment is no card');
});
