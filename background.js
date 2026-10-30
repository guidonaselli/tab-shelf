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
chrome.runtime.onInstalled.addListener(async () => {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  await Promise.allSettled(tabs.map((tab) => chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['overlay.js'] })));
});
