// Content script: panel pegado al borde de la página que aparece al pasar el mouse por el costado.
(async () => {
  const { normalizeSettings } = await import(chrome.runtime.getURL('src/settings.js'));

  const EDGE_PX = 14;
  const HANDLE_PX = 3;
  const WIDTH_PX = 340;
  const REVEAL_DELAY_MS = 120;
  const HIDE_DELAY_MS = 350;
  const EXTENSION_ORIGIN = new URL(chrome.runtime.getURL('')).origin;

  const STYLE = `
    :host { all: initial; }
    .strip, .panel { position: fixed; top: 0; height: 100vh; z-index: 2147483647; }
    .strip { width: ${EDGE_PX}px; background: linear-gradient(var(--toward), rgb(168 122 53 / 60%) ${HANDLE_PX}px, transparent ${HANDLE_PX}px); }
    .panel { width: ${WIDTH_PX}px; max-width: 90vw; visibility: hidden; transform: translateX(var(--off));
      transition: transform 120ms ease-out, visibility 120ms; background: Canvas; box-shadow: 0 0 12px rgb(0 0 0 / 35%); }
    .panel.open { visibility: visible; transform: none; }
    :host([data-side=left]) { --off: -100%; --toward: to right; }
    :host([data-side=right]) { --off: 100%; --toward: to left; }
    :host([data-side=left]) .strip, :host([data-side=left]) .panel { left: 0; }
    :host([data-side=right]) .strip, :host([data-side=right]) .panel { right: 0; }
    iframe { width: 100%; height: 100%; border: 0; color-scheme: light dark; }
    @media (prefers-reduced-motion: reduce) { .panel { transition: none; } }
  `;

  let settings = normalizeSettings((await chrome.storage.local.get('settings')).settings);
  let ui = null;
  let revealTimer = 0;
  let hideTimer = 0;

  function mount() {
    const host = document.createElement('div');
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = STYLE;
    const strip = document.createElement('div');
    strip.className = 'strip';
    const panel = document.createElement('div');
    panel.className = 'panel';
    root.append(style, strip, panel);
    document.documentElement.append(host);

    strip.addEventListener('mouseenter', () => { revealTimer = setTimeout(show, REVEAL_DELAY_MS); });
    strip.addEventListener('mouseleave', () => clearTimeout(revealTimer));
    panel.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    // con el foco dentro del panel (escribiendo, select abierto) no se oculta al salir el mouse
    panel.addEventListener('mouseleave', () => {
      if (document.activeElement !== host) hideTimer = setTimeout(hide, HIDE_DELAY_MS);
    });
    ui = { host, panel, frame: null };
  }

  function unmount() {
    clearTimeout(revealTimer);
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
