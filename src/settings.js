export const SIDES = ['left', 'right'];
export const MODES = ['hover', 'off'];
export const WIDTHS = [280, 340, 440, 560];
export const DEFAULT_SETTINGS = { side: 'left', mode: 'hover', width: 340, accent: '', opacity: 100 };

export function normalizeSettings(raw) {
  return {
    side: SIDES.includes(raw?.side) ? raw.side : DEFAULT_SETTINGS.side,
    mode: MODES.includes(raw?.mode) ? raw.mode : DEFAULT_SETTINGS.mode,
    width: WIDTHS.includes(raw?.width) ? raw.width : DEFAULT_SETTINGS.width,
    opacity: Number.isInteger(raw?.opacity) && raw.opacity >= 50 && raw.opacity <= 100 ? raw.opacity : DEFAULT_SETTINGS.opacity,
    accent: /^#[0-9a-f]{6}$/i.test(raw?.accent) ? raw.accent : DEFAULT_SETTINGS.accent,
  };
}
