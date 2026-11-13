import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { setImmediate } from 'node:timers/promises';

const source = await readFile(new URL('../overlay.js', import.meta.url), 'utf8');
const settings = await readFile(new URL('../src/settings.js', import.meta.url), 'utf8');

async function overlay({ windowId = 7 } = {}) {
  const listeners = {};
  const sent = [];
  const elements = [];
  const timers = new Map();
  let timerId = 0;
  const target = (name) => ({
    addEventListener: (type, listener) => { listeners[`${name}:${type}`] = listener; },
    dispatchEvent: (event) => listeners[`${name}:${event.type}`](event),
  });
  const createElement = (tagName) => {
    const element = {
      ...target(`element-${elements.length}`),
      tagName,
      getAttribute(name) { return this.attributes?.[name] ?? (typeof this[name] === 'string' ? this[name] : null); },
      matches(selector) { return selector === 'a[href]' && this.tagName === 'a' && Boolean(this.href); },
      closest(selector) {
        for (let element = this; element; element = element.parent) {
          if (element.matches(selector)) return element;
        }
        return null;
      },
      dataset: {},
      style: { setProperty() {} },
      className: '',
      children: [],
      contentWindow: {},
      append(...children) {
        this.children.push(...children);
        for (const child of children) child.parent = this;
      },
      remove() {
        if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
      },
      attachShadow() { return createElement('shadow-root'); },
      focus() { this.focused = true; },
    };
    element.classList = {
      contains: (name) => element.className.split(' ').includes(name),
      add: (name) => { if (!element.classList.contains(name)) element.className += ` ${name}`; },
      remove: (name) => { element.className = element.className.split(' ').filter((value) => value !== name).join(' '); },
      toggle: (name, enabled) => element.classList[enabled ? 'add' : 'remove'](name),
    };
    elements.push(element);
    return element;
  };
  const chrome = {
    i18n: { getMessage: (key) => key === 'extName' ? 'Panel de pestañas' : '' },
    runtime: {
      getURL: (path) => `chrome-extension://test/${path}`,
      sendMessage: async (message) => { sent.push(structuredClone(message)); return message === 'zts:window' ? windowId : true; },
      onMessage: { addListener: (listener) => { listeners.runtime = listener; } },
    },
    storage: {
      local: { get: async () => ({}) },
      onChanged: { addListener() {} },
    },
  };
  const document = {
    ...target('document'),
    documentElement: createElement('html'),
    querySelectorAll: () => [],
    createElement,
    hasFocus: () => true,
  };
  runInNewContext(`${settings}\n${source}`, {
    chrome, document, window: target('window'), location: { hostname: 'example.com' },
    URL, URLSearchParams,
    setTimeout: (callback) => { timers.set(++timerId, callback); return timerId; },
    clearTimeout: (id) => timers.delete(id),
    requestAnimationFrame: (callback) => callback(),
  });
  await setImmediate();
  const panel = elements.find((element) => element.className === 'panel');
  return {
    panel,
    sent,
    setWindowId: (value) => { windowId = value; },
    pointerDown: async ({ link = true, target = '', svg = false, ...modifiers } = {}) => {
      const element = createElement(link ? 'a' : 'button');
      if (link) Object.assign(element, { href: 'https://other.example/page', target });
      if (svg) Object.assign(element, {
        target: { baseVal: target, animVal: target },
        attributes: target ? { target } : {},
        namespaceURI: 'http://www.w3.org/2000/svg',
      });
      document.documentElement.append(element);
      listeners['document:pointerdown']({
        button: 0, ctrlKey: false, metaKey: false, ...modifiers,
        target: element, composedPath: () => [element, document.documentElement],
      });
      await setImmediate();
    },
    focusPage: async () => {
      listeners['document:focusin']?.({ composedPath: () => [document.documentElement] });
      await setImmediate();
    },
    focusFrame: async (origin = new URL('chrome-extension://test/').origin, source = panel.children.at(-1)?.contentWindow) => {
      listeners['window:message']({ origin, source, data: 'zts:focused' });
      await setImmediate();
    },
    hover: async ({ runTimers = true } = {}) => {
      listeners['window:mousemove']({ buttons: 0, clientX: 0, composedPath: () => [] });
      if (runTimers) {
        const pending = [...timers.values()];
        timers.clear();
        for (const callback of pending) callback();
      }
      await setImmediate();
    },
    message: async (message) => {
      const responses = [];
      listeners.runtime(message, {}, (response) => responses.push(response));
      await setImmediate();
      return responses;
    },
    close: async (origin = new URL('chrome-extension://test/').origin, source = panel.children.at(-1)?.contentWindow) => {
      listeners['window:message']({ origin, source, data: 'zts:close' });
      await setImmediate();
    },
    busy: () => listeners['window:message']({
      origin: new URL('chrome-extension://test/').origin,
      source: panel.children.at(-1)?.contentWindow,
      data: 'zts:busy',
    }),
    idle: () => listeners['window:message']({
      origin: new URL('chrome-extension://test/').origin,
      source: panel.children.at(-1)?.contentWindow,
      data: 'zts:idle',
    }),
    moveAway: () => listeners['window:mousemove']({ buttons: 0, clientX: 100, composedPath: () => [] }),
    finishTimers: () => {
      const pending = [...timers.values()];
      timers.clear();
      for (const callback of pending) callback();
    },
  };
}

