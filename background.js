import { addPin, removePin, movePin, parseBackup, clickAction, matchPin } from './src/model.js';
import './src/settings.js';

const OVERLAY_FILES = ['src/settings.js', 'overlay.js'];

// sin side panel el mismo panel.html abre como popup de la acción
function configure() {
  if (chrome.sidePanel) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
  } else {
    chrome.action.setPopup({ popup: 'panel.html' }).catch(console.error);
  }
}

configure();
chrome.runtime.onInstalled.addListener(configure);
chrome.runtime.onStartup.addListener(configure);

let pinQueue = Promise.resolve();
function queuePinWork(action) {
  const next = pinQueue.then(action);
  pinQueue = next.catch(() => {});
  return next;
}

function updatePins(command) {
  return queuePinWork(async () => {
    const { pins = [] } = await chrome.storage.local.get('pins');
    const { pinTabs = {} } = await chrome.storage.session.get('pinTabs');
    let sessionChanged = false;
    let updated;
    let settings;
    const result = { ok: true };
    if (['remove', 'move', 'step'].includes(command.op) && typeof command.id !== 'string') throw new Error('Invalid pin ID');
    switch (command.op) {
      case 'add':
        if (typeof command.tab?.url !== 'string' || (command.tab.title !== undefined && typeof command.tab.title !== 'string') || (command.tab.favIconUrl !== undefined && typeof command.tab.favIconUrl !== 'string')) throw new Error('Invalid pin');
        updated = addPin(pins, command.tab, crypto.randomUUID());
        if (updated !== pins && Number.isInteger(command.tab.id)) {
          pinTabs[updated.at(-1).id] = command.tab.id;
          sessionChanged = true;
        }
        break;
      case 'remove':
        updated = removePin(pins, command.id);
        if (Object.hasOwn(pinTabs, command.id)) {
          delete pinTabs[command.id];
          sessionChanged = true;
        }
        break;
      case 'move':
        if (command.beforeId !== null && typeof command.beforeId !== 'string') throw new Error('Invalid destination');
        updated = movePin(pins, command.id, command.beforeId);
        break;
      case 'step': {
        if (command.step !== -1 && command.step !== 1) throw new Error('Invalid pin step');
        const index = pins.findIndex((pin) => pin.id === command.id);
        const target = index + command.step;
        result.position = index >= 0 && target >= 0 && target < pins.length ? target + 1 : 0;
        updated = result.position ? movePin(pins, command.id, command.step < 0 ? pins[target].id : (pins[index + 2]?.id ?? null)) : pins;
        break;
      }
      case 'reconcile': {
        if (!Array.isArray(command.matches)) throw new Error('Invalid pin matches');
        for (const item of command.matches) {
          const pin = pins.find((entry) => entry.id === item.id);
          if (!pin || Object.hasOwn(pinTabs, pin.id) || !Number.isInteger(item.tabId) || Object.values(pinTabs).includes(item.tabId)) continue;
          const tab = await chrome.tabs.get(item.tabId).catch(() => null);
          if (tab && matchPin(pin, [tab], tab.windowId)) {
            pinTabs[pin.id] = tab.id;
            sessionChanged = true;
          }
        }
        break;
      }
      case 'open': {
        const pin = pins.find((item) => item.id === command.id);
        if (!pin || !Number.isInteger(command.windowId)) throw new Error('Invalid pin or window');
        let tab;
        const tabId = pinTabs[pin.id];
        if (Number.isInteger(tabId)) tab = await chrome.tabs.get(tabId);
        if (!Object.hasOwn(pinTabs, pin.id) && Number.isInteger(command.candidateId) && !Object.values(pinTabs).includes(command.candidateId)) {
          const candidate = await chrome.tabs.get(command.candidateId).catch(() => null);
          if (candidate && matchPin(pin, [candidate], command.windowId)) {
            tab = candidate;
            pinTabs[pin.id] = tab.id;
            sessionChanged = true;
          }
        }
        if (!tab) {
          tab = await chrome.tabs.create({ url: pin.url, windowId: command.windowId });
          pinTabs[pin.id] = tab.id;
          sessionChanged = true;
        } else {
          const tabs = await chrome.tabs.query({ windowId: tab.windowId });
          const action = clickAction({ tabWindowId: tab.windowId, windowTabCount: tabs.length, hereWindowId: command.windowId, shift: false });
          if (action === 'bring') await chrome.tabs.move(tab.id, { windowId: command.windowId, index: -1 });
          await chrome.tabs.update(tab.id, { active: true });
          await chrome.windows.update(action === 'go' ? tab.windowId : command.windowId, { focused: true });
        }
        result.tabId = tab.id;
        break;
      }
      case 'import': {
        const backup = parseBackup(command.text, globalThis.ztsSettings.normalizeSettings);
        if (!backup) throw new Error('Invalid backup');
        updated = backup.pins.reduce((list, pin) => addPin(list, pin, crypto.randomUUID()), pins);
        settings = backup.settings;
        result.added = updated.length - pins.length;
        break;
      }
      default:
        throw new Error('Invalid pin operation');
    }
    if (settings) await chrome.storage.local.set({ pins: updated, settings });
    else if (updated && updated !== pins) await chrome.storage.local.set({ pins: updated });
    if (sessionChanged) await chrome.storage.session.set({ pinTabs });
    return result;
  });
}

