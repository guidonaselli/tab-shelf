// Script clásico (sin export) para que lo carguen igual el content script, el panel y los tests.
globalThis.ztsSettings = (() => {
  const SIDES = ['left', 'right'];
  const MODES = ['hover', 'off'];
  const WIDTHS = [280, 340, 440, 560];
  const ZONES = [4, 16, 32];
  const SPEEDS = { fast: { reveal: 100, hide: 200 }, normal: { reveal: 200, hide: 350 }, slow: { reveal: 400, hide: 600 } };
  const DEFAULTS = { side: 'left', mode: 'hover', width: 340, opacity: 100, accent: '', zone: 32, speed: 'normal', disabledHosts: [] };
  const HOST = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;
  const MAX_HOSTS = 200;

  function normalizeHosts(raw) {
    if (!Array.isArray(raw)) return [];
    const hosts = raw.filter((h) => typeof h === 'string').map((h) => h.trim().toLowerCase()).filter((h) => HOST.test(h));
    return [...new Set(hosts)].slice(0, MAX_HOSTS);
  }

  function normalizeSettings(raw) {
    return {
      side: SIDES.includes(raw?.side) ? raw.side : DEFAULTS.side,
      mode: MODES.includes(raw?.mode) ? raw.mode : DEFAULTS.mode,
      width: WIDTHS.includes(raw?.width) ? raw.width : DEFAULTS.width,
      opacity: Number.isInteger(raw?.opacity) && raw.opacity >= 50 && raw.opacity <= 100 ? raw.opacity : DEFAULTS.opacity,
      accent: /^#[0-9a-f]{6}$/i.test(raw?.accent) ? raw.accent : DEFAULTS.accent,
      zone: ZONES.includes(raw?.zone) ? raw.zone : DEFAULTS.zone,
      speed: Object.hasOwn(SPEEDS, raw?.speed) ? raw.speed : DEFAULTS.speed,
      disabledHosts: normalizeHosts(raw?.disabledHosts),
    };
  }

  // Un sitio desactivado cubre también sus subdominios.
  const isDisabledHost = (hostname, hosts) => hosts.some((h) => hostname === h || hostname.endsWith(`.${h}`));

  return { SIDES, MODES, WIDTHS, ZONES, SPEEDS, DEFAULTS, normalizeSettings, isDisabledHost };
})();
