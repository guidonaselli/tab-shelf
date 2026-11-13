import { contrastForeground, surfaceTint, buildView, filterView, duplicateTabIds, parseBackup, PLACEHOLDER_URL } from './src/model.js';
import './src/settings.js';
import { glyph } from './src/icons.js';

const RENDER_DELAY_MS = 100;
const DRAG_TYPE = 'application/x-zts-tab';
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
// cambios de pestaña que alteran lo que se dibuja; el resto (audible, groupId…) no justifica un render
const VISIBLE_TAB_CHANGES = ['title', 'url', 'favIconUrl', 'status', 'discarded', 'audible', 'mutedInfo'];
const { normalizeSettings, isDisabledHost } = globalThis.ztsSettings;

// dentro del panel de borde (iframe en una página) la ventana actual es la de esa página
const params = new URLSearchParams(location.search);
const overlayWindow = params.get('window');
const isOverlay = overlayWindow !== null;

const t = (key, ...substitutions) => chrome.i18n.getMessage(key, substitutions);
const $ = (id) => document.getElementById(id);

const state = { view: null, query: '', dragging: null, renderPending: false, renderSeq: 0, timer: 0, pendingFocus: null, settings: normalizeSettings(), host: '', pinDrag: null, dupIds: [] };
const isDragging = () => state.dragging !== null || state.pinDrag !== null;
let queryEdited = false;

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
  if (isOverlay) {
    const windowId = await chrome.runtime.sendMessage('zts:window');
    if (Number.isInteger(windowId)) return windowId;
    return Number(overlayWindow);
  }
  return (await chrome.windows.getCurrent()).id;
}

async function readPins() {
  return (await chrome.storage.local.get('pins')).pins ?? [];
}

async function mutatePins(command) {
  const result = await chrome.runtime.sendMessage({ pins: command });
  if (!result?.ok) throw new Error(result?.error || t('pinSaveFailed'));
  return result;
}

async function loadView() {
  const [windows, pins, current, { pinTabs = {}, placeholders = [] }] = await Promise.all([
    chrome.windows.getAll({ populate: true, windowTypes: ['normal'] }),
    readPins(),
    currentWindowId(),
    chrome.storage.session.get(['pinTabs', 'placeholders']),
  ]);
  for (const win of windows) win.tabs = (win.tabs ?? []).filter((tab) => (tab.url || tab.pendingUrl) !== PLACEHOLDER_URL && !(placeholders.includes(tab.id) && (tab.url || tab.pendingUrl) === `chrome-extension://${chrome.runtime.id}/panel.html`));
  const view = buildView(windows, pins, { currentWindowId: current, emptyTitle: t('emptyTabTitle'), pinTabs });
  const tabs = view.windows.flatMap((win) => win.tabs);
  const result = await chrome.runtime.sendMessage({ tabs: { op: 'order', ids: tabs.map((tab) => tab.id) } });
  if (!result?.ok) throw new Error(result?.error || t('orderReloadRequired'));
  const byId = new Map(tabs.map((tab) => [tab.id, tab]));
  view.tabs = result.order.map((id) => byId.get(id)).filter(Boolean);
  const matches = view.pins.filter((pin) => !Object.hasOwn(pinTabs, pin.id) && pin.openTabId !== null)
    .map((pin) => ({ id: pin.id, tabId: pin.openTabId }));
  if (matches.length) await mutatePins({ op: 'reconcile', matches });
  return view;
}

async function render() {
  const seq = ++state.renderSeq;
  try {
    const view = await loadView();
    if (seq !== state.renderSeq) return;
    if (isDragging()) {
      state.renderPending = true;
      return;
    }
    state.view = view;
    const active = view.windows.find((win) => win.isCurrent)?.tabs.find((tab) => tab.active);
    $('current-url').textContent = active?.url || active?.title || '';
    $('current-url').title = active?.url || '';
    $('copy-url').disabled = !active?.url;
    draw();
  } catch (error) {
    showError(error);
  }
}

