import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { setImmediate } from 'node:timers/promises';
import * as model from '../src/model.js';
import * as sharedOrder from '../src/shared-order.js';

const source = (await readFile(new URL('../background.js', import.meta.url), 'utf8'))
  .replace(/^import .* from ['"]\.\/src\/(?:model|shared-order)\.js['"];?\r?\n/gm, '')
  .replace(/^import ['"]\.\/src\/settings\.js['"];?\r?\n/m, '');
const settingsSource = await readFile(new URL('../src/settings.js', import.meta.url), 'utf8');

function background({ tabs, failCreate = false, closeBeforeMove, session = {} }) {
  const listeners = {};
  const state = structuredClone(tabs);
  const windows = new Set(tabs.map((tab) => tab.windowId));
  const calls = [];
  const local = { pins: [] };
  let nextId = 100;
  let focusedWindow = 1;
  const event = (name) => ({ addListener: (listener) => (listeners[name] ??= []).push(listener) });
  const getTab = (id) => {
    const tab = state.find((item) => item.id === id);
    if (!tab) throw new Error('No tab with id: ' + id);
    return tab;
  };
  const storage = (values) => ({
    get: async () => structuredClone(values),
    set: async (update) => Object.assign(values, structuredClone(update)),
  });
  const chrome = {
    sidePanel: { setPanelBehavior: async () => {} },
    runtime: {
      id: 'test',
      onInstalled: event('installed'),
      onStartup: event('startup'),
      onMessage: event('message'),
    },
    storage: { local: storage(local), session: storage(session) },
    tabs: {
      onActivated: event('activated'),
      onRemoved: event('tabRemoved'),
      onReplaced: event('replaced'),
      onCreated: event('created'),
      onMoved: event('moved'),
      onAttached: event('attached'),
      onDetached: event('detached'),
      sendMessage: async () => {},
      get: async (id) => structuredClone(getTab(id)),
      query: async (query) => {
        const result = structuredClone(state.filter((tab) =>
          (query.windowId === undefined || tab.windowId === query.windowId)
          && (query.active === undefined || tab.active === query.active)));
        await setImmediate();
        return result;
      },
      create: async (properties) => {
        calls.push(['create', properties.windowId]);
        if (failCreate) throw new Error('Cannot create tab');
        if (!windows.has(properties.windowId)) throw new Error('No window');
        const tab = { id: nextId++, windowId: properties.windowId, active: properties.active ?? true, url: new URL(properties.url ?? 'chrome://newtab/', 'chrome-extension://test/').href };
        state.push(tab);
        return structuredClone(tab);
      },
      move: async (id, properties) => {
        calls.push(['move', id, properties.windowId]);
        if (closeBeforeMove !== undefined) {
          state.splice(state.findIndex((tab) => tab.id === closeBeforeMove), 1);
          closeBeforeMove = undefined;
        }
        const tab = getTab(id);
        if (!windows.has(properties.windowId)) throw new Error('No window');
        const origin = tab.windowId;
        tab.windowId = properties.windowId;
        tab.index = properties.index;
        if (!state.some((item) => item.windowId === origin)) windows.delete(origin);
        return structuredClone(tab);
      },
      update: async (id, properties) => {
        const tab = getTab(id);
        if (properties.active) {
          for (const item of state) if (item.windowId === tab.windowId) item.active = false;
        }
        Object.assign(tab, properties);
        return structuredClone(tab);
      },
    },
    windows: {
      onRemoved: event('windowRemoved'),
      update: async (id, properties) => {
        if (!windows.has(id)) throw new Error('No window');
        if (properties.focused) focusedWindow = id;
      },
    },
    commands: { onCommand: event('command') },
  };
  runInNewContext(`${settingsSource}\n${source}`, { chrome, console, ...model, ...sharedOrder });
  return {
    state,
    windows,
    calls,
    get focusedWindow() { return focusedWindow; },
    async command(command) {
      let response;
      let responded = false;
      let resolveResponse;
      const pending = new Promise((resolve) => { resolveResponse = resolve; });
      const keepAlive = listeners.message[0]({ tabs: command }, {}, (value) => {
        response = structuredClone(value);
        responded = true;
        resolveResponse(response);
      });
      if (responded) return response;
      if (keepAlive === true) return pending;
      return undefined;
    },
  };
}

const tabs = [
  { id: 10, windowId: 1, active: true, url: 'https://destination.test/' },
  { id: 20, windowId: 2, active: true, url: 'https://remote.test/' },
  { id: 21, windowId: 2, active: false, url: 'https://other.test/' },
];

test('activar una pestaña remota traslada la pestaña real y la activa en destino', async () => {
  const app = background({ tabs });
  const response = await app.command({ op: 'activate', tabId: 20, windowId: 1, shift: false });
  assert.deepEqual({ response, tab: app.state.find((tab) => tab.id === 20), focused: app.focusedWindow }, {
    response: { ok: true },
    tab: { id: 20, windowId: 1, active: true, url: 'https://remote.test/', index: -1 },
    focused: 1,
  });
});

test('shift activa la pestaña remota y enfoca su ventana de origen', async () => {
  const app = background({ tabs });
  const response = await app.command({ op: 'activate', tabId: 21, windowId: 1, shift: true });
  assert.deepEqual({ response, tab: app.state.find((tab) => tab.id === 21), focused: app.focusedWindow }, {
    response: { ok: true },
    tab: { id: 21, windowId: 2, active: true, url: 'https://other.test/' },
    focused: 2,
  });
});

test('activar la última pestaña crea una auxiliar antes de moverla y conserva el origen', async () => {
  const app = background({ tabs: tabs.slice(0, 2) });
  const response = await app.command({ op: 'activate', tabId: 20, windowId: 1, shift: false });
  assert.deepEqual({ response, calls: app.calls, originOpen: app.windows.has(2), destination: app.state.find((tab) => tab.id === 20)?.windowId }, {
    response: { ok: true }, calls: [['create', 2], ['move', 20, 1]], originOpen: true, destination: 1,
  });
});

test('move también conserva la ventana al trasladar su última pestaña', async () => {
  const app = background({ tabs: tabs.slice(0, 2) });
  const response = await app.command({ op: 'move', tabId: 20, windowId: 1 });
  assert.deepEqual({ response, calls: app.calls, originOpen: app.windows.has(2), destination: app.state.find((tab) => tab.id === 20)?.windowId }, {
    response: { ok: true }, calls: [['create', 2], ['move', 20, 1]], originOpen: true, destination: 1,
  });
});

test('move conserva el origen si otra pestaña se cierra después de consultar la ventana', async () => {
  const app = background({
    tabs: tabs.map((tab) => ({ ...tab, active: tab.id !== 20 })),
    closeBeforeMove: 21,
  });
  const response = await app.command({ op: 'move', tabId: 20, windowId: 1 });
  assert.deepEqual({ response, originOpen: app.windows.has(2), tab: app.state.find((tab) => tab.id === 20) }, {
    response: { ok: true },
    originOpen: true,
    tab: { id: 20, windowId: 1, active: false, url: 'https://remote.test/', index: -1 },
  });
});

test('si falla la creación auxiliar devuelve el error sin mover la última pestaña', async () => {
  const app = background({ tabs: tabs.slice(0, 2), failCreate: true });
  const response = await app.command({ op: 'activate', tabId: 20, windowId: 1, shift: false });
  assert.deepEqual({ response, calls: app.calls, tabs: app.state }, {
    response: { ok: false, error: 'Cannot create tab' }, calls: [['create', 2]], tabs: tabs.slice(0, 2),
  });
});

test('dos traslados simultáneos se serializan y conservan las pestañas y la ventana vacía', async () => {
  const app = background({ tabs });
  const responses = await Promise.all([
    app.command({ op: 'move', tabId: 20, windowId: 1 }),
    app.command({ op: 'move', tabId: 21, windowId: 1 }),
  ]);
  assert.deepEqual({ responses, calls: app.calls, ids: app.state.map((tab) => tab.id).sort((a, b) => a - b), origins: app.state.filter((tab) => tab.windowId === 2).map((tab) => tab.id), originOpen: app.windows.has(2) }, {
    responses: [{ ok: true }, { ok: true }], calls: [['create', 2], ['move', 20, 1], ['move', 21, 1]], ids: [10, 20, 21, 100], origins: [100], originOpen: true,
  });
});

test('un error no impide ejecutar el siguiente comando en la cola', async () => {
  const app = background({ tabs: tabs.slice(0, 2), failCreate: true });
  const responses = await Promise.all([
    app.command({ op: 'move', tabId: 20, windowId: 1 }),
    app.command({ op: 'activate', tabId: 20, windowId: 1, shift: true }),
  ]);
  assert.deepEqual({ responses, focused: app.focusedWindow }, {
    responses: [{ ok: false, error: 'Cannot create tab' }, { ok: true }], focused: 2,
  });
});

test('move reutiliza la auxiliar registrada en su ventana de origen', async () => {
  const app = background({
    tabs: [...tabs.slice(0, 2), { id: 30, windowId: 2, active: false, url: 'chrome-extension://test/panel.html' }],
    session: { placeholders: [30] },
  });
  const response = await app.command({ op: 'move', tabId: 20, windowId: 1 });
  assert.deepEqual({ response, calls: app.calls, origin: app.state.filter((tab) => tab.windowId === 2), originOpen: app.windows.has(2) }, {
    response: { ok: true }, calls: [['move', 20, 1]],
    origin: [{ id: 30, windowId: 2, active: false, url: 'chrome-extension://test/panel.html' }], originOpen: true,
  });
});

test('una auxiliar navegada se trata como pestaña normal y recibe el foco del origen', async () => {
  const app = background({
    tabs: [...tabs.slice(0, 2), { id: 30, windowId: 2, active: false, url: 'https://navigated.test/' }],
    session: { placeholders: [30] },
  });
  const response = await app.command({ op: 'move', tabId: 20, windowId: 1 });
  assert.deepEqual({ response, calls: app.calls, origin: app.state.filter((tab) => tab.windowId === 2), originOpen: app.windows.has(2) }, {
    response: { ok: true }, calls: [['create', 2], ['move', 20, 1]],
    origin: [
      { id: 30, windowId: 2, active: true, url: 'https://navigated.test/' },
      { id: 100, windowId: 2, active: false, url: 'about:blank#tab-shelf-placeholder' },
    ], originOpen: true,
  });
});

test('move crea una auxiliar marcada para reconocerla después de perder la sesión', async () => {
  const app = background({ tabs: tabs.slice(0, 2) });
  const response = await app.command({ op: 'move', tabId: 20, windowId: 1 });
  assert.deepEqual({ response, origin: app.state.filter((tab) => tab.windowId === 2) }, {
    response: { ok: true },
    origin: [{ id: 100, windowId: 2, active: false, url: 'about:blank#tab-shelf-placeholder' }],
  });
});

test('move reutiliza una auxiliar marcada después de perder la sesión', async () => {
  const app = background({
    session: {},
    tabs: [
      ...tabs.slice(0, 2).map((tab) => ({ ...tab, active: tab.id !== 20 })),
      { id: 30, windowId: 2, active: false, url: 'about:blank#tab-shelf-placeholder' },
    ],
  });
  const response = await app.command({ op: 'move', tabId: 20, windowId: 1 });
  assert.deepEqual({ response, calls: app.calls, origin: app.state.filter((tab) => tab.windowId === 2), tab: app.state.find((tab) => tab.id === 20), originOpen: app.windows.has(2) }, {
    response: { ok: true }, calls: [['move', 20, 1]],
    origin: [{ id: 30, windowId: 2, active: false, url: 'about:blank#tab-shelf-placeholder' }],
    tab: { id: 20, windowId: 1, active: false, url: 'https://remote.test/', index: -1 }, originOpen: true,
  });
});
