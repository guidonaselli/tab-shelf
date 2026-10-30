// Content script: panel pegado al borde de la página que aparece al pasar el mouse por el costado.
(async () => {
  const { normalizeSettings } = await import(chrome.runtime.getURL('src/settings.js'));

  const ZONE_PX = 32;
  const WIDTH_PX = 340;
  const REVEAL_DELAY_MS = 200;
  const HIDE_DELAY_MS = 350;
  const EXTENSION_ORIGIN = new URL(chrome.runtime.getURL('')).origin;

  const STYLE = `
    :host { all: initial; }
    .panel { position: fixed; top: 8px; z-index: 2147483647; width: ${WIDTH_PX}px; max-width: calc(90vw - 16px); height: calc(100vh - 16px);
      overflow: hidden; border-radius: 12px; visibility: hidden; transform: translateX(var(--off)); background: Canvas;
      box-shadow: 0 0 0 1px rgb(128 128 128 / 30%), 0 8px 24px rgb(0 0 0 / 30%); transition: transform 140ms cubic-bezier(.2, 0, 0, 1), visibility 140ms; }
    .panel.open { visibility: visible; transform: none; }
    :host([data-side=left]) { --off: calc(-100% - 16px); }
    :host([data-side=right]) { --off: calc(100% + 16px); }
    :host([data-side=left]) .panel { left: 8px; }
    :host([data-side=right]) .panel { right: 8px; }
    iframe { width: 100%; height: 100%; border: 0; color-scheme: light dark; }
    @media (prefers-reduced-motion: reduce) { .panel { transition: none; } }
  `;

  let settings = normalizeSettings((await chrome.storage.local.get('settings')).settings);
  let ui = null;
  let revealTimer = 0;
  let hideTimer = 0;

  function mount() {
    // un script anterior (extensión recargada) deja su panel huérfano en la página
    for (const stale of document.querySelectorAll('[data-zts-host]')) stale.remove();
    const host = document.createElement('div');
    host.dataset.ztsHost = '';
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = STYLE;
    const panel = document.createElement('div');
    panel.className = 'panel';
    root.append(style, panel);
    document.documentElement.append(host);

    panel.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    // con el foco dentro del panel (escribiendo, select abierto) no se oculta al salir el mouse
    panel.addEventListener('mouseleave', () => {
      if (document.activeElement !== host) hideTimer = setTimeout(hide, HIDE_DELAY_MS);
    });
    ui = { host, panel, frame: null };
  }

  function unmount() {
    clearTimeout(revealTimer);
    revealTimer = 0;
    clearTimeout(hideTimer);
    ui?.host.remove();
    ui = null;
  }

  async function show() {
    if (!ui || ui.panel.classList.contains('open')) return;
    try {
      const windowId = await chrome.runtime.sendMessage('zts:window');
      if (!ui) return;
      ui.frame = document.createElement('iframe');
      ui.frame.src = `${chrome.runtime.getURL('panel.html')}?window=${windowId}`;
      ui.panel.append(ui.frame);
      ui.panel.classList.add('open');
      ui.frame.focus();
    } catch {
      // la extensión se recargó: este script quedó huérfano
      unmount();
    }
  }

  function hide() {
    if (!ui) return;
    const { panel, frame } = ui;
    panel.classList.remove('open');
    setTimeout(() => { if (!panel.classList.contains('open')) frame?.remove(); }, 200);
  }

  function apply() {
    if (settings.mode === 'off') return unmount();
    if (!ui) mount();
    ui.host.dataset.side = settings.side;
  }

  // La zona se detecta por posición en el documento, no con un elemento: ningún elemento de la página puede taparla.
  function inZone(event) {
    if (settings.side === 'left') return event.clientX <= ZONE_PX;
    return event.clientX >= document.documentElement.clientWidth - ZONE_PX;
  }

  window.addEventListener('mousemove', (event) => {
    if (!ui) return;
    if (event.buttons === 0 && inZone(event)) {
      if (!revealTimer) revealTimer = setTimeout(() => { revealTimer = 0; show(); }, REVEAL_DELAY_MS);
    } else {
      clearTimeout(revealTimer);
      revealTimer = 0;
    }
  }, { capture: true, passive: true });
  document.addEventListener('pointerdown', (event) => {
    if (ui && !event.composedPath().includes(ui.host)) hide();
  }, true);
  window.addEventListener('message', (event) => {
    if (event.origin === EXTENSION_ORIGIN && event.source === ui?.frame?.contentWindow && event.data === 'zts:close') hide();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.settings) return;
    settings = normalizeSettings(changes.settings.newValue);
    apply();
  });

  apply();
})();
