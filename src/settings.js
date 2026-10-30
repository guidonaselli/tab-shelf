export const SIDES = ['left', 'right'];
export const MODES = ['hover', 'off'];
export const DEFAULT_SETTINGS = { side: 'left', mode: 'hover' };

export function normalizeSettings(raw) {
  return {
    side: SIDES.includes(raw?.side) ? raw.side : DEFAULT_SETTINGS.side,
    mode: MODES.includes(raw?.mode) ? raw.mode : DEFAULT_SETTINGS.mode,
  };
}
