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

// el panel de borde vive en una página: pregunta a qué ventana pertenece
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message === 'zts:window') sendResponse(sender.tab?.windowId);
});

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