// Los eventos de tabs llegan en ráfagas: un solo render por ventana de tiempo (no se reinicia, para no
// quedar sin dibujar mientras sigan llegando eventos). Durante un arrastre se difiere.
function scheduleRender() {
  if (isDragging()) {
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
  const letter = () => el('span', { className: 'icon letter', textContent: (graphemes.segment(title.trim())[Symbol.iterator]().next().value?.segment ?? '?').toUpperCase() });
  if (!favIconUrl) return letter();
  const img = el('img', { className: 'icon', alt: '', src: favIconUrl, referrerPolicy: 'no-referrer' });
  img.addEventListener('error', () => img.replaceWith(letter()), { once: true });
  return img;
}

function closeOverlay() {
  if (isOverlay) parent.postMessage('zts:close', '*');
}

async function activate(tab, shift = false) {
  const result = await chrome.runtime.sendMessage({ tabs: { op: 'activate', tabId: tab.id, windowId: await currentWindowId(), shift } });
  if (!result?.ok) throw new Error(result?.error || 'Tab activation failed');
}

const focusTab = run(activate);

const closeDuplicates = run(() => chrome.tabs.remove(state.dupIds));
const closeTab = run((tab) => chrome.tabs.remove(tab.id));
const toggleMute = run((tab) => chrome.tabs.update(tab.id, { muted: !tab.muted }));

const openOrFocus = run(async (pin, shift = false) => {
  await mutatePins({ op: 'open', id: pin.id, windowId: await currentWindowId(), candidateId: pin.openTabId, shift });
});

const togglePin = run((tab) => mutatePins(tab.pinId ? { op: 'remove', id: tab.pinId } : { op: 'add', tab }));
const unpin = run((id) => mutatePins({ op: 'remove', id }));
const movePinned = run((id, beforeId) => mutatePins({ op: 'move', id, beforeId }));

const moveToNewWindow = run(async (tabId) => {
  const result = await chrome.runtime.sendMessage({ tabs: { op: 'newWindow', tabId } });
  if (!result?.ok) throw new Error(result?.error || 'Window creation failed');
});

const moveTab = run(async (tabId, windowId) => {
  const result = await chrome.runtime.sendMessage({ tabs: { op: 'move', tabId, windowId } });
  if (!result?.ok) throw new Error(result?.error || 'Tab move failed');
});

const reorderTab = run(async (tabId, beforeId) => {
  const result = await chrome.runtime.sendMessage({ tabs: { op: 'reorder', tabId, beforeId } });
  if (!result?.ok) throw new Error(result?.error || 'Tab reorder failed');
});

function clearDropMarks() {
  for (const row of document.querySelectorAll('.drop-before, .drop-after')) {
    row.classList.remove('drop-before', 'drop-after');
  }
}

function endDrag() {
  state.dragging = null;
  state.pinDrag = null;
  clearDropMarks();
  for (const row of document.querySelectorAll('.dragging')) row.classList.remove('dragging');
  if (state.renderPending) {
    state.renderPending = false;
    scheduleRender();
  }
}

// Selector nativo invisible sobre el ícono: conserva su lista y su teclado. Una pestaña sola en su ventana no ofrece "ventana nueva".
function moveControl(tab, destinations, key) {
  const label = `${t('moveToOtherWindow')}: ${tab.title}`;
  const number = (win) => String(state.view.windows.indexOf(win) + 1);
  const options = destinations.map((win) => el('option', { value: String(win.id), textContent: t('windowHeading', number(win)) }));
  if (state.view.windows.find((w) => w.id === tab.windowId).tabs.length > 1) {
    options.push(el('option', { value: 'new', textContent: t('moveToNewWindow') }));
  }
  if (options.length === 0) return null;
  const select = el('select', {}, el('option', { value: '', textContent: t('moveToOtherWindow') }), ...options);
  select.addEventListener('change', () => (select.value === 'new' ? moveToNewWindow(tab.id) : moveTab(tab.id, Number(select.value), -1)));
  select.dataset.focus = `${key}:move`;
  select.setAttribute('aria-label', label);
  return el('span', { className: 'action move-select', title: t('moveToOtherWindow') }, glyph('move'), select);
}

// Al cerrar con teclado el foco pasa a la pestaña vecina (draw() lo restaura cuando existe)
function focusNeighbor(tab) {
  const tabs = filterView(state.view, state.query).tabs;
  const i = tabs.findIndex((x) => x.id === tab.id);
  const next = tabs[i + 1] ?? tabs[i - 1];
  state.pendingFocus = next ? `tab:${next.id}:main` : null;
}

// el dominio distingue pestañas homónimas; se recorta antes que el título
function hostLabel(tab) {
  let host = '';
  try {
    host = new URL(tab.url).hostname.replace(/^www\./, '');
  } catch {}
  return el('span', { className: 'host', textContent: tab.title.includes(host) ? '' : host });
}

function tabRow(tab, inCurrentWindow) {
  const key = `tab:${tab.id}`;
  const main = el('button', { type: 'button', className: 'main', title: tab.url },
    favicon(tab.favIconUrl, tab.title), el('span', { className: 'title', textContent: tab.title }), hostLabel(tab));
  main.dataset.focus = `${key}:main`;
  if (tab.active && inCurrentWindow) main.setAttribute('aria-current', 'true');
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
  if (tab.pinId) row.append(pin);
  row.classList.toggle('active', tab.active);
  row.classList.toggle('current', tab.active && inCurrentWindow);
  row.classList.toggle('discarded', tab.discarded);
  if (state.dupIds.includes(tab.id)) {
    row.classList.add('dup');
    main.title = `${tab.url}\n${t('duplicateTab')}`;
  }

  const destinations = state.view.windows.filter((w) => w.id !== tab.windowId);
  const move = moveControl(tab, destinations, key);
  const actions = el('span', { className: 'actions' });
  if (!tab.pinId) actions.append(pin);
  if (move) actions.append(move);
  actions.append(close);
  row.append(actions);

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
    const tabs = state.view.tabs;
    const index = tabs.findIndex((item) => item.id === tab.id);
    const target = index + step;
    if (target >= 0 && target < tabs.length) reorderTab(tab.id, step < 0 ? tabs[target].id : (tabs[target + 1]?.id ?? null));
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
    const { tabId } = state.dragging;
    const tabs = state.view.tabs;
    const beforeId = after ? (tabs[tabs.findIndex((item) => item.id === tab.id) + 1]?.id ?? null) : tab.id;
    endDrag();
    reorderTab(tabId, beforeId);
  });
  return row;
}