function updatePinTab(removedId, replacementId) {
  return queuePinWork(async () => {
    const { pinTabs = {} } = await chrome.storage.session.get('pinTabs');
    let changed = false;
    for (const id of Object.keys(pinTabs)) {
      if (pinTabs[id] === removedId) {
        pinTabs[id] = replacementId;
        changed = true;
      }
    }
    if (changed) await chrome.storage.session.set({ pinTabs });
  });
}

chrome.tabs.onRemoved.addListener((tabId) => updatePinTab(tabId, null));
chrome.tabs.onReplaced.addListener((addedId, removedId) => updatePinTab(removedId, addedId));

let overlayQueue = Promise.resolve();
function updateOverlays(action) {
  const next = overlayQueue.then(async () => {
    const { overlays = {}, overlayQueries = {}, overlayFocus = {} } = await chrome.storage.session.get(['overlays', 'overlayQueries', 'overlayFocus']);
    const result = await action(overlays, overlayQueries, overlayFocus);
    await chrome.storage.session.set({ overlays, overlayQueries, overlayFocus });
    return result;
  });
  overlayQueue = next.catch(console.error);
  return next;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.pins) {
    updatePins(message.pins).then(sendResponse, (error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message === 'zts:window') return sendResponse(sender.tab?.windowId);
  if (!message?.overlay || !sender.tab) return;
  const { id, windowId, active } = sender.tab;
  updateOverlays(async (overlays, queries, focus) => {
    if (message.overlay === 'open' && active) {
      overlays[windowId] = id;
      if (message.focused === true) focus[windowId] = true;
    }
    if (message.overlay === 'closed' && overlays[windowId] === id) {
      delete overlays[windowId];
      delete queries[windowId];
      delete focus[windowId];
    }
    if (message.overlay === 'focus' && overlays[windowId] === id && typeof message.focused === 'boolean') focus[windowId] = message.focused;
    if (overlays[windowId] === id && message.overlay === 'query' && typeof message.query === 'string') queries[windowId] = message.query;
    if (message.overlay === 'query-read') return overlays[windowId] === id ? (queries[windowId] ?? '') : '';
    if (message.overlay === 'ready' && active && overlays[windowId] === id) {
      await chrome.tabs.sendMessage(id, focus[windowId] ? 'zts:reveal-focus' : 'zts:reveal').catch(() => {});
    }
  }).then((result) => sendResponse(result ?? true), () => sendResponse(false));
  return true;
});

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => updateOverlays(async (overlays, _queries, focus) => {
  const previous = overlays[windowId];
  if (previous === undefined) return;
  overlays[windowId] = tabId;
  if (previous !== tabId) await chrome.tabs.sendMessage(previous, 'zts:conceal').catch(() => {});
  await chrome.tabs.sendMessage(tabId, focus[windowId] ? 'zts:reveal-focus' : 'zts:reveal').catch(() => {});
}));

chrome.windows.onRemoved.addListener((windowId) => updateOverlays((overlays, queries, focus) => { delete overlays[windowId]; delete queries[windowId]; delete focus[windowId]; }));

// Al instalar o recargar la extensión las pestañas abiertas conservan un script huérfano: se reemplaza sin recargarlas
// (no en chrome_update: ahí los scripts siguen vivos y quedarían dos copias)
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== 'install' && reason !== 'update') return;
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  await Promise.allSettled(tabs.map((tab) => chrome.scripting.executeScript({ target: { tabId: tab.id }, files: OVERLAY_FILES })));
});

// El atajo abre el panel de borde de la pestaña activa; donde no hay (chrome://, sitio desactivado) cae al side panel.
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'toggle-panel' || !tab) return;
  const shown = await chrome.tabs.sendMessage(tab.id, 'zts:toggle').catch(() => false);
  if (!shown && chrome.sidePanel) await chrome.sidePanel.open({ windowId: tab.windowId }).catch(console.error);
});
