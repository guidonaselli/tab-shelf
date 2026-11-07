import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { setImmediate } from 'node:timers/promises';
import * as model from '../src/model.js';

const [source, settings, icons, html] = await Promise.all(
  ['panel.js', 'src/settings.js', 'src/icons.js', 'panel.html'].map((path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')),
);

async function panel(pins = [{ id: 'docs', title: 'Docs', url: 'https://example.com/' }], { isOverlay = true, tabs = [], session = {} } = {}) {
  const messages = [];
  const runtimeMessages = [];
  const elements = [];
  const timers = [];
  let focused = false;
  const copied = [];
  let selected;
  let liveTabs = tabs;
  let onActivated;
  const target = () => {
    const listeners = {};
    return {
      addEventListener(type, listener) { (listeners[type] ??= []).push(listener); },
      dispatchEvent(event) {
        event.target ??= this;
        for (const listener of listeners[event.type] ?? []) listener(event);
        this.parentNode?.dispatchEvent(event);
      },
    };
  };
  const document = target();
  const createElement = (tag) => {
    const node = {
      ...target(), tagName: tag.toUpperCase(), dataset: {}, className: '', value: '',
      children: [], style: { removeProperty() {} },
      setAttribute(name, value) { if (name === 'class') this.className = value; },
      append(...children) {
        this.children.push(...children);
        for (const child of children) child.parentNode = this;
      },
      prepend(child) { this.children.unshift(child); child.parentNode = this; },
      replaceChildren(...children) { this.children = []; this.append(...children); },
      focus() { document.activeElement = this; focused = true; },
      select() { selected = this; },
      remove() { this.parentNode.children = this.parentNode.children.filter((child) => child !== this); },
      closest(selector) {
        for (let node = this; node; node = node.parentNode) {
          if (selector === '[hidden]' && node.hidden) return node;
        }
        return null;
      },
    };
    node.classList = {
      add(name) { node.className += ` ${name}`; },
      remove(...names) { node.className = node.className.split(' ').filter((name) => !names.includes(name)).join(' '); },
      toggle(name, enabled) { if (enabled) node.classList.add(name); else node.classList.remove(name); },
    };
    elements.push(node);
    return node;
  };
  const ids = new Map([...html.matchAll(/<([\w-]+)[^>]*\bid="([^"]+)"[^>]*>/g)].map(([markup, tag, id]) => {
    const node = createElement(tag);
    node.id = id;
    node.hidden = /\bhidden\b/.test(markup);
    node.parentNode = document;
    return [id, node];
  }));
  Object.assign(document, {
    createElement, createElementNS: (_namespace, tag) => createElement(tag),
    documentElement: createElement('html'), activeElement: createElement('body'),
    body: createElement('body'),
    execCommand(command) { if (command !== 'copy') return false; copied.push(selected.value); return true; },
    getElementById: (id) => ids.get(id),
    hasFocus: () => focused,
    querySelector: () => createElement('div'),
    querySelectorAll(selector) {
      if (selector === '#pins .main, #windows .main') {
        const descendants = (node) => node.children.flatMap((child) => [child, ...descendants(child)]);
        return [ids.get('pins'), ids.get('windows')].flatMap(descendants)
          .filter((node) => node.className.split(' ').includes('main'));
      }
      return selector.startsWith('.')
        ? elements.filter((node) => selector.split(', ').some((value) => node.className.split(' ').includes(value.slice(1))))
        : [];
    },
  });
  const event = { addListener() {} };
  const chrome = {
    i18n: { getMessage: (key, substitutions) => key === 'errorGeneric' ? `Error: ${substitutions}` : key, getUILanguage: () => 'en' },
    runtime: { sendMessage: async (message) => {
      runtimeMessages.push(structuredClone(message));
      return message?.pins ? { ok: true, tabId: 20 } : '';
    } },
    storage: {
      local: { get: async () => ({ pins }) },
      session: {
        get: async () => structuredClone(session),
        set: async (values) => Object.assign(session, structuredClone(values)),
      },
      onChanged: event,
    },
    tabs: Object.fromEntries(['onCreated', 'onRemoved', 'onMoved', 'onAttached', 'onDetached', 'onActivated', 'onReplaced', 'onUpdated'].map((name) => [name, event])),
    windows: {
      ...Object.fromEntries(['onCreated', 'onRemoved', 'onFocusChanged', 'onBoundsChanged'].map((name) => [name, event])),
      getAll: async () => liveTabs.length ? [{ id: 7, left: 0, type: 'normal', state: 'normal', tabs: liveTabs }] : [],
      getLastFocused: async () => ({ id: 7 }),
    },
  };
  chrome.tabs.onActivated = { addListener(listener) { onActivated = listener; } };
  chrome.tabs.query = async () => liveTabs.filter((tab) => tab.active);
  runInNewContext(`${settings}\n${icons.replace('export function glyph', 'function glyph')}\n${source.replace(/^import .*;\r?\n/gm, '')}`, {
    ...model, chrome, document, URL, URLSearchParams, location: { search: isOverlay ? '?window=7' : '' },
    navigator: { clipboard: { writeText: async (text) => { copied.push(text); } } },
    parent: { postMessage: (message) => messages.push(message) },
    setTimeout: (callback) => timers.push(callback),
  });
  await setImmediate();
  assert.equal(ids.get('status').hidden, true);
  assert.equal(ids.get('pins').children.length, pins.length);
  messages.length = 0;
  return {
    messages, runtimeMessages, pin: ids.get('pins').children[0], document, copied,
    activateTab(tab) { liveTabs = [tab]; onActivated({ tabId: tab.id, windowId: tab.windowId }); },
    finishTimers() { for (const callback of timers.splice(0)) callback(); },
    blurWindow() { focused = false; document.dispatchEvent({ type: 'focusout' }); },
  };
}

