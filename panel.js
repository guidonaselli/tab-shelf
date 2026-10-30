import { buildView, filterView, addPin, removePin, dropIndex, clickAction } from './src/model.js';
import './src/settings.js';
import { glyph } from './src/icons.js';

const RENDER_DELAY_MS = 100;
const DRAG_TYPE = 'application/x-zts-tab';
// cambios de pestaña que alteran lo que se dibuja; el resto (audible, groupId…) no justifica un render
const VISIBLE_TAB_CHANGES = ['title', 'url', 'favIconUrl', 'status', 'discarded', 'audible', 'mutedInfo'];
const { normalizeSettings, isDisabledHost } = globalThis.ztsSettings;

// dentro del panel de borde (iframe en una página) la ventana actual es la de esa página
const params = new URLSearchParams(location.search);
const overlayWindow = params.get('window');
const isOverlay = overlayWindow !== null;

const t = (key, ...substitutions) => chrome.i18n.getMessage(key, substitutions);
const $ = (id) => document.getElementById(id);

const state = { view: null, query: '', dragging: null, renderPending: false, renderSeq: 0, timer: 0, pendingFocus: null, settings: normalizeSettings(), host: '' };

function applyStaticText() {
  document.documentElement.lang = chrome.i18n.getUILanguage();
  for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  for (const node of document.querySelectorAll('[data-i18n-placeholder]')) {
    node.placeholder = t(node.dataset.i18nPlaceholder);
  }
  for (const node of document.querySelectorAll('[data-i18n-label]')) {
    node.setAttribute('aria-label', t(node.dataset.i18nLabel));
  }
  for (const node of document.querySelectorAll('[data-i18n-title]')) node.title = t(node.dataset.i18nTitle);
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

// 'bring' trae la pestaña a la ventana actual; 'go' va a la suya. focused:true también restaura una ventana minimizada (verificado en Helium)
async function activate(tab, shift = false) {
  const here = await currentWindowId();
  const windowTabCount = state.view.windows.find((w) => w.id === tab.windowId)?.tabs.length ?? 0;
  const action = clickAction({ tabWindowId: tab.windowId, windowTabCount, hereWindowId: here, shift });
  if (action === 'bring') await chrome.tabs.move(tab.id, { windowId: here, index: -1 });
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(action === 'go' ? tab.windowId : here, { focused: true });
  closeOverlay();
}

const focusTab = run(activate);

const closeTab = run((tab) => chrome.tabs.remove(tab.id));
const toggleMute = run((tab) => chrome.tabs.update(tab.id, { muted: !tab.muted }));

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

// Al cerrar con teclado el foco pasa a la pestaña vecina (draw() lo restaura cuando existe)
function focusNeighbor(tab) {
  const tabs = state.view.windows.find((w) => w.id === tab.windowId)?.tabs ?? [];
  const i = tabs.findIndex((x) => x.id === tab.id);
  const next = tabs[i + 1] ?? tabs[i - 1];
  state.pendingFocus = next ? `tab:${next.id}:main` : null;
}

function tabRow(tab, inCurrentWindow) {
  const key = `tab:${tab.id}`;
  const main = el('button', { type: 'button', className: 'main', title: tab.url },
    favicon(tab.favIconUrl, tab.title), el('span', { className: 'title', textContent: tab.title }));
  main.dataset.focus = `${key}:main`;
  if (tab.active) main.setAttribute('aria-current', 'true');
  main.addEventListener('click', (event) => focusTab(tab, event.shiftKey));
  main.addEventListener('mousedown', (event) => { if (event.button === 1) event.preventDefault(); });
  main.addEventListener('auxclick', (event) => { if (event.button === 1) closeTab(tab); });

  const pinLabel = tab.pinId ? t('unpinTab') : t('pinTab');
  const pin = el('button', { type: 'button', className: tab.pinId ? 'action on' : 'action', title: pinLabel }, glyph('pin'));
  pin.dataset.focus = `${key}:pin`;
  pin.setAttribute('aria-label', `${pinLabel}: ${tab.title}`);
  pin.addEventListener('click', () => togglePin(tab));

  const closeLabel = `${t('closeTab')}: ${tab.title}`;
  const close = el('button', { type: 'button', className: 'action', title: t('closeTab') }, glyph('x'));
  close.dataset.focus = `${key}:close`;
  close.setAttribute('aria-label', closeLabel);
  close.addEventListener('click', () => { focusNeighbor(tab); closeTab(tab); });

  const row = el('li', { className: 'row', draggable: true }, main);
  if (tab.audible || tab.muted) {
    const muteLabel = tab.muted ? t('unmuteTab') : t('muteTab');
    const mute = el('button', { type: 'button', className: tab.muted ? 'action live quiet' : 'action live', title: muteLabel }, glyph(tab.muted ? 'volume-off' : 'volume'));
    mute.dataset.focus = `${key}:mute`;
    mute.setAttribute('aria-label', `${muteLabel}: ${tab.title}`);
    mute.addEventListener('click', () => toggleMute(tab));
    row.append(mute);
  }
  row.append(pin);
  row.classList.toggle('active', tab.active);
  row.classList.toggle('current', tab.active && inCurrentWindow);
  row.classList.toggle('discarded', tab.discarded);

  const destinations = state.view.windows.filter((w) => w.id !== tab.windowId);
  if (destinations.length > 0) row.append(moveControl(tab, destinations, key));
  row.append(close);

  main.setAttribute('aria-keyshortcuts', 'Alt+ArrowUp Alt+ArrowDown');
  main.addEventListener('keydown', (event) => {
    if (event.key === 'Delete' && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      focusNeighbor(tab);
      closeTab(tab);
      return;
    }
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
  const remove = el('button', { type: 'button', className: 'action on', title: t('unpinTab') }, glyph('pin'));
  remove.dataset.focus = `pin:${pin.id}:remove`;
  remove.setAttribute('aria-label', `${t('unpinTab')}: ${pin.title}`);
  remove.addEventListener('click', () => unpin(pin.id));
  return el('li', { className: pin.openTabId === null ? 'row' : 'row active' }, main, remove);
}

function draw() {
  // un render no debe sacarle el foco a quien navega con teclado
  const focused = state.pendingFocus ?? document.activeElement?.dataset?.focus;
  state.pendingFocus = null;
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

function applyAccent(accent) {
  if (accent) document.documentElement.style.setProperty('--accent', accent);
  else document.documentElement.style.removeProperty('--accent');
}

// El sitio de la pestaña desde la que se abrió el panel: en el panel de borde lo pasa la página; en el side panel, la pestaña activa.
async function currentHost() {
  if (isOverlay) return params.get('host') ?? '';
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const url = normalizeHostUrl(tab?.url);
  return url ?? '';
}

function normalizeHostUrl(raw) {
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.hostname : null;
  } catch {
    return null;
  }
}

function showSettings(raw) {
  const settings = normalizeSettings(raw);
  state.settings = settings;
  $('setting-side').value = settings.side;
  $('setting-mode').value = settings.mode;
  $('setting-width').value = String(settings.width);
  $('setting-opacity').value = String(settings.opacity);
  $('setting-accent').value = settings.accent || '#0b57d0';
  $('setting-zone').value = String(settings.zone);
  $('setting-speed').value = settings.speed;
  applyAccent(settings.accent);
  drawSites();
}

function drawSites() {
  const { disabledHosts } = state.settings;
  const disabledHere = state.host !== '' && isDisabledHost(state.host, disabledHosts);
  $('site-current').hidden = state.host === '';
  $('site-host').textContent = state.host;
  $('site-toggle').textContent = t(disabledHere ? 'siteEnable' : 'siteDisable');
  $('site-empty').hidden = disabledHosts.length > 0;
  $('site-list').replaceChildren(...disabledHosts.map((host) => {
    const remove = el('button', { type: 'button', className: 'action live', title: t('siteEnable') }, glyph('x'));
    remove.setAttribute('aria-label', `${t('siteEnable')}: ${host}`);
    remove.addEventListener('click', () => saveSettings({ disabledHosts: disabledHosts.filter((h) => h !== host) }));
    return el('li', { className: 'row site-row' }, el('span', { className: 'title', textContent: host }), remove);
  }));
}

const saveSettings = run((patch) => chrome.storage.local.set({ settings: normalizeSettings({ ...state.settings, ...patch }) }));

async function initSettings() {
  state.host = await currentHost();
  showSettings((await chrome.storage.local.get('settings')).settings);
  const fromSelect = (id, key, parse = (v) => v) => $(id).addEventListener('change', () => saveSettings({ [key]: parse($(id).value) }));
  fromSelect('setting-side', 'side');
  fromSelect('setting-mode', 'mode');
  fromSelect('setting-width', 'width', Number);
  fromSelect('setting-opacity', 'opacity', Number);
  fromSelect('setting-zone', 'zone', Number);
  fromSelect('setting-speed', 'speed');
  $('setting-accent').addEventListener('input', () => applyAccent($('setting-accent').value));
  fromSelect('setting-accent', 'accent');
  $('accent-reset').addEventListener('click', () => saveSettings({ accent: '' }));
  $('site-toggle').addEventListener('click', () => {
    const { disabledHosts } = state.settings;
    const covering = disabledHosts.filter((h) => state.host === h || state.host.endsWith(`.${h}`));
    saveSettings({ disabledHosts: covering.length > 0 ? disabledHosts.filter((h) => !covering.includes(h)) : [...disabledHosts, state.host] });
  });
}

function setSettingsOpen(open) {
  $('settings').hidden = !open;
  $('list-view').hidden = open;
  $('settings-toggle').setAttribute('aria-expanded', String(open));
  reportBusy();
}

const settingsOpen = () => !$('settings').hidden;

// el panel de borde se queda abierto mientras se configura, se busca o hay un selector abierto
function reportBusy() {
  if (!isOverlay) return;
  const active = document.activeElement?.tagName;
  const busy = $('search').value !== '' || settingsOpen() || active === 'SELECT';
  parent.postMessage(busy ? 'zts:busy' : 'zts:idle', '*');
}

// Navegación con flechas entre la búsqueda y las filas; Enter en la búsqueda abre el primer resultado
function rows() {
  return [...document.querySelectorAll('#pins .main, #windows .main')];
}

function firstResult() {
  const { pins, windows } = filterView(state.view, state.query);
  return pins[0] ? { pin: pins[0] } : windows[0]?.tabs[0] ? { tab: windows[0].tabs[0] } : null;
}

applyStaticText();
document.querySelector('.search').prepend(glyph('search'));
$('settings-toggle').append(glyph('sliders'));
$('settings-toggle').addEventListener('click', () => setSettingsOpen(!settingsOpen()));
$('search').addEventListener('input', (event) => {
  state.query = event.target.value;
  if (settingsOpen()) setSettingsOpen(false);
  if (state.view) draw();
});
$('search').addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    rows()[0]?.focus();
  } else if (event.key === 'Enter' && state.query.trim() !== '' && state.view) {
    const result = firstResult();
    if (result?.pin) openOrFocus(result.pin);
    else if (result?.tab) focusTab(result.tab, event.shiftKey);
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (settingsOpen()) setSettingsOpen(false);
    else closeOverlay();
    return;
  }
  const step = { ArrowUp: -1, ArrowDown: 1 }[event.key];
  if (step === undefined || event.altKey || event.ctrlKey || event.metaKey || !event.target.matches?.('.main')) return;
  event.preventDefault();
  const list = rows();
  const next = list[list.indexOf(event.target) + step];
  if (next) next.focus();
  else if (step < 0) $('search').focus();
});
subscribe();
initSettings().catch(showError);
render();
if (!isOverlay || params.has('focus')) $('search').focus();
if (isOverlay) {
  document.addEventListener('dragstart', () => parent.postMessage('zts:busy', '*'));
  document.addEventListener('dragend', reportBusy);
  document.addEventListener('input', reportBusy);
  document.addEventListener('focusin', reportBusy);
  document.addEventListener('focusout', () => setTimeout(reportBusy));
}