function pinRow(pin) {
  const main = el('button', { type: 'button', className: 'main', title: `${pin.title}\n${pin.url}\n${t('pinReorderKeys')}` },
    favicon(pin.favIconUrl, pin.title), el('span', { className: 'title', textContent: pin.title }));
  main.dataset.focus = `pin:${pin.id}:main`;
  main.setAttribute('aria-keyshortcuts', 'Alt+ArrowLeft Alt+ArrowRight');
  main.setAttribute('aria-description', t('pinReorderKeys'));
  main.addEventListener('click', (event) => openOrFocus(pin, event.shiftKey));
  const reorder = run(async (step) => {
    const { position } = await mutatePins({ op: 'step', id: pin.id, step });
    if (position) {
      $('status').className = '';
      $('status').textContent = t('pinMoved', pin.title, String(position));
      $('status').hidden = false;
    }
  });
  main.addEventListener('keydown', (event) => {
    const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || step === undefined) return;
    event.preventDefault();
    reorder(step);
  });
  const remove = el('button', { type: 'button', className: 'action on', title: t('unpinTab') }, glyph('pin'));
  remove.dataset.focus = `pin:${pin.id}:remove`;
  remove.setAttribute('aria-label', `${t('unpinTab')}: ${pin.title}`);
  remove.addEventListener('click', () => unpin(pin.id));
  const row = el('li', { className: pin.openTabId === null ? 'row pin-tile' : 'row pin-tile active', draggable: true }, main, remove);
  row.title = t('reorderPin');
  let after = false;
  row.addEventListener('dragstart', (event) => {
    state.pinDrag = { id: pin.id };
    event.dataTransfer.setData(DRAG_TYPE, pin.id);
    event.dataTransfer.effectAllowed = 'move';
    row.classList.add('dragging');
  });
  row.addEventListener('dragend', endDrag);
  row.addEventListener('dragover', (event) => {
    if (!state.pinDrag) return;
    event.preventDefault();
    const rect = row.getBoundingClientRect();
    after = event.clientX > rect.left + rect.width / 2;
    clearDropMarks();
    row.classList.add(after ? 'drop-after' : 'drop-before');
  });
  row.addEventListener('drop', (event) => {
    if (!state.pinDrag) return;
    event.preventDefault();
    const { id } = state.pinDrag;
    const pins = state.view.pins;
    const beforeId = after ? (pins[pins.findIndex((p) => p.id === pin.id) + 1]?.id ?? null) : pin.id;
    endDrag();
    movePinned(id, beforeId);
  });
  return row;
}

