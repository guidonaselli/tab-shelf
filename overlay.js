// Content script: panel pegado al borde de la página que aparece al pasar el mouse por el costado.
(async () => {
  const { normalizeSettings, isDisabledHost, SPEEDS } = globalThis.ztsSettings;
  const EXTENSION_ORIGIN = new URL(chrome.runtime.getURL('')).origin;

  const STYLE = `
    :host { all: initial; }
    .panel { position: fixed; top: 8px; z-index: 2147483647; width: var(--w); max-width: calc(90vw - 16px); height: calc(100vh - 16px);
      overflow: hidden; border-radius: 12px; visibility: hidden; transform: translateX(var(--off)); background: Canvas;
      box-shadow: 0 0 0 1px rgb(128 128 128 / 30%), 0 8px 24px rgb(0 0 0 / 30%); transition: transform 140ms cubic-bezier(.2, 0, 0, 1), visibility 140ms; }
    .panel.open { opacity: var(--o); visibility: visible; transform: none; }
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
  let busy = false;
  let hovered = false;

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

    panel.addEventListener('mouseenter', () => { hovered = true; clearTimeout(hideTimer); });
    // con una búsqueda escrita o un select abierto no se oculta al salir el mouse
    panel.addEventListener('mouseleave', () => {
      hovered = false;
      if (!busy) hideTimer = setTimeout(hide, SPEEDS[settings.speed].hide);
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

  // focus: solo al abrir con el atajo; el hover no debe quitarle el foco a lo que la persona está escribiendo
  async function show({ focus = false } = {}) {
    if (!ui || ui.panel.classList.contains('open')) return;
    try {
      const windowId = await chrome.runtime.sendMessage('zts:window');
      if (!ui || ui.panel.classList.contains('open')) return;
      const params = new URLSearchParams({ window: windowId, host: location.hostname });
      if (focus) params.set('focus', '1');
      ui.frame = document.createElement('iframe');
      ui.frame.src = `${chrome.runtime.getURL('panel.html')}?${params}`;
      ui.panel.append(ui.frame);
      ui.panel.classList.add('open');
      if (focus) ui.frame.focus();
    } catch {
      // la extensión se recargó: este script quedó huérfano
      unmount();
    }
  }

  function hide() {
    if (!ui) return;
    busy = false;
    hovered = false;
    const { panel, frame } = ui;
    panel.classList.remove('open');
    setTimeout(() => { if (!panel.classList.contains('open')) frame?.remove(); }, 200);
  }

  function apply() {
    if (settings.mode === 'off' || isDisabledHost(location.hostname, settings.disabledHosts)) return unmount();
    if (!ui) mount();
    ui.host.dataset.side = settings.side;
    ui.host.style.setProperty('--w', `${settings.width}px`);
    ui.host.style.setProperty('--o', settings.opacity / 100);
  }

  // La zona se detecta por posición en el documento, no con un elemento: ningún elemento de la página puede taparla.
  function inZone(event) {
    if (settings.side === 'left') return event.clientX <= settings.zone;
    const width = document.documentElement.clientWidth;
    return event.clientX >= width - settings.zone && event.clientX < width;
  }

  // en pantalla completa o con el puntero capturado (juegos, video) el borde es de la página
  const pageOwnsPointer = () => Boolean(document.fullscreenElement || document.pointerLockElement);

  window.addEventListener('mousemove', (event) => {
    if (!ui) return;
    if (event.buttons === 0 && !pageOwnsPointer() && inZone(event)) {
      if (!revealTimer) revealTimer = setTimeout(() => { revealTimer = 0; show(); }, SPEEDS[settings.speed].reveal);
    } else {
      clearTimeout(revealTimer);
      revealTimer = 0;
    }
  }, { capture: true, passive: true });
  document.addEventListener('pointerdown', (event) => {
    if (ui && !event.composedPath().includes(ui.host)) hide();
  }, true);
  window.addEventListener('message', (event) => {
    if (event.origin !== EXTENSION_ORIGIN || event.source !== ui?.frame?.contentWindow) return;
    if (event.data === 'zts:close') hide();
    else if (event.data === 'zts:busy') busy = true;
    else if (event.data === 'zts:idle') {
      const wasBusy = busy;
      busy = false;
      // si el mouse ya salió mientras estaba ocupado, nadie más va a programar el cierre
      if (wasBusy && !hovered) hideTimer = setTimeout(hide, SPEEDS[settings.speed].hide);
    }
  });
  for (const type of ['fullscreenchange', 'pointerlockchange']) {
    document.addEventListener(type, () => { if (pageOwnsPointer()) hide(); });
  }
  // atajo de teclado: responde si el panel de borde está disponible aquí; si no, quien lo pidió usa el side panel
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message !== 'zts:toggle') return;
    if (!ui || pageOwnsPointer()) return sendResponse(false);
    if (ui.panel.classList.contains('open')) {
      hide();
      return sendResponse(true);
    }
    show({ focus: true }).then(() => sendResponse(true));
    return true;
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.settings) return;
    settings = normalizeSettings(changes.settings.newValue);
    apply();
  });

  apply();
})();
