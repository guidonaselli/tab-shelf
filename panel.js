import { buildView, filterView, addPin, removePin, dropIndex } from './src/model.js';

const RENDER_DELAY_MS = 100;
const DRAG_TYPE = 'application/x-zts-tab';

const t = (key, ...substitutions) => chrome.i18n.getMessage(key, substitutions);
const $ = (id) => document.getElementById(id);

const state = { view: null, query: '', dragging: null, renderPending: false, timer: 0 };

function applyStaticText() {
  document.documentElement.lang = chrome.i18n.getUILanguage();
  for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  for (const node of document.querySelectorAll('[data-i18n-placeholder]')) {
    node.placeholder = t(node.dataset.i18nPlaceholder);
  }
  for (const node of document.querySelectorAll('[data-i18n-label]')) {
    node.setAttribute('aria-label', t(node.dataset.i18nLabel));
  }
}

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function showError(error) {
  const status = $('status');
  status.className = 'error';
  status.textContent = t('errorGeneric', error?.message ?? String(error));
  status.hidden = false;
}

function clearError() {
  $('status').hidden = true;
}

// Cada acción del usuario pasa por acá: un error de la API se muestra y no rompe el panel.
function run(action) {
  return async (...args) => {
    try {
      clearError();
      await action(...args);
    } catch (error) {
      showError(error);
    }
  };
}

async function currentWindowId() {
  return (await chrome.windows.getLastFocused({ windowTypes: ['normal'] })).id;
}

async function readPins() {
  return (await chrome.storage.local.get('pins')).pins ?? [];
}

async function loadView() {
  const [windows, pins, current] = await Promise.all([
    chrome.windows.getAll({ populate: true, windowTypes: ['normal'] }),
    readPins(),
    currentWindowId(),
  ]);
  return buildView(windows, pins, { currentWindowId: current, emptyTitle: t('emptyTabTitle') });
}

async function render() {
  try {
    state.view = await loadView();
    draw();
  } catch (error) {
    showError(error);
  }
}

// Los eventos de tabs llegan en ráfagas; un re-render durante un arrastre destruiría el origen del drag.
function scheduleRender() {
  if (state.dragging) {
    state.renderPending = true;
    return;
  }
  clearTimeout(state.timer);
  state.timer = setTimeout(render, RENDER_DELAY_MS);
}

function icon(favIconUrl, title) {
  const letter = () => el('span', { className: 'icon letter', textContent: (title.trim()[0] ?? '?').toUpperCase() });
  if (!favIconUrl) return letter();
  const img = el('img', { className: 'icon', alt: '', src: favIconUrl, referrerPolicy: 'no-referrer' });
  img.addEventListener('error', () => img.replaceWith(letter()), { once: true });
  return img;
}

function findTab(tabId) {
  for (const w of state.view.windows) {
    const tab = w.tabs.find((x) => x.id === tabId);
    if (tab) return { tab, window: w };
  }
  return null;
}

async function activate(tab, win) {
  await chrome.tabs.update(tab.id, { active: true });
  // shortcut: restaurar a 'normal' desinmaximiza; solo se usa si la ventana está minimizada
  await chrome.windows.update(tab.windowId, win.minimized ? { focused: true, state: 'normal' } : { focused: true });
}

const focusTab = run(activate);

const openOrFocus = run(async (pin) => {
  const found = pin.openTabId === null ? null : findTab(pin.openTabId);
  if (found) return activate(found.tab, found.window);
  await chrome.tabs.create({ url: pin.url, windowId: await currentWindowId() });
});

const togglePin = run(async (tab) => {
  const pins = await readPins();
  const next = tab.pinId ? removePin(pins, tab.pinId) : addPin(pins, tab, crypto.randomUUID());
  if (next !== pins) await chrome.storage.local.set({ pins: next });
});

const unpin = run(async (pinId) => {
  await chrome.storage.local.set({ pins: removePin(await readPins(), pinId) });
});

const moveTab = run(async (tabId, windowId, index) => {
  await chrome.tabs.move(tabId, { windowId, index });
});

function otherWindowId(win) {
  const all = state.view.windows;
  return all[(all.indexOf(win) + 1) % all.length].id;
}

function clearDropMarks() {
  for (const row of document.querySelectorAll('.drop-before, .drop-after')) {
    row.classList.remove('drop-before', 'drop-after');
  }
}

function endDrag() {
  state.dragging = null;
  clearDropMarks();
  for (const row of document.querySelectorAll('.dragging')) row.classList.remove('dragging');
  if (state.renderPending) {
    state.renderPending = false;
    scheduleRender();
  }
}

