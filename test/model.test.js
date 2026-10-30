import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/settings.js';
import { normalizeUrl, matchPin, buildView, filterView, addPin, removePin, dropIndex, clickAction, duplicateTabIds, movePin, parseBackup } from '../src/model.js';

const { normalizeSettings, isDisabledHost } = globalThis.ztsSettings;

const tab = (id, windowId, url, extra = {}) => ({ id, windowId, url, title: '', active: false, ...extra });
const win = (id, left, tabs, extra = {}) => ({ id, left, type: 'normal', incognito: false, state: 'normal', tabs, ...extra });
const opts = { currentWindowId: 1, emptyTitle: 'New tab' };

test('normalizeUrl ignora hash, barra final y mayúsculas del host y conserva la query', () => {
  assert.deepEqual(normalizeUrl('HTTPS://Example.com/a/b/?q=1#top'), { host: 'example.com', path: '/a/b', search: '?q=1' });
  assert.deepEqual(normalizeUrl('https://example.com/'), { host: 'example.com', path: '', search: '' });
  assert.deepEqual(normalizeUrl('https://example.com:443/x'), { host: 'example.com', path: '/x', search: '' });
  assert.deepEqual(normalizeUrl('http://10.0.0.1:3000/x'), { host: '10.0.0.1:3000', path: '/x', search: '' });
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

test('matchPin: respeta el límite de segmento y el sitio, e ignora la query', () => {
  const pin = { url: 'https://example.com/docs' };
  assert.equal(matchPin(pin, [tab(1, 1, 'https://example.com/docs/api')], 1).id, 1);
  assert.equal(matchPin(pin, [tab(1, 1, 'https://example.com/docs?page=2')], 1).id, 1);
  assert.equal(matchPin(pin, [tab(1, 1, 'https://example.com/docs-old')], 1), undefined);
  assert.equal(matchPin(pin, [tab(1, 1, 'https://other.com/docs')], 1), undefined);
  assert.equal(matchPin(pin, [tab(1, 1, 'https://example.com:8443/docs')], 1), undefined);
});

test('matchPin: http y https del mismo sitio cuentan como uno (redirect a https)', () => {
  assert.equal(matchPin({ url: 'http://example.com/app' }, [tab(9, 1, 'https://example.com/app/login')], 1).id, 9);
});

test('matchPin: sin pestañas o con un pin que no es http(s) no hay coincidencia', () => {
  assert.equal(matchPin({ url: 'https://example.com/' }, [], 1), undefined);
  assert.equal(matchPin({ url: 'chrome://settings' }, [tab(1, 1, 'https://example.com/')], 1), undefined);
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

test('matchPin: con el mismo rango gana la primera pestaña', () => {
  const tabs = [tab(1, 2, 'https://example.com/a'), tab(2, 2, 'https://example.com/b')];
  assert.equal(matchPin({ url: 'https://example.com/' }, tabs, 1).id, 1);
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

test('buildView desempata ventanas con el mismo left por id y tolera left y tabs ausentes', () => {
  const windows = [
    { id: 30, type: 'normal', incognito: false, state: 'normal' },
    win(20, undefined, [tab(1, 20, 'https://a.com/')]),
    win(10, 0, []),
  ];
  const view = buildView(windows, [], opts);
  assert.deepEqual(view.windows.map((w) => [w.id, w.tabs.length]), [[10, 0], [20, 1], [30, 0]]);
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

test('buildView conserva index y discarded de cada pestaña', () => {
  const windows = [win(1, 0, [{ id: 5, index: 3, url: 'https://a.com/', title: 'A', discarded: true }])];
  const [first] = buildView(windows, [], opts).windows[0].tabs;
  assert.equal(first.index, 3);
  assert.equal(first.discarded, true);
});

test('buildView marca openTabId y minimizada', () => {
  const pins = [{ id: 'p1', url: 'https://a.com/x', title: 'A', favIconUrl: '' }, { id: 'p2', url: 'https://z.com/', title: 'Z', favIconUrl: '' }];
  const windows = [win(1, 0, [{ id: 5, index: 0, url: 'https://a.com/x/y', title: 'T' }], { state: 'minimized' })];
  const view = buildView(windows, pins, opts);
  assert.equal(view.windows[0].minimized, true);
  assert.deepEqual(view.pins.map((p) => [p.id, p.openTabId]), [['p1', 5], ['p2', null]]);
});

test('pinId solo se asigna con la misma dirección exacta, no con un pin ancestro', () => {
  const pins = [
    { id: 'root', url: 'https://a.com/', title: 'A', favIconUrl: '' },
    { id: 'video1', url: 'https://a.com/watch?v=1', title: 'V', favIconUrl: '' },
  ];
  const windows = [win(1, 0, [
    { id: 1, index: 0, url: 'https://a.com/', title: 'raíz' },
    { id: 2, index: 1, url: 'https://a.com/x', title: 'x' },
    { id: 3, index: 2, url: 'https://a.com/watch?v=1#t=5', title: 'v1' },
    { id: 4, index: 3, url: 'https://a.com/watch?v=2', title: 'v2' },
  ])];
  const ids = buildView(windows, pins, opts).windows[0].tabs.map((x) => x.pinId);
  assert.deepEqual(ids, ['root', null, 'video1', null]);
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

test('filterView también filtra los pins', () => {
  const pins = [
    { id: 'a', url: 'https://a.com/', title: 'Alfa', favIconUrl: '' },
    { id: 'b', url: 'https://b.com/', title: 'Beta', favIconUrl: '' },
  ];
  const view = buildView([win(1, 0, [])], pins, opts);
  assert.deepEqual(filterView(view, 'alf').pins.map((p) => p.id), ['a']);
});

test('addPin agrega sin hash, ignora no http(s) y no duplica la misma dirección', () => {
  const t1 = { url: 'https://a.com/x?q=1#frag', title: 'A', favIconUrl: 'https://a.com/i.png' };
  const once = addPin([], t1, 'id1');
  assert.deepEqual(once, [{ id: 'id1', url: 'https://a.com/x?q=1', title: 'A', favIconUrl: 'https://a.com/i.png' }]);
  assert.equal(addPin(once, { url: 'https://a.com/x/?q=1#otro', title: 'A' }, 'id2'), once);
  assert.equal(addPin(once, { url: 'chrome://settings', title: 'S' }, 'id3'), once);
  assert.equal(addPin(once, { url: 'https://a.com/x/y', title: 'Y' }, 'id4').length, 2);
});

test('addPin distingue direcciones que solo difieren en la query', () => {
  const first = addPin([], { url: 'https://youtube.com/watch?v=1', title: 'Uno' }, 'a');
  assert.equal(addPin(first, { url: 'https://youtube.com/watch?v=2', title: 'Dos' }, 'b').length, 2);
});

test('addPin usa la url como título si la pestaña no tiene', () => {
  assert.equal(addPin([], { url: 'https://a.com/x', title: '' }, 'id')[0].title, 'https://a.com/x');
});

test('removePin quita solo el id indicado', () => {
  assert.deepEqual(removePin([{ id: 'a' }, { id: 'b' }], 'a'), [{ id: 'b' }]);
});

test('dropIndex corrige el desplazamiento solo dentro de la misma ventana', () => {
  assert.equal(dropIndex({ fromWindowId: 1, fromIndex: 1, toWindowId: 1, insertBefore: 4 }), 3);
  assert.equal(dropIndex({ fromWindowId: 1, fromIndex: 3, toWindowId: 1, insertBefore: 1 }), 1);
  assert.equal(dropIndex({ fromWindowId: 1, fromIndex: 2, toWindowId: 1, insertBefore: 2 }), 2);
  assert.equal(dropIndex({ fromWindowId: 1, fromIndex: 2, toWindowId: 1, insertBefore: 3 }), 2);
  assert.equal(dropIndex({ fromWindowId: 1, fromIndex: 1, toWindowId: 2, insertBefore: 4 }), 4);
});

test('normalizeSettings completa los valores ausentes o inválidos con los defaults', () => {
  const defaults = { side: 'left', mode: 'hover', width: 340, opacity: 100, accent: '', zone: 32, speed: 'normal', density: 'comfortable', disabledHosts: [] };
  assert.deepEqual(normalizeSettings(undefined), defaults);
  assert.deepEqual(
    normalizeSettings({ side: 'right', mode: 'off', width: 440, accent: '#A1b2C3', opacity: 70, zone: 4, speed: 'slow', density: 'compact', disabledHosts: ['a.com'] }),
    { side: 'right', mode: 'off', width: 440, accent: '#A1b2C3', opacity: 70, zone: 4, speed: 'slow', density: 'compact', disabledHosts: ['a.com'] },
  );
  assert.deepEqual(
    normalizeSettings({ side: 'top', mode: 5, width: 9999, accent: 'red', opacity: 10, zone: 7, speed: 'toString', density: 'huge', disabledHosts: 'a.com' }),
    defaults,
  );
});

test('normalizeSettings limpia disabledHosts: minúsculas, sin duplicados ni valores que no son un host', () => {
  const hosts = normalizeSettings({ disabledHosts: [' Mail.Google.com ', 'mail.google.com', 'x y', '', 5, 'a/b', '-bad', 'ok-1.io'] }).disabledHosts;
  assert.deepEqual(hosts, ['mail.google.com', 'ok-1.io']);
  assert.equal(normalizeSettings({ disabledHosts: Array.from({ length: 300 }, (_, i) => `h${i}.com`) }).disabledHosts.length, 200);
});

test('isDisabledHost cubre el host y sus subdominios, no hosts que solo terminan igual', () => {
  const hosts = ['google.com'];
  assert.equal(isDisabledHost('google.com', hosts), true);
  assert.equal(isDisabledHost('mail.google.com', hosts), true);
  assert.equal(isDisabledHost('notgoogle.com', hosts), false);
  assert.equal(isDisabledHost('google.com.evil.io', hosts), false);
  assert.equal(isDisabledHost('a.com', []), false);
});

test('buildView expone audible y silenciada', () => {
  const windows = [win(1, 0, [{ id: 1, index: 0, url: 'https://a.com/', title: 'A', audible: true, mutedInfo: { muted: true } }, { id: 2, index: 1, url: 'https://b.com/', title: 'B' }])];
  const [a, b] = buildView(windows, [], opts).windows[0].tabs;
  assert.deepEqual([a.audible, a.muted, b.audible, b.muted], [true, true, false, false]);
});

test('clickAction: misma ventana se queda; otra ventana trae, salvo con Shift o si era su única pestaña', () => {
  const base = { tabWindowId: 2, windowTabCount: 3, hereWindowId: 1, shift: false };
  assert.equal(clickAction({ ...base, tabWindowId: 1 }), 'stay');
  assert.equal(clickAction(base), 'bring');
  assert.equal(clickAction({ ...base, shift: true }), 'go');
  assert.equal(clickAction({ ...base, windowTabCount: 1 }), 'go');
});

test('duplicateTabIds conserva la activa (o la primera) de cada grupo y ignora lo que no es http(s)', () => {
  const view = buildView([
    win(1, 0, [tab(1, 1, 'https://a.com/x#t'), tab(2, 1, 'chrome://settings'), tab(3, 1, 'chrome://settings')]),
    win(2, 1, [tab(4, 2, 'https://a.com/x', { active: true }), tab(5, 2, 'https://a.com/x?q=1'), tab(6, 2, 'https://a.com/x/')]),
  ], [], opts);
  assert.deepEqual(duplicateTabIds(view).sort(), [1, 6]);
  assert.deepEqual(duplicateTabIds(buildView([win(1, 0, [tab(1, 1, 'https://a.com/')])], [], opts)), []);
});

test('movePin reordena delante de otro pin, al final con null, y no cambia nada si el destino no existe', () => {
  const pins = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(movePin(pins, 'c', 'a').map((p) => p.id), ['c', 'a', 'b']);
  assert.deepEqual(movePin(pins, 'a', null).map((p) => p.id), ['b', 'c', 'a']);
  assert.equal(movePin(pins, 'a', 'b'), pins);
  assert.equal(movePin(pins, 'a', 'zzz'), pins);
  assert.equal(movePin(pins, 'zzz', 'a'), pins);
});

test('parseBackup acepta solo copias de la extensión y descarta pins inválidos', () => {
  const ns = globalThis.ztsSettings.normalizeSettings;
  assert.equal(parseBackup('no json', ns), null);
  assert.equal(parseBackup('{"app":"otra","pins":[]}', ns), null);
  assert.equal(parseBackup('{"app":"tab-shelf"}', ns), null);
  const got = parseBackup(JSON.stringify({
    app: 'tab-shelf',
    pins: [{ url: 'https://a.com/', title: 'A', favIconUrl: 'javascript:alert(1)' }, { url: 'chrome://x' }, { title: 'sin url' }, null, { url: 'https://b.com/', title: 5, favIconUrl: 'https://b.com/i.png' }],
    settings: { side: 'right', width: 1 },
  }), ns);
  assert.deepEqual(got.pins.map((p) => [p.url, p.title, p.favIconUrl]), [['https://a.com/', 'A', ''], ['https://b.com/', '', 'https://b.com/i.png']]);
  assert.equal(got.settings.side, 'right');
  assert.equal(got.settings.width, 340);
});
