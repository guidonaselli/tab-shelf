// Trazos de Lucide (ISC), un solo set y un solo grosor para todos los íconos del panel.
const PATHS = {
  pin: ['M12 17v5', 'M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z'],
  x: ['M18 6 6 18', 'm6 6 12 12'],
  move: ['M7 7h10v10', 'M7 17 17 7'],
  search: ['m21 21-4.34-4.34', 'M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0z'],
  chevron: ['m9 18 6-6-6-6'],
};

const SVG_NS = 'http://www.w3.org/2000/svg';

export function glyph(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', `glyph glyph-${name}`);
  svg.setAttribute('aria-hidden', 'true');
  for (const d of PATHS[name]) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}
