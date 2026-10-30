import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUrl, matchPin, buildView, filterView, addPin, removePin, dropIndex } from '../src/model.js';

const tab = (id, windowId, url, extra = {}) => ({ id, windowId, url, title: '', active: false, ...extra });
const win = (id, left, tabs, extra = {}) => ({ id, left, type: 'normal', incognito: false, state: 'normal', tabs, ...extra });
const opts = { currentWindowId: 1, emptyTitle: 'New tab' };

test('normalizeUrl ignora hash, query, barra final y mayúsculas del host', () => {
  assert.deepEqual(normalizeUrl('HTTPS://Example.com/a/b/?q=1#top'), { origin: 'https://example.com', path: '/a/b' });
  assert.deepEqual(normalizeUrl('https://example.com/'), { origin: 'https://example.com', path: '' });
  assert.deepEqual(normalizeUrl('https://example.com:443/x'), { origin: 'https://example.com', path: '/x' });
});

test('normalizeUrl rechaza lo que no es http(s) o no parsea', () => {
  assert.equal(normalizeUrl('chrome://settings'), null);
  assert.equal(normalizeUrl('javascript:alert(1)'), null);
  assert.equal(normalizeUrl('file:///C:/a.txt'), null);
  assert.equal(normalizeUrl('not a url'), null);
  assert.equal(normalizeUrl(''), null);
});

test('matchPin: el pin de la raíz cubre el redirect de Gmail', () => {
  const pin = { url: 'https://mail.google.com/' };
  const tabs = [tab(7, 1, 'https://mail.google.com/mail/u/0/#inbox')];
  assert.equal(matchPin(pin, tabs, 1).id, 7);
});

test('matchPin: respeta el límite de segmento y el origen', () => {
  const pin = { url: 'https://example.com/docs' };
  assert.equal(matchPin(pin, [tab(1, 1, 'https://example.com/docs/api')], 1).id, 1);
  assert.equal(matchPin(pin, [tab(1, 1, 'https://example.com/docs-old')], 1), undefined);
  assert.equal(matchPin(pin, [tab(1, 1, 'https://other.com/docs')], 1), undefined);
  assert.equal(matchPin(pin, [tab(1, 1, 'http://example.com/docs')], 1), undefined);
});

test('matchPin: prefiere la ventana actual y luego la pestaña activa', () => {
  const pin = { url: 'https://example.com/' };
  const tabs = [
    tab(1, 2, 'https://example.com/a', { active: true }),
    tab(2, 1, 'https://example.com/b'),
    tab(3, 1, 'https://example.com/c', { active: true }),
  ];
  assert.equal(matchPin(pin, tabs, 1).id, 3);
  assert.equal(matchPin(pin, tabs, 2).id, 1);
  assert.equal(matchPin(pin, tabs, 99).id, 1);
});

test('buildView ordena ventanas por left y excluye popups e incognito', () => {
  const windows = [
    win(10, 1920, [tab(1, 10, 'https://b.com/')]),
    win(20, 0, [tab(2, 20, 'https://a.com/')]),
    win(30, 0, [tab(3, 30, 'https://c.com/')], { type: 'popup' }),
    win(40, 0, [tab(4, 40, 'https://d.com/')], { incognito: true }),
  ];
  const view = buildView(windows, [], { ...opts, currentWindowId: 10 });
  assert.deepEqual(view.windows.map((w) => [w.id, w.isCurrent]), [[20, false], [10, true]]);
});

test('buildView arma el título con título, url, pendingUrl y texto vacío', () => {
  const windows = [win(1, 0, [
    { id: 1, index: 0, title: 'Hola', url: 'https://a.com/' },
    { id: 2, index: 1, title: '', url: 'https://b.com/' },
    { id: 3, index: 2, title: '', url: '', pendingUrl: 'https://c.com/' },
    { id: 4, index: 3, title: '', url: '' },
  ])];
  const titles = buildView(windows, [], opts).windows[0].tabs.map((x) => x.title);
  assert.deepEqual(titles, ['Hola', 'https://b.com/', 'https://c.com/', 'New tab']);
});

test('buildView marca pinId, openTabId y minimizada', () => {
  const pins = [{ id: 'p1', url: 'https://a.com/x', title: 'A', favIconUrl: '' }, { id: 'p2', url: 'https://z.com/', title: 'Z', favIconUrl: '' }];
  const windows = [win(1, 0, [{ id: 5, index: 0, url: 'https://a.com/x/y', title: 'T' }], { state: 'minimized' })];
  const view = buildView(windows, pins, opts);
  assert.equal(view.windows[0].tabs[0].pinId, 'p1');
  assert.equal(view.windows[0].minimized, true);
  assert.deepEqual(view.pins.map((p) => [p.id, p.openTabId]), [['p1', 5], ['p2', null]]);
});

test('filterView busca en título y url sin distinguir mayúsculas y descarta ventanas vacías', () => {
  const windows = [
    win(1, 0, [{ id: 1, index: 0, title: 'Grafana', url: 'http://10.0.0.1:3000/' }]),
    win(2, 1, [{ id: 2, index: 0, title: 'Otro', url: 'https://example.com/' }]),
  ];
  const view = buildView(windows, [], opts);
  assert.deepEqual(filterView(view, 'GRAF').windows.map((w) => w.id), [1]);
  assert.deepEqual(filterView(view, 'example.com').windows.map((w) => w.id), [2]);
  assert.deepEqual(filterView(view, 'nada').windows, []);
  assert.equal(filterView(view, '  '), view);
});

test('addPin agrega sin hash, ignora no http(s) y no duplica la misma ruta', () => {
  const t1 = { url: 'https://a.com/x?q=1#frag', title: 'A', favIconUrl: 'https://a.com/i.png' };
  const once = addPin([], t1, 'id1');
  assert.deepEqual(once, [{ id: 'id1', url: 'https://a.com/x?q=1', title: 'A', favIconUrl: 'https://a.com/i.png' }]);
  assert.equal(addPin(once, { url: 'https://a.com/x/#otro', title: 'A' }, 'id2'), once);
  assert.equal(addPin(once, { url: 'chrome://settings', title: 'S' }, 'id3'), once);
  assert.equal(addPin(once, { url: 'https://a.com/x/y', title: 'Y' }, 'id4').length, 2);
});

test('removePin quita solo el id indicado', () => {
  assert.deepEqual(removePin([{ id: 'a' }, { id: 'b' }], 'a'), [{ id: 'b' }]);
});

test('dropIndex corrige el desplazamiento solo dentro de la misma ventana', () => {
  assert.equal(dropIndex({ fromWindowId: 1, fromIndex: 1, toWindowId: 1, insertBefore: 4 }), 3);
  assert.equal(dropIndex({ fromWindowId: 1, fromIndex: 3, toWindowId: 1, insertBefore: 1 }), 1);
  assert.equal(dropIndex({ fromWindowId: 1, fromIndex: 2, toWindowId: 1, insertBefore: 2 }), 2);
  assert.equal(dropIndex({ fromWindowId: 1, fromIndex: 1, toWindowId: 2, insertBefore: 4 }), 4);
});