test('perder el foco durante un arrastre de pin mantiene busy hasta dragend', async () => {
  const app = await panel();
  app.document.getElementById('search').focus();
  app.pin.dispatchEvent({ type: 'dragstart', dataTransfer: { setData() {} } });
  app.blurWindow();
  app.finishTimers();
  assert.deepEqual(app.messages, ['zts:busy', 'zts:busy']);

  app.pin.dispatchEvent({ type: 'dragend' });
  assert.deepEqual(app.messages, ['zts:busy', 'zts:busy', 'zts:idle']);
});

for (const id of ['search', 'settings-toggle', 'copy-url']) {
  test(`el foco en ${id} mantiene ocupado el iframe hasta salir del documento`, async () => {
    const app = await panel();
    const control = app.document.getElementById(id);
    control.focus();
    control.dispatchEvent({ type: 'focusin' });
    assert.deepEqual(app.messages, ['zts:busy', 'zts:focused']);

    app.blurWindow();
    app.finishTimers();
    assert.deepEqual(app.messages, ['zts:busy', 'zts:focused', 'zts:idle']);
  });
}

test('Escape desde un control de ajustes devuelve el foco al botón de ajustes', async () => {
  const { document } = await panel();
  document.getElementById('settings-toggle').dispatchEvent({ type: 'click' });
  const control = document.getElementById('setting-mode');
  document.getElementById('settings').append(control);
  control.focus();

  control.dispatchEvent({ type: 'keydown', key: 'Escape' });

  assert.equal(document.activeElement.id, 'settings-toggle');
});

test('ArrowDown desde búsqueda omite filas con un ancestro oculto', async () => {
  const { document } = await panel([
    { id: 'hidden', title: 'Hidden', url: 'https://hidden.example/' },
    { id: 'visible', title: 'Visible', url: 'https://visible.example/' },
  ]);
  document.getElementById('pins').children[0].hidden = true;
  const search = document.getElementById('search');
  search.focus();

  search.dispatchEvent({ type: 'keydown', key: 'ArrowDown', preventDefault() {} });

  assert.equal(document.activeElement.dataset.focus, 'pin:visible:main');
});

for (const isOverlay of [false, true]) {
  test(`la vista con sesión vacía solicita reconciliar el candidato en ${isOverlay ? 'iframe' : 'panel'}`, async () => {
    const app = await panel([{ id: 'saved', title: 'Guardado', url: 'https://example.com/docs' }], {
      isOverlay,
      tabs: [{ id: 20, windowId: 7, index: 0, title: 'Docs', url: 'https://example.com/docs/app', active: true }],
      session: {},
    });
    assert.deepEqual(app.runtimeMessages.filter((message) => message?.pins), [
      { pins: { op: 'reconcile', matches: [{ id: 'saved', tabId: 20 }] } },
    ]);
  });

  test(`el clic en pin envía open con la identidad conservada en ${isOverlay ? 'iframe' : 'panel'}`, async () => {
    const app = await panel([{ id: 'saved', title: 'Guardado', url: 'https://example.com/original' }], {
      isOverlay,
      tabs: [{ id: 20, windowId: 7, index: 0, title: 'Navegada', url: 'https://other.example/current', active: true }],
      session: { pinTabs: { saved: 20 } },
    });
    app.pin.children[0].dispatchEvent({ type: 'click' });
    await setImmediate();
    assert.deepEqual(app.runtimeMessages.filter((message) => message?.pins), [
      { pins: { op: 'open', id: 'saved', windowId: 7, candidateId: 20 } },
    ]);
    assert.equal(app.document.getElementById('status').hidden, true);
  });

  test(`copiar usa la pestaña activa aunque el render siga pendiente en ${isOverlay ? 'iframe' : 'panel'}`, async () => {
    const app = await panel([], {
      isOverlay,
      tabs: [{ id: 10, windowId: 7, index: 0, title: 'Anterior', url: 'https://example.com/old', active: true }],
    });
    assert.equal(app.document.getElementById('current-url').title, 'https://example.com/old');
    app.activateTab({ id: 20, windowId: 7, index: 0, title: 'Actual', url: 'https://example.com/current', active: true });
    app.document.getElementById('copy-url').dispatchEvent({ type: 'click' });
    await setImmediate();
    assert.deepEqual(app.copied, ['https://example.com/current']);
  });

  test(`copiar usa pendingUrl durante una navegación en ${isOverlay ? 'iframe' : 'panel'}`, async () => {
    const app = await panel([], {
      isOverlay,
      tabs: [{ id: 10, windowId: 7, index: 0, title: 'Anterior', url: 'https://example.com/old', active: true }],
    });
    app.activateTab({ id: 20, windowId: 7, index: 0, title: '', url: '', pendingUrl: 'https://example.com/loading', active: true });
    app.document.getElementById('copy-url').dispatchEvent({ type: 'click' });
    await setImmediate();
    assert.deepEqual(app.copied, ['https://example.com/loading']);
  });

  test(`copiar sin URL informa error sin escribir en ${isOverlay ? 'iframe' : 'panel'}`, async () => {
    const app = await panel([], {
      isOverlay,
      tabs: [{ id: 10, windowId: 7, index: 0, title: 'Anterior', url: 'https://example.com/old', active: true }],
    });
    app.activateTab({ id: 20, windowId: 7, index: 0, title: 'Sin dirección', url: '', active: true });
    app.document.getElementById('copy-url').dispatchEvent({ type: 'click' });
    await setImmediate();
    const status = app.document.getElementById('status');
    assert.deepEqual([app.copied, status.hidden, status.className, status.textContent], [[], false, 'error', 'Error: copyFailed']);
  });
}
