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
