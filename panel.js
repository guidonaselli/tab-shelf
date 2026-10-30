import { buildView, filterView, addPin, removePin, dropIndex } from './src/model.js';
import { normalizeSettings } from './src/settings.js';
import { glyph } from './src/icons.js';

const RENDER_DELAY_MS = 100;
const DRAG_TYPE = 'application/x-zts-tab';
// cambios de pestaña que alteran lo que se dibuja; el resto (audible, groupId…) no justifica un render
const VISIBLE_TAB_CHANGES = ['title', 'url', 'favIconUrl', 'status', 'discarded'];

// dentro del panel de borde (iframe en una página) la ventana actual es la de esa página
const overlayWindow = new URLSearchParams(location.search).get('window');
const isOverlay = overlayWindow !== null;

const t = (key, ...substitutions) => chrome.i18n.getMessage(key, substitutions);
const $ = (id) => document.getElementById(id);

const state = { view: null, query: '', dragging: null, renderPending: false, renderSeq: 0, timer: 0 };

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
  if (isOverlay) return Number(overlayWindow);
  return (await chrome.windows.getLastFocused({ windowTypes: ['normal'] })).id;
}

async function readPins() {
  return (await chrome.storage.local.get('pins')).pins ?? [];
}

// El lock es del origen de la extensión: serializa las escrituras de todos los paneles abiertos.
function mutatePins(update) {
  return navigator.locks.request('zts-pins', async () => {
    const pins = await readPins();
    const next = update(pins);
    if (next !== pins) await chrome.storage.local.set({ pins: next });
  });
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
  const seq = ++state.renderSeq;
  try {
    const view = await loadView();
    if (seq !== state.renderSeq) return;
    if (state.dragging) {
      state.renderPending = true;
      return;
    }
    state.view = view;
    draw();
  } catch (error) {
    showError(error);
  }
}

// Los eventos de tabs llegan en ráfagas: un solo render por ventana de tiempo (no se reinicia, para no
// quedar sin dibujar mientras sigan llegando eventos). Durante un arrastre se difiere.
function scheduleRender() {
  if (state.dragging) {
    state.renderPending = true;
    return;
  }
  if (state.timer) return;
  state.timer = setTimeout(() => {
    state.timer = 0;
    render();
  }, RENDER_DELAY_MS);
}

function favicon(favIconUrl, title) {
  const letter = () => el('span', { className: 'icon letter', textContent: (Array.from(title.trim())[0] ?? '?').toUpperCase() });
  if (!favIconUrl) return letter();
  const img = el('img', { className: 'icon', alt: '', src: favIconUrl, referrerPolicy: 'no-referrer' });
  img.addEventListener('error', () => img.replaceWith(letter()), { once: true });
  return img;
}

function findTab(tabId) {
  return state.view.windows.flatMap((w) => w.tabs).find((tab) => tab.id === tabId) ?? null;
}

function closeOverlay() {
  if (isOverlay) parent.postMessage('zts:close', '*');
}

// La pestaña se trae a la ventana actual; focused:true también restaura una ventana minimizada (verificado en Helium)
async function activate(tab) {
  const here = await currentWindowId();
  if (tab.windowId !== here) await chrome.tabs.move(tab.id, { windowId: here, index: -1 });
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(here, { focused: true });
  closeOverlay();
}

const focusTab = run(activate);

const openOrFocus = run(async (pin) => {
  const open = pin.openTabId === null ? null : findTab(pin.openTabId);
  if (open) {
    // la pestaña pudo cerrarse dentro del lote de render: se abre una nueva en vez de fallar
    try {
      return await activate(open);
    } catch {}
  }
  await chrome.tabs.create({ url: pin.url, windowId: await currentWindowId() });
  closeOverlay();
});

const togglePin = run((tab) =>
  mutatePins((pins) => (tab.pinId ? removePin(pins, tab.pinId) : addPin(pins, tab, crypto.randomUUID()))));

const unpin = run((pinId) => mutatePins((pins) => removePin(pins, pinId)));

const moveTab = run(async (tabId, windowId, index) => {
  await chrome.tabs.move(tabId, { windowId, index });
});

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

// Una sola ventana de destino: botón directo. Varias: selector, para poder elegir la exacta con teclado.
function moveControl(tab, destinations, key) {
  const label = `${t('moveToOtherWindow')}: ${tab.title}`;
  const number = (win) => String(state.view.windows.indexOf(win) + 1);
  if (destinations.length === 1) {
    const button = el('button', { type: 'button', className: 'action', title: t('moveToOtherWindow') }, glyph('move'));
    button.addEventListener('click', () => moveTab(tab.id, destinations[0].id, -1));
    button.dataset.focus = `${key}:move`;
    button.setAttribute('aria-label', label);
    return button;
  }
  // el selector nativo va invisible sobre el ícono: se conserva su lista y su teclado
  const select = el('select', {},
    el('option', { value: '', textContent: t('moveToOtherWindow') }),
    ...destinations.map((win) => el('option', { value: String(win.id), textContent: t('windowHeading', number(win)) })));
  select.addEventListener('change', () => moveTab(tab.id, Number(select.value), -1));
  select.dataset.focus = `${key}:move`;
  select.setAttribute('aria-label', label);
  return el('span', { className: 'action move-select', title: t('moveToOtherWindow') }, glyph('move'), select);
}

