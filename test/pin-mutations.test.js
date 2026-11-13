import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import * as model from '../src/model.js';
import * as sharedOrder from '../src/shared-order.js';

const source = (await readFile(new URL('../background.js', import.meta.url), 'utf8'))
  .replace(/^import .* from ['"]\.\/src\/model\.js['"];?\r?\n/m, '')
  .replace(/^import ['"]\.\/src\/settings\.js['"];?\r?\n/m, '')
  .replace(/^import .* from ['"]\.\/src\/shared-order\.js['"];?\r?\n/m, '');
const settingsSource = await readFile(new URL('../src/settings.js', import.meta.url), 'utf8');
const pin = (id, url) => ({ id, url, title: id, favIconUrl: '' });

function background({ pins = [], save, read, readTab, storage, session = {}, tabs = [] } = {}) {
  const listeners = {};
  const local = storage ?? { pins: structuredClone(pins) };
  const writes = [];
  const created = [];
  const activated = [];
  const event = (name) => ({ addListener: (listener) => (listeners[name] ??= []).push(listener) });
  const chrome = {
    sidePanel: { setPanelBehavior: async () => {} },
    runtime: {
      onInstalled: event('installed'),
      onStartup: event('startup'),
      onMessage: event('message'),
    },
    storage: {
      local: {
        get: async () => {
          await read?.();
          return structuredClone(local);
        },
        set: async (values) => {
          writes.push(structuredClone(values));
          await save?.(structuredClone(values));
          Object.assign(local, structuredClone(values));
        },
      },
      session: {
        get: async () => structuredClone(session),
        set: async (values) => Object.assign(session, structuredClone(values)),
      },
    },
    tabs: {
      onActivated: event('activated'), onAttached: event('attached'), onRemoved: event('tabRemoved'), onReplaced: event('replaced'), onUpdated: event('updated'),
      sendMessage: async () => {},
      get: async (id) => {
        await readTab?.(id);
        const tab = tabs.find((tab) => tab.id === id);
        if (!tab) throw new Error('No tab');
        return structuredClone(tab);
      },
      query: async () => structuredClone(tabs),
      create: async (values) => {
        await setImmediate();
        const tab = { id: 100 + created.length, ...structuredClone(values) };
        created.push(tab);
        tabs.push(tab);
        return structuredClone(tab);
      },
      update: async (id, values) => {
        activated.push(id);
        const tab = tabs.find((tab) => tab.id === id);
        if (!tab) throw new Error('No tab');
        Object.assign(tab, values);
        return structuredClone(tab);
      },
    },
    windows: { onRemoved: event('removed'), update: async () => {} },
    commands: { onCommand: event('command') },
  };
  runInNewContext(`${settingsSource}\n${source}`, { chrome, console: { error() {} }, URL, crypto: { randomUUID }, ...model, ...sharedOrder });
  return {
    get pins() { return local.pins; },
    get settings() { return local.settings; },
    writes,
    session, created, activated,
    tabEvent: async (name, ...args) => {
      for (const listener of listeners[name] ?? []) await listener(...args);
      await setImmediate();
    },
    request: (pins) => {
      let respond;
      const response = new Promise((resolve) => { respond = resolve; });
      const keepAlive = listeners.message[0]({ pins }, {}, (value) => respond(structuredClone(value)));
      assert.equal(keepAlive, true, 'el handler mantiene abierto el canal de respuesta de pins');
      return response;
    },
  };
}

test('add persiste el pin desde un mensaje sin pestaña emisora', async () => {
  const app = background();
  assert.deepEqual(await app.request({ op: 'add', tab: { url: 'https://example.com/docs#top', title: 'Docs' } }), { ok: true });
  assert.deepEqual(app.pins.map(({ id, ...value }) => value), [
    { url: 'https://example.com/docs', title: 'Docs', favIconUrl: '' },
  ]);
  assert.match(app.pins[0].id, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i);
});

test('remove conserva los demás pins', async () => {
  const app = background({ pins: [pin('a', 'https://a.test/'), pin('b', 'https://b.test/')] });
  assert.deepEqual(await app.request({ op: 'remove', id: 'a' }), { ok: true });
  assert.deepEqual(app.pins, [{ id: 'b', url: 'https://b.test/', title: 'b', favIconUrl: '' }]);
});

test('move inserta delante del destino y permite mover al final', async () => {
  const app = background({ pins: [pin('a', 'https://a.test/'), pin('b', 'https://b.test/'), pin('c', 'https://c.test/')] });
  await app.request({ op: 'move', id: 'c', beforeId: 'a' });
  assert.deepEqual(app.pins.map((value) => value.id), ['c', 'a', 'b']);
  await app.request({ op: 'move', id: 'c', beforeId: null });
  assert.deepEqual(app.pins.map((value) => value.id), ['a', 'b', 'c']);
});

test('import agrega solo direcciones nuevas y devuelve la cantidad persistida', async () => {
  const app = background({ pins: [pin('a', 'https://a.test/')] });
  const response = await app.request({ op: 'import', text: JSON.stringify({
    app: 'tab-shelf',
    pins: [
      { url: 'http://a.test/#duplicate' },
      { url: 'https://b.test/#first', title: 'B' },
      { url: 'https://b.test/#duplicate' },
      { url: 'chrome://settings' },
    ],
    settings: { side: 'right', width: 999, disabledHosts: [' Example.COM ', 'example.com'] },
  }) });
  assert.deepEqual(response, { ok: true, added: 1 });
  assert.deepEqual(app.pins.map(({ id, ...value }) => value), [
    { url: 'https://a.test/', title: 'a', favIconUrl: '' },
    { url: 'https://b.test/', title: 'B', favIconUrl: '' },
  ]);
  assert.deepEqual(app.settings, {
    side: 'right', mode: 'hover', width: 340, opacity: 100, accent: '', zone: 32,
    speed: 'normal', density: 'comfortable', disabledHosts: ['example.com'],
  });
  assert.equal(app.writes.length, 1);
  assert.deepEqual(Object.keys(app.writes[0]).sort(), ['pins', 'settings']);
});

test('import vacío conserva los pins y confirma cero agregados', async () => {
  const app = background({ pins: [pin('a', 'https://a.test/')] });
  assert.deepEqual(await app.request({ op: 'import', text: '{"app":"tab-shelf","pins":[]}' }), { ok: true, added: 0 });
  assert.deepEqual(app.pins, [{ id: 'a', url: 'https://a.test/', title: 'a', favIconUrl: '' }]);
});

test('import inválido informa el error sin escribir pins ni ajustes', async () => {
  for (const text of ['{', '{"app":"other","pins":[]}', '{"app":"tab-shelf","pins":null}']) {
    const app = background({ pins: [pin('a', 'https://a.test/')] });
    const response = await app.request({ op: 'import', text });
    assert.equal(response.ok, false);
    assert.equal(typeof response.error, 'string');
    assert.notEqual(response.error, '');
    assert.deepEqual(app.writes, []);
    assert.deepEqual(app.pins, [{ id: 'a', url: 'https://a.test/', title: 'a', favIconUrl: '' }]);
  }
});

test('step calcula cada movimiento concurrente sobre el orden ya persistido', async () => {
  const app = background({ pins: [pin('a', 'https://a.test/'), pin('b', 'https://b.test/'), pin('c', 'https://c.test/')] });
  assert.deepEqual(await Promise.all([
    app.request({ op: 'step', id: 'c', step: -1 }),
    app.request({ op: 'step', id: 'c', step: -1 }),
  ]), [{ ok: true, position: 2 }, { ok: true, position: 1 }]);
  assert.deepEqual(app.pins.map((value) => value.id), ['c', 'a', 'b']);
});

test('step en los extremos conserva el orden y devuelve cero', async () => {
  const app = background({ pins: [pin('a', 'https://a.test/'), pin('b', 'https://b.test/')] });
  assert.deepEqual(await app.request({ op: 'step', id: 'a', step: -1 }), { ok: true, position: 0 });
  assert.deepEqual(await app.request({ op: 'step', id: 'b', step: 1 }), { ok: true, position: 0 });
  assert.deepEqual(app.pins.map((value) => value.id), ['a', 'b']);
});

test('dos add concurrentes conservan ambas escrituras', async () => {
  let release;
  let started;
  const saving = new Promise((resolve) => { started = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  let writes = 0;
  const app = background({ save: async () => {
    if (++writes === 1) { started(); await gate; }
  } });
  const first = app.request({ op: 'add', tab: { url: 'https://a.test/' } });
  await saving;
  const second = app.request({ op: 'add', tab: { url: 'https://b.test/' } });
  await setImmediate();
  release();
  assert.deepEqual(await Promise.all([first, second]), [{ ok: true }, { ok: true }]);
  assert.deepEqual(app.pins.map((value) => value.url), ['https://a.test/', 'https://b.test/']);
});

test('el ack de pins espera a que termine storage.set', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const app = background({ save: () => gate });
  const responses = [];
  const request = app.request({ op: 'add', tab: { url: 'https://a.test/' } }).then((response) => responses.push(response));
  await setImmediate();
  assert.deepEqual(responses, []);
  release();
  await request;
  assert.deepEqual(responses, [{ ok: true }]);
  assert.deepEqual(app.pins.map((value) => value.url), ['https://a.test/']);
});

test('un error de lectura se informa y no bloquea el siguiente comando', async () => {
  let reads = 0;
  const app = background({ read: async () => {
    if (++reads === 1) throw new Error('storage read unavailable');
  } });
  assert.deepEqual(await app.request({ op: 'add', tab: { url: 'https://a.test/' } }), { ok: false, error: 'storage read unavailable' });
  assert.deepEqual(app.writes, []);
  assert.deepEqual(await app.request({ op: 'add', tab: { url: 'https://b.test/' } }), { ok: true });
  assert.deepEqual(app.pins.map((value) => value.url), ['https://b.test/']);
});

test('los comandos inválidos devuelven error sin escribir', async () => {
  const app = background({ pins: [pin('a', 'https://a.test/')] });
  for (const [command, error] of [
    [{ op: 'unknown' }, 'Invalid pin operation'],
    [{ op: 'add', tab: { url: 42 } }, 'Invalid pin'],
    [{ op: 'remove', id: 42 }, 'Invalid pin ID'],
    [{ op: 'move', id: 'a', beforeId: 42 }, 'Invalid destination'],
    [{ op: 'step', id: 'a', step: 0 }, 'Invalid pin step'],
  ]) {
    assert.deepEqual(await app.request(command), { ok: false, error });
  }
  assert.deepEqual(app.writes, []);
  assert.deepEqual(app.pins, [{ id: 'a', url: 'https://a.test/', title: 'a', favIconUrl: '' }]);
});

test('un worker recreado conserva los pins persistidos por el anterior', async () => {
  const storage = { pins: [pin('a', 'https://a.test/')], settings: { side: 'right' } };
  const first = background({ storage });
  assert.deepEqual(await first.request({ op: 'add', tab: { url: 'https://b.test/' } }), { ok: true });
  const restarted = background({ storage });
  assert.deepEqual(await restarted.request({ op: 'add', tab: { url: 'https://c.test/' } }), { ok: true });
  assert.deepEqual(restarted.pins.map((value) => value.url), ['https://a.test/', 'https://b.test/', 'https://c.test/']);
  assert.deepEqual(restarted.settings, { side: 'right' });
});

test('un error de storage se informa y no bloquea la siguiente mutación', async () => {
  let writes = 0;
  const app = background({ save: async () => {
    if (++writes === 1) throw new Error('storage unavailable');
  } });
  assert.deepEqual(await app.request({ op: 'add', tab: { url: 'https://a.test/' } }), { ok: false, error: 'storage unavailable' });
  assert.deepEqual(app.pins, []);
  assert.deepEqual(await app.request({ op: 'add', tab: { url: 'https://b.test/' } }), { ok: true });
  assert.deepEqual(app.pins.map((value) => value.url), ['https://b.test/']);
});

test('add asocia la pestaña al id persistido del pin', async () => {
  const app = background();
  await app.request({ op: 'add', tab: { id: 20, windowId: 1, url: 'https://a.test/' } });
  assert.deepEqual([Object.keys(app.session.pinTabs ?? {}).length, app.session.pinTabs?.[app.pins[0].id]], [1, 20]);
});

test('dos open concurrentes del mismo pin crean una sola pestaña', async () => {
  const app = background({ pins: [pin('a', 'https://a.test/')], session: { pinTabs: { a: null } } });
  const responses = await Promise.all([
    app.request({ op: 'open', id: 'a', windowId: 1 }),
    app.request({ op: 'open', id: 'a', windowId: 1 }),
  ]);
  assert.deepEqual(responses, [{ ok: true, tabId: 100 }, { ok: true, tabId: 100 }]);
  assert.deepEqual(app.created.map(({ id, url, windowId }) => ({ id, url, windowId })), [{ id: 100, url: 'https://a.test/', windowId: 1 }]);
  assert.deepEqual(app.session.pinTabs, { a: 100 });
});

test('open conserva la identidad del pin después de navegar a otra dirección', async () => {
  const tabs = [{ id: 20, windowId: 1, url: 'https://elsewhere.test/page' }];
  const app = background({ pins: [pin('a', 'https://a.test/')], tabs, session: { pinTabs: { a: 20 } } });
  assert.deepEqual(await app.request({ op: 'open', id: 'a', windowId: 1 }), { ok: true, tabId: 20 });
  assert.deepEqual([app.created, app.activated, app.session.pinTabs], [[], [20], { a: 20 }]);
});

test('cerrar una pestaña conserva el pin y marca su asociación como null', async () => {
  const app = background({ pins: [pin('a', 'https://a.test/')], session: { pinTabs: { a: 20, b: 30 } } });
  await app.tabEvent('tabRemoved', 20, { windowId: 1, isWindowClosing: false });
  assert.deepEqual([app.pins, app.session.pinTabs], [[pin('a', 'https://a.test/')], { a: null, b: 30 }]);
});

test('onReplaced transfiere la identidad al nuevo tabId', async () => {
  const app = background({ pins: [pin('a', 'https://a.test/')], session: { pinTabs: { a: 20, b: 30 } } });
  await app.tabEvent('replaced', 21, 20);
  assert.deepEqual(app.session.pinTabs, { a: 21, b: 30 });
});

test('remove elimina la asociación del pin sin borrar las demás', async () => {
  const app = background({ pins: [pin('a', 'https://a.test/'), pin('b', 'https://b.test/')], session: { pinTabs: { a: 20, b: 30 } } });
  await app.request({ op: 'remove', id: 'a' });
  assert.deepEqual(app.session.pinTabs, { b: 30 });
});

test('un worker reiniciado recupera la identidad desde la sesión compartida', async () => {
  const storage = { pins: [] };
  const session = {};
  const tabs = [{ id: 20, windowId: 1, url: 'https://a.test/' }];
  const first = background({ storage, session, tabs });
  await first.request({ op: 'add', tab: tabs[0] });
  tabs[0].url = 'https://elsewhere.test/';
  const restarted = background({ storage, session, tabs });
  assert.deepEqual(await restarted.request({ op: 'open', id: storage.pins[0].id, windowId: 1 }), { ok: true, tabId: 20 });
  assert.deepEqual([restarted.created, restarted.activated], [[], [20]]);
});

test('reconcile adopta un candidato preexistente y conserva su identidad al navegar', async () => {
  const pins = [pin('a', 'https://a.test/docs')];
  const tabs = [{ id: 20, windowId: 1, url: 'https://a.test/docs/app' }];
  const app = background({ pins, tabs, session: {} });
  assert.deepEqual(await app.request({ op: 'reconcile', matches: [{ id: 'a', tabId: 20 }] }), { ok: true });
  assert.deepEqual(app.session.pinTabs, { a: 20 });
  tabs[0].url = 'https://elsewhere.test/navigated';
  const view = model.buildView([{ id: 1, type: 'normal', left: 0, tabs }], pins, {
    currentWindowId: 1, emptyTitle: 'New tab', pinTabs: app.session.pinTabs,
  });
  assert.deepEqual([view.pins[0].openTabId, view.windows[0].tabs[0].pinId], [20, 'a']);
  assert.deepEqual(await app.request({ op: 'open', id: 'a', windowId: 1 }), { ok: true, tabId: 20 });
  assert.deepEqual(app.created, []);
});

test('dos reconciliaciones concurrentes no adjudican la misma pestaña a pins distintos', async () => {
  const app = background({
    pins: [pin('a', 'https://a.test/docs?account=first'), pin('b', 'https://a.test/docs?account=second')],
    tabs: [{ id: 20, windowId: 1, url: 'https://a.test/docs/app' }],
    session: {},
  });
  assert.deepEqual(await Promise.all([
    app.request({ op: 'reconcile', matches: [{ id: 'a', tabId: 20 }] }),
    app.request({ op: 'reconcile', matches: [{ id: 'b', tabId: 20 }] }),
  ]), [{ ok: true }, { ok: true }]);
  assert.deepEqual(app.session.pinTabs, { a: 20 });
});

test('open fallido durante onReplaced no crea otra pestaña y permite reutilizar el reemplazo', async () => {
  let started;
  let rejectRead;
  const reading = new Promise((resolve) => { started = resolve; });
  const gate = new Promise((_resolve, reject) => { rejectRead = reject; });
  const app = background({
    pins: [pin('a', 'https://a.test/')],
    session: { pinTabs: { a: 20 } },
    tabs: [{ id: 21, windowId: 1, url: 'https://a.test/replaced' }],
    readTab: async (id) => {
      if (id === 20) { started(); await gate; }
    },
  });
  const opening = app.request({ op: 'open', id: 'a', windowId: 1 });
  await reading;
  const replacing = app.tabEvent('replaced', 21, 20);
  rejectRead(new Error('Tab replaced'));
  assert.deepEqual(await opening, { ok: false, error: 'Tab replaced' });
  await replacing;
  assert.deepEqual([app.created, app.session.pinTabs], [[], { a: 21 }]);
  assert.deepEqual(await app.request({ op: 'open', id: 'a', windowId: 1 }), { ok: true, tabId: 21 });
  assert.deepEqual([app.created, app.activated], [[], [21]]);
});