function draw() {
  state.dupIds = duplicateTabIds(state.view);
  $('dup-bar').hidden = state.dupIds.length === 0;
  $('dup-close').textContent = state.dupIds.length === 1 ? t('closeDuplicate') : t('closeDuplicates', String(state.dupIds.length));
  // un render no debe sacarle el foco a quien navega con teclado
  const focused = state.pendingFocus ?? document.activeElement?.dataset?.focus;
  state.pendingFocus = null;
  const filtered = filterView(state.view, state.query);
  $('pins').replaceChildren(...filtered.pins.map(pinRow));
  $('pins-empty').hidden = state.view.pins.length > 0;
  const current = state.view.windows.find((win) => win.isCurrent)?.id;
  $('windows').replaceChildren(el('ul', { className: 'list' }, ...filtered.tabs.map((tab) => tabRow(tab, tab.windowId === current))));
  $('no-results').hidden = state.query === '' || filtered.tabs.length > 0 || filtered.pins.length > 0;
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
    if (area === 'session' && (changes.pinTabs || changes.tabOrder || changes.placeholders)) scheduleRender();
    if (area !== 'local') return;
    if (changes.pins) scheduleRender();
    if (changes.settings) showSettings(changes.settings.newValue);
  });
}

function applyAccent(accent) {
  const style = document.documentElement.style;
  for (const key of ['--surface', '--fg', '--muted', '--accent', '--hover', '--pressed', '--selected', '--danger', '--error-bg']) style.removeProperty(key);
  if (!accent) return;
  const foreground = contrastForeground(accent);
  style.setProperty('--surface', accent);
  style.setProperty('--fg', foreground);
  style.setProperty('--muted', foreground);
  style.setProperty('--accent', foreground);
  style.setProperty('--danger', foreground);
  style.setProperty('--error-bg', 'var(--hover)');
  const tint = surfaceTint(accent);
  style.setProperty('--hover', `color-mix(in srgb, ${accent} 92%, ${tint})`);
  style.setProperty('--pressed', `color-mix(in srgb, ${accent} 86%, ${tint})`);
  style.setProperty('--selected', `color-mix(in srgb, ${accent} 84%, ${tint})`);
}

// El sitio de la pestaña desde la que se abrió el panel: en el panel de borde lo pasa la página; en el side panel, la pestaña activa.
async function currentHost() {
  if (isOverlay) return params.get('host') ?? '';
  const [tab] = await chrome.tabs.query({ active: true, windowId: await currentWindowId() });
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
  $('opacity-value').textContent = `${settings.opacity}%`;
  $('setting-accent').value = settings.accent || '#0b57d0';
  $('setting-zone').value = String(settings.zone);
  $('setting-speed').value = settings.speed;
  $('setting-density').value = settings.density;
  document.documentElement.dataset.density = settings.density;
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

const exportBackup = run(async () => {
  const backup = { app: 'tab-shelf', version: 1, pins: await readPins(), settings: state.settings };
  const link = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })), download: 'tab-shelf-backup.json' });
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
});