function tabRow(tab, inCurrentWindow) {
  const key = `tab:${tab.id}`;
  const main = el('button', { type: 'button', className: 'main', title: tab.url },
    favicon(tab.favIconUrl, tab.title), el('span', { className: 'title', textContent: tab.title }));
  main.dataset.focus = `${key}:main`;
  if (tab.active) main.setAttribute('aria-current', 'true');
  main.addEventListener('click', () => focusTab(tab));

  const pinLabel = tab.pinId ? t('unpinTab') : t('pinTab');
  const pin = el('button', { type: 'button', className: tab.pinId ? 'action on' : 'action', title: pinLabel }, glyph('pin'));
  pin.dataset.focus = `${key}:pin`;
  pin.setAttribute('aria-label', `${pinLabel}: ${tab.title}`);
  pin.addEventListener('click', () => togglePin(tab));

  const row = el('li', { className: 'row', draggable: true }, main, pin);
  row.classList.toggle('active', tab.active);
  row.classList.toggle('current', tab.active && inCurrentWindow);
  row.classList.toggle('discarded', tab.discarded);

  const destinations = state.view.windows.filter((w) => w.id !== tab.windowId);
  if (destinations.length > 0) row.append(moveControl(tab, destinations, key));

  main.setAttribute('aria-keyshortcuts', 'Alt+ArrowUp Alt+ArrowDown');
  main.addEventListener('keydown', (event) => {
    const step = { ArrowUp: -1, ArrowDown: 1 }[event.key];
    if (!event.altKey || step === undefined) return;
    event.preventDefault();
    const target = tab.index + step;
    const count = state.view.windows.find((w) => w.id === tab.windowId).tabs.length;
    if (target >= 0 && target < count) moveTab(tab.id, tab.windowId, target);
  });

  let after = false;
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
    after = event.clientY > rect.top + rect.height / 2;
    clearDropMarks();
    row.classList.add(after ? 'drop-after' : 'drop-before');
  });
  row.addEventListener('drop', (event) => {
    if (!state.dragging) return;
    event.preventDefault();
    event.stopPropagation();
    const { tabId, windowId, index } = state.dragging;
    const insertBefore = tab.index + (after ? 1 : 0);
    endDrag();
    moveTab(tabId, tab.windowId, dropIndex({ fromWindowId: windowId, fromIndex: index, toWindowId: tab.windowId, insertBefore }));
  });
  return row;
}

function windowSection(win, position) {
  const heading = el('h2', { textContent: t('windowHeading', String(position)) });
  if (win.isCurrent) heading.append(el('span', { className: 'tag', textContent: ` ${t('currentWindow')}` }));
  if (win.minimized) heading.append(el('span', { className: 'tag', textContent: ` ${t('minimizedWindow')}` }));

  const list = el('ul', { className: 'list' }, ...win.tabs.map((tab) => tabRow(tab, win.isCurrent)));
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
    favicon(pin.favIconUrl, pin.title), el('span', { className: 'title', textContent: pin.title }));
  main.dataset.focus = `pin:${pin.id}:main`;
  main.addEventListener('click', () => openOrFocus(pin));
  const remove = el('button', { type: 'button', className: 'action', title: t('unpinTab') }, glyph('x'));
  remove.dataset.focus = `pin:${pin.id}:remove`;
  remove.setAttribute('aria-label', `${t('unpinTab')}: ${pin.title}`);
  remove.addEventListener('click', () => unpin(pin.id));
  return el('li', { className: pin.openTabId === null ? 'row' : 'row active' }, main, remove);
}

function draw() {
  // un render no debe sacarle el foco a quien navega con teclado
  const focused = document.activeElement?.dataset?.focus;
  const filtered = filterView(state.view, state.query);
  $('pins').replaceChildren(...filtered.pins.map(pinRow));
  $('pins-empty').hidden = state.view.pins.length > 0;
  $('windows').replaceChildren(...filtered.windows.map((win) => windowSection(win, state.view.windows.findIndex((w) => w.id === win.id) + 1)));
  $('no-results').hidden = state.query === '' || filtered.windows.length > 0 || filtered.pins.length > 0;
  if (focused) document.querySelector(`[data-focus="${CSS.escape(focused)}"]`)?.focus();
}

function subscribe() {
  for (const event of [
    chrome.tabs.onCreated, chrome.tabs.onRemoved, chrome.tabs.onMoved, chrome.tabs.onAttached,
    chrome.tabs.onDetached, chrome.tabs.onActivated, chrome.tabs.onReplaced,
    chrome.windows.onCreated, chrome.windows.onRemoved, chrome.windows.onFocusChanged, chrome.windows.onBoundsChanged,
  ]) {
    event.addListener(scheduleRender);
  }
  chrome.tabs.onUpdated.addListener((_tabId, change) => {
    if (VISIBLE_TAB_CHANGES.some((key) => key in change)) scheduleRender();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.pins) scheduleRender();
    if (changes.settings) showSettings(changes.settings.newValue);
  });
}

function showSettings(raw) {
  const { side, mode } = normalizeSettings(raw);
  $('setting-side').value = side;
  $('setting-mode').value = mode;
}

async function initSettings() {
  showSettings((await chrome.storage.local.get('settings')).settings);
  const save = run(() => chrome.storage.local.set({
    settings: normalizeSettings({ side: $('setting-side').value, mode: $('setting-mode').value }),
  }));
  $('setting-side').addEventListener('change', save);
  $('setting-mode').addEventListener('change', save);
}

applyStaticText();
document.querySelector('.search').prepend(glyph('search'));
document.querySelector('#settings summary').prepend(glyph('chevron'));
$('search').addEventListener('input', (event) => {
  state.query = event.target.value;
  if (state.view) draw();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeOverlay();
});
subscribe();
initSettings().catch(showError);
render();
$('search').focus();
if (isOverlay) {
  const report = () => parent.postMessage($('search').value || document.activeElement?.tagName === 'SELECT' ? 'zts:busy' : 'zts:idle', '*');
  document.addEventListener('input', report);
  document.addEventListener('focusin', report);
  document.addEventListener('focusout', () => setTimeout(report));
}