test('reveal muestra el panel sin volver a registrar la apertura', async () => {
  const app = await overlay();
  await app.message('zts:reveal');
  await app.message('zts:reveal');
  assert.equal(app.panel.classList.contains('open'), true);
  assert.equal(app.panel.children.length, 1);
  assert.equal(app.panel.children[0].src, 'chrome-extension://test/panel.html?window=7&host=example.com');
  assert.deepEqual(app.sent, [{ overlay: 'ready' }, 'zts:window']);
});

test('el iframe del panel flotante tiene un título accesible localizado', async () => {
  const app = await overlay();
  await app.message('zts:reveal');
  assert.equal(app.panel.children[0]?.title, 'Panel de pestañas');
});

test('conceal y reveal conservan la apertura al volver a la pestaña', async () => {
  const app = await overlay();
  await app.message('zts:reveal');
  const previousFrame = app.panel.children[0];
  await app.message('zts:conceal');
  assert.equal(app.panel.classList.contains('open'), false);
  await app.message('zts:reveal');
  app.finishTimers();
  assert.equal(app.panel.classList.contains('open'), true);
  assert.equal(app.panel.children.length, 1);
  assert.notEqual(app.panel.children[0], previousFrame);
  assert.deepEqual(app.sent, [{ overlay: 'ready' }, 'zts:window', 'zts:window']);
});

test('reabrir antes de terminar el cierre reemplaza el iframe inmediatamente y conserva el nuevo', async () => {
  const app = await overlay();
  await app.message('zts:reveal');
  const previousFrame = app.panel.children[0];
  await app.message('zts:conceal');
  await app.message('zts:reveal');
  assert.deepEqual({ count: app.panel.children.length, replaced: app.panel.children[0] !== previousFrame }, {
    count: 1, replaced: true,
  });
  const reopenedFrame = app.panel.children[0];
  app.finishTimers();
  assert.deepEqual({ count: app.panel.children.length, preserved: app.panel.children[0] === reopenedFrame }, {
    count: 1, preserved: true,
  });
});

test('relocated desmonta el iframe obsoleto sin registrar un cierre en la nueva ventana', async () => {
  const app = await overlay();
  await app.message('zts:reveal');
  app.setWindowId(8);
  await app.message('zts:relocated');
  app.finishTimers();
  assert.deepEqual([app.panel.classList.contains('open'), app.panel.children.length, app.sent], [
    false, 0, [{ overlay: 'ready' }, 'zts:window'],
  ]);
});