const importBackup = run(async (file) => {
  const text = await file.text();
  if (!parseBackup(text, normalizeSettings)) throw new Error(t('backupInvalid'));
  const { added } = await mutatePins({ op: 'import', text });
  const status = $('status');
  status.className = '';
  status.textContent = t('backupImported', String(added));
  status.hidden = false;
});

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
  fromSelect('setting-density', 'density');
  $('dup-close').addEventListener('click', closeDuplicates);
  $('backup-export').addEventListener('click', exportBackup);
  $('backup-import').addEventListener('click', () => $('backup-file').click());
  $('backup-file').addEventListener('change', async (event) => {
    const [file] = event.target.files;
    event.target.value = '';
    if (file) await importBackup(file);
  });
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
  const busy = isDragging() || $('search').value !== '' || settingsOpen() || active === 'SELECT' || (document.hasFocus() && active && active !== 'BODY');
  parent.postMessage(busy ? 'zts:busy' : 'zts:idle', '*');
}

// Navegación con flechas entre la búsqueda y las filas; Enter en la búsqueda abre el primer resultado
function rows() {
  return [...document.querySelectorAll('#pins .main, #windows .main')].filter((row) => !row.closest('[hidden]'));
}

function firstResult() {
  const { pins, tabs } = filterView(state.view, state.query);
  return pins[0] ? { pin: pins[0] } : tabs[0] ? { tab: tabs[0] } : null;
}

applyStaticText();
document.querySelector('.search').prepend(glyph('search'));
$('settings-toggle').append(glyph('sliders'));
$('copy-url').append(glyph('copy'));
$('copy-url').addEventListener('click', run(async () => {
  const [active] = await chrome.tabs.query({ active: true, windowId: await currentWindowId() });
  const url = active?.url || active?.pendingUrl;
  if (!url) throw new Error(t('copyFailed'));
  if (isOverlay) {
    // La política de la página puede bloquear Clipboard API dentro del iframe.
    const input = el('textarea', { value: url });
    input.style.cssText = 'position:fixed;opacity:0';
    document.body.append(input);
    input.select();
    const copied = document.execCommand('copy');
    input.remove();
    $('copy-url').focus();
    if (!copied) throw new Error(t('copyFailed'));
  } else {
    await navigator.clipboard.writeText(url);
  }
  $('status').className = '';
  $('status').textContent = t('urlCopied');
  $('status').hidden = false;
}));
$('settings-toggle').addEventListener('click', () => setSettingsOpen(!settingsOpen()));
$('search').addEventListener('input', (event) => {
  queryEdited = true;
  state.query = event.target.value;
  if (isOverlay) chrome.runtime.sendMessage({ overlay: 'query', query: state.query }).catch(showError);
  if (settingsOpen()) setSettingsOpen(false);
  if (state.view) draw();
});
$('search').addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    rows()[0]?.focus();
  } else if (event.key === 'Enter' && state.query.trim() !== '' && state.view) {
    const result = firstResult();
    if (result?.pin) openOrFocus(result.pin, event.shiftKey);
    else if (result?.tab) focusTab(result.tab, event.shiftKey);
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (settingsOpen()) {
      setSettingsOpen(false);
      $('settings-toggle').focus();
    } else closeOverlay();
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
if (isOverlay) {
  chrome.runtime.sendMessage({ overlay: 'query-read' }).then((query) => {
    if (queryEdited || typeof query !== 'string') return;
    $('search').value = state.query = query;
    if (state.view) draw();
    reportBusy();
  }).catch(showError);
  document.addEventListener('dragstart', () => parent.postMessage('zts:busy', '*'));
  document.addEventListener('dragend', reportBusy);
  document.addEventListener('input', reportBusy);
  document.addEventListener('focusin', () => {
    reportBusy();
    if (document.hasFocus()) {
      parent.postMessage('zts:focused', '*');
      chrome.runtime.sendMessage({ overlay: 'focus', focused: true }).catch(showError);
    }
  });
  document.addEventListener('focusout', () => setTimeout(reportBusy));
}
if (!isOverlay || params.has('focus')) $('search').focus();
