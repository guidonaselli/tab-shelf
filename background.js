// sin side panel (U en Helium) el mismo panel.html abre como popup de la acción
if (chrome.sidePanel) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
} else {
  chrome.action.setPopup({ popup: 'panel.html' }).catch(console.error);
}