test('reabrir después de relocated consulta la ventana actual para el iframe', async () => {
  const app = await overlay();
  await app.message('zts:reveal');
  app.setWindowId(8);
  await app.message('zts:relocated');
  app.finishTimers();
  await app.message('zts:reveal');
  assert.deepEqual(app.panel.children.map((frame) => frame.src), [
    'chrome-extension://test/panel.html?window=8&host=example.com',
  ]);
});

test('cerrar desde el iframe oculta el panel y registra el cierre', async () => {
  const app = await overlay();
  await app.message('zts:reveal');
  await app.close();
  app.finishTimers();
  assert.equal(app.panel.classList.contains('open'), false);
  assert.equal(app.panel.children.length, 0);
  assert.deepEqual(app.sent.at(-1), { overlay: 'closed' });
});

test('el atajo cierra explícitamente un panel abierto', async () => {
  const app = await overlay();
  await app.message('zts:reveal');
  assert.deepEqual(await app.message('zts:toggle'), [true]);
  assert.equal(app.panel.classList.contains('open'), false);
  assert.deepEqual(app.sent.at(-1), { overlay: 'closed' });
});

test('un mensaje busy conserva abierto el panel si ya había un cierre pendiente', async () => {
  const app = await overlay();
  await app.message('zts:reveal');
  app.panel.dispatchEvent({ type: 'mouseleave', relatedTarget: {} });
  app.busy();
  app.finishTimers();
  assert.equal(app.panel.classList.contains('open'), true);
});

test('reveal-focus restaura el foco del iframe sin registrar otra apertura', async () => {
  const app = await overlay();
  await app.message('zts:reveal-focus');
  assert.equal(app.panel.children[0]?.src, 'chrome-extension://test/panel.html?window=7&host=example.com&focus=1');
  assert.equal(app.panel.children[0]?.focused, true);
  assert.deepEqual(app.sent, [{ overlay: 'ready' }, 'zts:window']);
});

test('el hover abre el panel sin quitarle el foco a la página', async () => {
  const app = await overlay();
  await app.hover();
  assert.equal(app.panel.children[0]?.src, 'chrome-extension://test/panel.html?window=7&host=example.com');
  assert.equal(app.panel.children[0]?.focused, undefined);
  assert.deepEqual(app.sent, [{ overlay: 'ready' }, 'zts:window', { overlay: 'open' }]);
});

test('enfocar la página revoca el foco persistido del overlay', async () => {
  const app = await overlay();
  await app.message('zts:toggle');
  await app.focusFrame();
  await app.focusPage();
  assert.deepEqual(app.sent.at(-1), { overlay: 'focus', focused: false });
});

test('el foco de página previo al foco del iframe no revoca la restauración', async () => {
  const app = await overlay();
  await app.message('zts:reveal-focus');
  await app.focusPage();
  assert.deepEqual(app.sent, [{ overlay: 'ready' }, 'zts:window']);
});

test('conceal cancela una apertura que todavía espera el windowId', async () => {
  let resolveWindow;
  const windowId = new Promise((resolve) => { resolveWindow = resolve; });
  const app = await overlay({ windowId });
  await app.message('zts:reveal');
  await app.message('zts:conceal');
  resolveWindow(7);
  await setImmediate();
  assert.equal(app.panel.children.length, 0);
  assert.equal(app.panel.classList.contains('open'), false);
});

test('un hover pendiente no reemplaza la restauración de foco en curso', async () => {
  let resolveWindow;
  const windowId = new Promise((resolve) => { resolveWindow = resolve; });
  const app = await overlay({ windowId });
  await app.hover({ runTimers: false });
  await app.message('zts:reveal-focus');
  app.finishTimers();
  resolveWindow(7);
  await setImmediate();
  assert.equal(app.panel.children.length, 1);
  assert.equal(app.panel.children[0].src, 'chrome-extension://test/panel.html?window=7&host=example.com&focus=1');
  assert.equal(app.panel.children[0].focused, true);
  assert.deepEqual(app.sent.filter((message) => message?.overlay === 'open'), []);
});