function tabRow(tab, win) {
  const main = el('button', { type: 'button', className: 'main', title: tab.url },
    icon(tab.favIconUrl, tab.title), el('span', { className: 'title', textContent: tab.title }));
  main.addEventListener('click', () => focusTab(tab, win));

  const pin = el('button', {
    type: 'button',
    className: tab.pinId ? 'action on' : 'action',
    textContent: tab.pinId ? t('unpinTab') : t('pinTab'),
  });
  pin.addEventListener('click', () => togglePin(tab));

  const row = el('li', { className: 'row', draggable: true }, main, pin);
  row.classList.toggle('active', tab.active);
  row.classList.toggle('discarded', tab.discarded);

  if (state.view.windows.length > 1) {
    const move = el('button', { type: 'button', className: 'action', textContent: '↗', title: t('moveToOtherWindow') });
    move.setAttribute('aria-label', t('moveToOtherWindow'));
    move.addEventListener('click', () => moveTab(tab.id, otherWindowId(win), -1));
    row.append(move);
  }

  row.addEventListener('dragstart', (event) => {
    state.dragging = { tabId: tab.id, windowId: tab.windowId, index: tab.index };
    event.dataTransfer.setData(DRAG_TYPE, String(tab.id));
    event.dataTransfer.effectAllowed = 'move';
    row.classList.add('dragging');
  });
  row.addEventListener('dragend', endDrag);
  row.addEventListener('dragover', (event) => {
    if (!state.dragging) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = row.getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;
    clearDropMarks();
    row.classList.add(after ? 'drop-after' : 'drop-before');
    row.dataset.after = String(after);
  });
  row.addEventListener('drop', (event) => {
    if (!state.dragging) return;
    event.preventDefault();
    event.stopPropagation();
    const { tabId, windowId, index } = state.dragging;
    const insertBefore = tab.index + (row.dataset.after === 'true' ? 1 : 0);
    endDrag();
    moveTab(tabId, tab.windowId, dropIndex({ fromWindowId: windowId, fromIndex: index, toWindowId: tab.windowId, insertBefore }));
  });
  return row;
}

function windowSection(win, position) {
  const heading = el('h2', { textContent: t('windowHeading', String(position)) });
  if (win.isCurrent) heading.append(el('span', { className: 'tag', textContent: ` ${t('currentWindow')}` }));
  if (win.minimized) heading.append(el('span', { className: 'tag', textContent: ` ${t('minimizedWindow')}` }));

  const list = el('ul', { className: 'list' }, ...win.tabs.map((tab) => tabRow(tab, win)));
  const section = el('section', {}, heading, list);
  section.addEventListener('dragover', (event) => {
    if (!state.dragging) return;
    event.preventDefault();
    clearDropMarks();
  });
  section.addEventListener('drop', (event) => {
    if (!state.dragging) return;
    event.preventDefault();
    const { tabId } = state.dragging;
    endDrag();
    moveTab(tabId, win.id, -1);
  });
  return section;
}

function pinRow(pin) {
  const main = el('button', { type: 'button', className: 'main', title: pin.url },
    icon(pin.favIconUrl, pin.title), el('span', { className: 'title', textContent: pin.title }));
  main.addEventListener('click', () => openOrFocus(pin));
  const remove = el('button', { type: 'button', className: 'action', textContent: '×', title: t('unpinTab') });
  remove.setAttribute('aria-label', t('unpinTab'));
  remove.addEventListener('click', () => unpin(pin.id));
  return el('li', { className: pin.openTabId === null ? 'row' : 'row active' }, main, remove);
}

function draw() {
  const filtered = filterView(state.view, state.query);
  $('pins').replaceChildren(...filtered.pins.map(pinRow));
  $('pins-empty').hidden = state.view.pins.length > 0;
  $('windows').replaceChildren(...filtered.windows.map((win) => windowSection(win, state.view.windows.findIndex((w) => w.id === win.id) + 1)));
  $('no-results').hidden = state.query === '' || filtered.windows.length > 0 || filtered.pins.length > 0;
}

async function fillDiagnostics() {
  const [current, lastFocused, all] = await Promise.all([
    chrome.windows.getCurrent(),
    chrome.windows.getLastFocused({ windowTypes: ['normal'] }),
    chrome.windows.getAll({ windowTypes: ['normal'] }),
  ]);
  $('diagnostics').textContent = [
    navigator.userAgent,
    `sidePanel: ${Boolean(chrome.sidePanel)}`,
    `getCurrent: ${current.id} (${current.type})`,
    `getLastFocused: ${lastFocused.id}`,
    `windows: ${all.map((w) => w.id).join(', ')}`,
  ].join('\n');
}

function subscribe() {
  for (const event of [
    chrome.tabs.onCreated, chrome.tabs.onRemoved, chrome.tabs.onUpdated, chrome.tabs.onMoved,
    chrome.tabs.onAttached, chrome.tabs.onDetached, chrome.tabs.onActivated, chrome.tabs.onReplaced,
    chrome.windows.onCreated, chrome.windows.onRemoved, chrome.windows.onFocusChanged, chrome.windows.onBoundsChanged,
  ]) {
    event.addListener(scheduleRender);
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.pins) scheduleRender();
  });
}

applyStaticText();
$('search').addEventListener('input', (event) => {
  state.query = event.target.value;
  if (state.view) draw();
});
subscribe();
render();
fillDiagnostics().catch(showError);
$('search').focus();
