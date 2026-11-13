import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { setImmediate } from 'node:timers/promises';
import * as model from '../src/model.js';
import * as sharedOrder from '../src/shared-order.js';

const source = (await readFile(new URL('../background.js', import.meta.url), 'utf8'))
  .replace(/^import .* from ['"]\.\/src\/model\.js['"];?\r?\n/m, '')
  .replace(/^import ['"]\.\/src\/settings\.js['"];?\r?\n/m, '')
  .replace(/^import .* from ['"]\.\/src\/shared-order\.js['"];?\r?\n/m, '');
const settingsSource = await readFile(new URL('../src/settings.js', import.meta.url), 'utf8');

function background({ overlays = {}, overlayFocus = {}, save } = {}) {
  const listeners = {};
  const sent = [];
  const session = { overlays, overlayFocus };
  const event = (name) => ({ addListener: (listener) => (listeners[name] ??= []).push(listener) });
  const chrome = {
    sidePanel: { setPanelBehavior: async () => {} },
    runtime: {
      onInstalled: event('installed'),
      onStartup: event('startup'),
      onMessage: event('message'),
    },
    storage: {
      local: { get: async () => ({ pins: [] }) },
      session: {
        get: async () => structuredClone(session),
        set: save ?? (async (values) => Object.assign(session, structuredClone(values))),
        remove: async () => { delete session.overlays; },
      },
    },
    tabs: {
      onActivated: event('activated'),
      onAttached: event('attached'),
      onRemoved: event('tabRemoved'),
      onReplaced: event('replaced'),
      sendMessage: async (tabId, message) => { sent.push([tabId, message]); },
    },
    windows: { onRemoved: event('removed') },
    commands: { onCommand: event('command') },
  };
  runInNewContext(`${settingsSource}\n${source}`, { chrome, console, ...model, ...sharedOrder });
  return {
    activate: async (tabId, windowId) => {
      await listeners.activated[0]({ tabId, windowId });
      await setImmediate();
    },
    attach: async (tabId, newWindowId) => {
      for (const listener of listeners.attached ?? []) await listener(tabId, { newWindowId, newPosition: 0 });
      await setImmediate();
    },
    message: (message, tab, respond = () => {}) => listeners.message[0](message, { tab }, respond),
    removeWindow: async (windowId) => {
      await listeners.removed[0](windowId);
      await setImmediate();
    },
    session,
    sent,
  };
}

test('el iframe obtiene la ventana de su pestaña emisora', () => {
  const app = background();
  const responses = [];
  app.message('zts:window', { id: 20, windowId: 8 }, (value) => responses.push(value));
  assert.deepEqual(responses, [8]);
});

test('trasladar una pestaña con overlay avisa que cambió de ventana', async () => {
  const app = background({ overlays: { 1: 10, 2: 30 } });
  await app.attach(10, 2);
  assert.deepEqual(app.sent, [[10, 'zts:relocated']]);
});

test('el orden global conserva el reordenamiento al recibir otra lista de ventanas', async () => {
  const app = background();
  const request = (tabs) => new Promise((resolve) => app.message({ tabs }, undefined, (value) => resolve(structuredClone(value))));
  await request({ op: 'order', ids: [10, 20, 30] });
  assert.deepEqual(await request({ op: 'reorder', tabId: 30, beforeId: 10 }), { ok: true, order: [30, 10, 20] });
  assert.deepEqual(await request({ op: 'order', ids: [20, 10, 30, 40] }), { ok: true, order: [30, 10, 20, 40] });
  assert.deepEqual(app.session.tabOrder, [30, 10, 20, 40]);
});

test('overlay confirma la apertura después de persistir el estado', async () => {
  let finishSave;
  const saved = new Promise((resolve) => { finishSave = resolve; });
  const app = background({ save: () => saved });
  const responses = [];
  const keepAlive = app.message({ overlay: 'open' }, { id: 10, windowId: 1, active: true }, (response) => responses.push(response));
  assert.deepEqual(responses, []);
  finishSave();
  await setImmediate();
  assert.deepEqual(responses, [true]);
  assert.equal(keepAlive, true);
});

test('overlay sigue abierto al cambiar de pestaña varias veces', async () => {
  const app = background();
  app.message({ overlay: 'open' }, { id: 10, windowId: 1, active: true });
  await setImmediate();
  await app.activate(20, 1);
  await app.activate(21, 1);
  assert.deepEqual(app.sent, [
    [10, 'zts:conceal'], [20, 'zts:reveal'],
    [20, 'zts:conceal'], [21, 'zts:reveal'],
  ]);
});

test('overlay mantiene independientes las ventanas abiertas y cerradas', async () => {
  const app = background({ overlays: { 1: 10, 2: 30 } });
  await app.activate(40, 3);
  await app.activate(31, 2);
  await app.activate(20, 1);
  assert.deepEqual(app.sent, [
    [30, 'zts:conceal'], [31, 'zts:reveal'],
    [10, 'zts:conceal'], [20, 'zts:reveal'],
  ]);
});

test('cerrar overlay impide revelarlo al activar otra pestaña', async () => {
  const app = background({ overlays: { 1: 10 } });
  app.message({ overlay: 'closed' }, { id: 10, windowId: 1 });
  await setImmediate();
  await app.activate(20, 1);
  app.message({ overlay: 'ready' }, { id: 20, windowId: 1, active: true });
  await setImmediate();
  assert.deepEqual(app.sent, []);
});

test('un cierre tardío de la pestaña anterior no cierra el overlay actual', async () => {
  const app = background({ overlays: { 1: 10 } });
  await app.activate(20, 1);
  app.message({ overlay: 'closed' }, { id: 10, windowId: 1 });
  await setImmediate();
  await app.activate(21, 1);
  assert.deepEqual(app.sent, [
    [10, 'zts:conceal'], [20, 'zts:reveal'],
    [20, 'zts:conceal'], [21, 'zts:reveal'],
  ]);
});

test('una pestaña activa recién cargada revela el overlay de su ventana', async () => {
  const app = background({ overlays: { 1: 20 } });
  app.message({ overlay: 'ready' }, { id: 20, windowId: 1, active: true });
  await setImmediate();
  assert.deepEqual(app.sent, [[20, 'zts:reveal']]);
});

test('ready de una pestaña inactiva o de una ventana cerrada no revela el overlay', async () => {
  const app = background({ overlays: { 1: 20 } });
  app.message({ overlay: 'ready' }, { id: 10, windowId: 1, active: false });
  app.message({ overlay: 'ready' }, { id: 30, windowId: 2, active: true });
  await setImmediate();
  assert.deepEqual(app.sent, []);
});

test('activar sin overlay abierto no revela el panel', async () => {
  const app = background();
  await app.activate(20, 1);
  assert.deepEqual(app.sent, []);
});

test('la búsqueda del overlay se conserva al cambiar de pestaña', async () => {
  const app = background({ overlays: { 1: 10 } });
  await new Promise((resolve) => app.message({ overlay: 'query', query: 'Example Org' }, { id: 10, windowId: 1 }, resolve));
  await app.activate(20, 1);
  const query = await new Promise((resolve) => app.message({ overlay: 'query-read' }, { id: 20, windowId: 1 }, resolve));
  assert.equal(query, 'Example Org');
});

test('las búsquedas del overlay son independientes por ventana', async () => {
  const app = background({ overlays: { 1: 10, 2: 30 } });
  await new Promise((resolve) => app.message({ overlay: 'query', query: 'Example' }, { id: 10, windowId: 1 }, resolve));
  await new Promise((resolve) => app.message({ overlay: 'query', query: 'Org' }, { id: 30, windowId: 2 }, resolve));
  const first = await new Promise((resolve) => app.message({ overlay: 'query-read' }, { id: 10, windowId: 1 }, resolve));
  const second = await new Promise((resolve) => app.message({ overlay: 'query-read' }, { id: 30, windowId: 2 }, resolve));
  assert.deepEqual([first, second], ['Example', 'Org']);
});

test('cerrar explícitamente el overlay limpia la búsqueda al volver a abrirlo', async () => {
  const app = background({ overlays: { 1: 10 } });
  const tab = { id: 10, windowId: 1, active: true };
  await new Promise((resolve) => app.message({ overlay: 'query', query: 'Example' }, tab, resolve));
  await new Promise((resolve) => app.message({ overlay: 'closed' }, tab, resolve));
  await new Promise((resolve) => app.message({ overlay: 'open' }, tab, resolve));
  const query = await new Promise((resolve) => app.message({ overlay: 'query-read' }, tab, resolve));
  assert.equal(query, '');
});

test('activar otra pestaña restaura el foco solo en la ventana que lo tenía', async () => {
  const app = background({ overlays: { 1: 10, 2: 30 } });
  await new Promise((resolve) => app.message({ overlay: 'focus', focused: true }, { id: 10, windowId: 1 }, resolve));
  await app.activate(20, 1);
  await app.activate(31, 2);
  assert.deepEqual(app.sent, [
    [10, 'zts:conceal'], [20, 'zts:reveal-focus'],
    [30, 'zts:conceal'], [31, 'zts:reveal'],
  ]);
});

test('ready restaura el foco persistido después de reiniciar el worker', async () => {
  const app = background({ overlays: { 1: 10 }, overlayFocus: { 1: true } });
  await new Promise((resolve) => app.message({ overlay: 'ready' }, { id: 10, windowId: 1, active: true }, resolve));
  assert.deepEqual(app.sent, [[10, 'zts:reveal-focus']]);
});

test('perder foco persiste false y ready revela sin enfocarlo', async () => {
  const app = background({ overlays: { 1: 10 }, overlayFocus: { 1: true } });
  const tab = { id: 10, windowId: 1, active: true };
  await new Promise((resolve) => app.message({ overlay: 'focus', focused: false }, tab, resolve));
  await new Promise((resolve) => app.message({ overlay: 'ready' }, tab, resolve));
  assert.deepEqual([app.session.overlayFocus, app.sent], [{ 1: false }, [[10, 'zts:reveal']]]);
});

test('el dueño anterior no puede borrar el foco de la pestaña actual', async () => {
  const app = background({ overlays: { 1: 10 }, overlayFocus: { 1: true } });
  await app.activate(20, 1);
  await new Promise((resolve) => app.message({ overlay: 'focus', focused: false }, { id: 10, windowId: 1 }, resolve));
  await app.activate(21, 1);
  assert.deepEqual(app.sent.slice(-2), [[20, 'zts:conceal'], [21, 'zts:reveal-focus']]);
});

test('el foco recibido se persiste por ventana junto a overlays', async () => {
  const app = background({ overlays: { 1: 10, 2: 30 } });
  await new Promise((resolve) => app.message({ overlay: 'focus', focused: true }, { id: 10, windowId: 1 }, resolve));
  assert.deepEqual([app.session.overlays, app.session.overlayFocus], [{ 1: 10, 2: 30 }, { 1: true }]);
});

test('abrir con el atajo registra el foco antes de activar otra pestaña', async () => {
  const app = background();
  await new Promise((resolve) => app.message({ overlay: 'open', focused: true }, { id: 10, windowId: 1, active: true }, resolve));
  await app.activate(20, 1);
  assert.deepEqual(app.sent, [[10, 'zts:conceal'], [20, 'zts:reveal-focus']]);
});

test('cerrar explícitamente limpia el foco antes de volver a abrir', async () => {
  const app = background({ overlays: { 1: 10 }, overlayFocus: { 1: true } });
  const tab = { id: 10, windowId: 1, active: true };
  await new Promise((resolve) => app.message({ overlay: 'closed' }, tab, resolve));
  await new Promise((resolve) => app.message({ overlay: 'open' }, tab, resolve));
  await app.activate(20, 1);
  assert.deepEqual([app.session.overlayFocus, app.sent], [{}, [[10, 'zts:conceal'], [20, 'zts:reveal']]]);
});

test('remover una ventana limpia su foco y conserva las demás', async () => {
  const app = background({ overlays: { 1: 10, 2: 30 }, overlayFocus: { 1: true, 2: true } });
  await app.removeWindow(1);
  assert.deepEqual([app.session.overlays, app.session.overlayFocus], [{ 2: 30 }, { 2: true }]);
});
