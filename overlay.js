// Content script: panel pegado al borde de la página que aparece al pasar el mouse por el costado.
(async () => {
  const { normalizeSettings, isDisabledHost, SPEEDS } = globalThis.ztsSettings;
  const EXTENSION_ORIGIN = new URL(chrome.runtime.getURL('')).origin;

  const STYLE = `
    :host { all: initial; }
    .panel { position: fixed; top: 8px; z-index: 2147483647; width: var(--w); max-width: calc(90vw - 16px); height: calc(100vh - 16px);
      overflow: hidden; border-radius: 12px; visibility: hidden; transform: translateX(var(--off)); color-scheme: light dark; background: light-dark(#f7f8f9, #1b1c1e);
      box-shadow: 0 0 0 1px rgb(128 128 128 / 30%), 0 8px 24px rgb(0 0 0 / 30%); transition: transform 140ms cubic-bezier(.2, 0, 0, 1), visibility 140ms; }
    .panel.instant { transition: none; }
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
  let holdOpen = false;
  let panelFocused = false;
  let pendingFocus = false;
  let showGeneration = 0;

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

    panel.addEventListener('mouseenter', () => { hovered = true; clearTimeout(hideTimer); hideTimer = 0; });
    panel.addEventListener('mouseleave', (event) => {
      hovered = false;
      if (event.relatedTarget && !busy) scheduleHide();
    });
    ui = { host, panel, frame: null };
  }

  function unmount() {
    showGeneration++;
    pendingFocus = false;
    clearTimeout(revealTimer);
    revealTimer = 0;
    clearTimeout(hideTimer);
    hideTimer = 0;
    ui?.host.remove();
    ui = null;
  }

  // focus: solo al abrir con el atajo; el hover no debe quitarle el foco a lo que la persona está escribiendo
  async function show({ focus = false, instant = false, sync = true } = {}) {
    if (!ui || ui.panel.classList.contains('open') || (pendingFocus && !focus)) return;
    pendingFocus = focus;
    const generation = ++showGeneration;
    try {
      const windowId = await chrome.runtime.sendMessage('zts:window');
      if (generation !== showGeneration || !ui || ui.panel.classList.contains('open')) return;
      pendingFocus = false;
      const params = new URLSearchParams({ window: windowId, host: location.hostname });
      if (focus) params.set('focus', '1');
      ui.frame?.remove();
      ui.frame = document.createElement('iframe');
      ui.frame.title = chrome.i18n.getMessage('extName');
      ui.frame.src = `${chrome.runtime.getURL('panel.html')}?${params}`;
      ui.panel.append(ui.frame);
      // tras cerrar la pestaña activa el panel ya estaba abierto: reaparece sin deslizarse
      ui.panel.classList.toggle('instant', instant);
      ui.panel.classList.add('open');
      if (sync) await chrome.runtime.sendMessage(focus ? { overlay: 'open', focused: true } : { overlay: 'open' });
      if (generation !== showGeneration || !ui) return;
      if (instant) requestAnimationFrame(() => requestAnimationFrame(() => ui?.panel.classList.remove('instant')));
      if (focus) ui.frame.focus();
    } catch {
      // la extensión se recargó: este script quedó huérfano
      if (generation === showGeneration) unmount();
    }
  }

  function scheduleHide() {
    if (!hideTimer) hideTimer = setTimeout(() => { hideTimer = 0; hide(); }, SPEEDS[settings.speed].hide);
  }

  function hide(sync = true) {
    showGeneration++;
    pendingFocus = false;
    clearTimeout(revealTimer);
    revealTimer = 0;
    if (!ui || !ui.panel.classList.contains('open')) return;
    if (sync) chrome.runtime.sendMessage({ overlay: 'closed' }).catch(() => {});
    clearTimeout(hideTimer);
    hideTimer = 0;
    busy = false;
    hovered = false;
    holdOpen = false;
    panelFocused = false;
    const { panel, frame } = ui;
    panel.classList.remove('open');
    setTimeout(() => { if (ui?.frame !== frame || !panel.classList.contains('open')) frame?.remove(); }, 200);
  }

  function apply() {
    if (settings.mode === 'off' || isDisabledHost(location.hostname, settings.disabledHosts)) {
      hide();
      return unmount();
    }
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
    holdOpen = false;
    if (event.buttons === 0 && !pageOwnsPointer() && inZone(event)) {
      if (!revealTimer) revealTimer = setTimeout(() => { revealTimer = 0; show(); }, SPEEDS[settings.speed].reveal);
    } else {
      clearTimeout(revealTimer);
      revealTimer = 0;
      if (ui.panel.classList.contains('open') && !hovered && !busy && !event.composedPath().includes(ui.host)) scheduleHide();
    }
  }, { capture: true, passive: true });
  document.addEventListener('pointerdown', (event) => {
    if (!ui) return;
    const path = event.composedPath();
    if (path.includes(ui.host)) return;
    const opensTab = path.some((node) => (node.matches?.('a[href]') || node.matches?.('area[href]')) &&
      (event.button === 1 || event.ctrlKey || event.metaKey || (event.button === 0 && node.getAttribute('target')?.toLowerCase() === '_blank')));
    if (opensTab) {
      holdOpen = true;
      clearTimeout(hideTimer);
      hideTimer = 0;
    } else hide();
  }, true);
  document.addEventListener('focusin', (event) => {
    if (!ui?.panel.classList.contains('open') || !document.hasFocus()) return;
    if (event.composedPath().includes(ui.host)) panelFocused = true;
    else if (panelFocused) {
      panelFocused = false;
      chrome.runtime.sendMessage({ overlay: 'focus', focused: false }).catch(() => {});
    }
  }, true);
  window.addEventListener('message', (event) => {
    if (event.origin !== EXTENSION_ORIGIN || event.source !== ui?.frame?.contentWindow) return;
    if (event.data === 'zts:close') hide();
    else if (event.data === 'zts:focused') panelFocused = true;
    else if (event.data === 'zts:busy') {
      busy = true;
      clearTimeout(hideTimer);
      hideTimer = 0;
    }
    else if (event.data === 'zts:idle') {
      const wasBusy = busy;
      busy = false;
      // si el mouse ya salió mientras estaba ocupado, nadie más va a programar el cierre
      if (wasBusy && !hovered && !holdOpen && document.hasFocus()) scheduleHide();
    }
  });
  for (const type of ['fullscreenchange', 'pointerlockchange']) {
    document.addEventListener(type, () => { if (pageOwnsPointer()) hide(); });
  }
  // atajo de teclado: responde si el panel de borde está disponible aquí; si no, quien lo pidió usa el side panel
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message === 'zts:reveal' || message === 'zts:reveal-focus') {
      clearTimeout(revealTimer);
      revealTimer = 0;
      if (ui && !pageOwnsPointer()) show({ focus: message === 'zts:reveal-focus', instant: true, sync: false });
      return;
    }
    if (message === 'zts:conceal' || message === 'zts:relocated') {
      hide(false);
      return;
    }
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
  if (ui) chrome.runtime.sendMessage({ overlay: 'ready' }).catch(() => {});
})();