test('conceal cancela el timer de hover aunque el panel siga cerrado', async () => {
  const app = await overlay();
  await app.hover({ runTimers: false });
  await app.message('zts:conceal');
  app.finishTimers();
  await setImmediate();
  assert.equal(app.panel.children.length, 0);
  assert.equal(app.panel.classList.contains('open'), false);
  assert.deepEqual(app.sent, [{ overlay: 'ready' }]);
});

test('un mensaje focused ajeno al iframe actual no habilita revocar el foco', async () => {
  const app = await overlay();
  await app.message('zts:reveal-focus');
  await app.focusFrame('https://example.com');
  await app.focusPage();
  await app.focusFrame(new URL('chrome-extension://test/').origin, {});
  await app.focusPage();
  assert.deepEqual(app.sent, [{ overlay: 'ready' }, 'zts:window']);
});

for (const [gesture, options] of [
  ['Ctrl+clic', { ctrlKey: true }],
  ['Meta+clic', { metaKey: true }],
  ['botón central', { button: 1 }],
  ['clic en target=_blank', { target: '_blank' }],
]) {
  test(`${gesture} en un enlace externo conserva el panel abierto`, async () => {
    const app = await overlay();
    await app.message('zts:reveal');
    await app.pointerDown(options);
    assert.deepEqual([app.panel.classList.contains('open'), app.sent], [
      true, [{ overlay: 'ready' }, 'zts:window'],
    ]);
  });
}

for (const target of ['_blank', '']) {
  test(`un enlace SVG con target ${target || 'ausente'} se maneja sin error`, async () => {
    const app = await overlay();
    await app.message('zts:reveal');
    await app.pointerDown({ svg: true, target });
    assert.deepEqual([app.panel.classList.contains('open'), app.sent], target === '_blank'
      ? [true, [{ overlay: 'ready' }, 'zts:window']]
      : [false, [{ overlay: 'ready' }, 'zts:window', { overlay: 'closed' }]]);
  });
}

test('Ctrl+clic en un enlace cancela la ocultación pendiente por mouseleave', async () => {
  const app = await overlay();
  await app.message('zts:reveal');
  app.panel.dispatchEvent({ type: 'mouseleave', relatedTarget: {} });
  await app.pointerDown({ ctrlKey: true });
  app.finishTimers();
  await setImmediate();
  assert.deepEqual([app.panel.classList.contains('open'), app.sent], [true, [{ overlay: 'ready' }, 'zts:window']]);
});

test('idle tras abrir un enlace en otra pestaña conserva el panel hasta mover el mouse', async () => {
  const app = await overlay();
  await app.message('zts:reveal-focus');
  await app.focusFrame();
  app.busy();
  app.panel.dispatchEvent({ type: 'mouseleave', relatedTarget: {} });
  await app.pointerDown({ ctrlKey: true });
  app.idle();
  app.finishTimers();
  await setImmediate();
  assert.deepEqual([app.panel.classList.contains('open'), app.sent], [true, [{ overlay: 'ready' }, 'zts:window']]);

  app.moveAway();
  app.finishTimers();
  await setImmediate();
  assert.deepEqual([app.panel.classList.contains('open'), app.sent.at(-1)], [false, { overlay: 'closed' }]);
});

for (const [gesture, options] of [
  ['clic simple fuera', {}],
  ['Ctrl+clic en un elemento que no es enlace', { link: false, ctrlKey: true }],
]) {
  test(`${gesture} cierra el panel normalmente`, async () => {
    const app = await overlay();
    await app.message('zts:reveal');
    await app.pointerDown(options);
    assert.deepEqual([app.panel.classList.contains('open'), app.sent.at(-1)], [false, { overlay: 'closed' }]);
  });
}
