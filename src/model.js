const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const luminance = (rgb) => rgb.map((c) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);

export function contrastForeground(hex) {
  return luminance(rgb(hex)) > 0.179 ? '#000000' : '#ffffff';
}

export function surfaceTint(hex) {
  const foreground = contrastForeground(hex);
  const target = foreground === '#000000' ? 0 : 1;
  const shaded = luminance(rgb(hex).map((c) => c * 0.84 + target * 0.16));
  const contrast = target === 0 ? (shaded + 0.05) / 0.05 : 1.05 / (shaded + 0.05);
  // El margen sobre 4.5:1 absorbe el redondeo de colores en pantalla.
  return contrast >= 4.55 ? foreground : (target === 0 ? '#ffffff' : '#000000');
}

// Sitio (host:puerto, sin distinguir http de https) + ruta sin barra final + query; ignora el hash. null si no es http(s).
export function normalizeUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  return { host: u.host, path: u.pathname.replace(/\/+$/, ''), search: u.search };
}

// Misma dirección exacta (sitio, ruta y query): lo que decide si una pestaña "es" un pin.
function sameTarget(a, b) {
  const x = normalizeUrl(a);
  const y = normalizeUrl(b);
  return Boolean(x && y && x.host === y.host && x.path === y.path && x.search === y.search);
}

export function matchPin(pin, tabs, currentWindowId) {
  const target = normalizeUrl(pin.url);
  if (!target) return;
  let best;
  let bestRank = -1;
  for (const tab of tabs) {
    const url = normalizeUrl(tab.url);
    if (!url || url.host !== target.host || (url.path !== target.path && !url.path.startsWith(target.path + '/'))) continue;
    const rank = (url.path === target.path && url.search === target.search ? 4 : 0) + (tab.windowId === currentWindowId ? 2 : 0) + (tab.active ? 1 : 0);
    if (rank > bestRank) {
      best = tab;
      bestRank = rank;
    }
  }
  return best;
}

export function buildView(windows, pins, { currentWindowId, emptyTitle, pinTabs }) {
  const normal = windows
    .filter((w) => w.type === 'normal' && !w.incognito)
    .sort((a, b) => (a.left ?? 0) - (b.left ?? 0) || a.id - b.id);

  const tabs = normal.flatMap((w) =>
    (w.tabs ?? []).map((t) => {
      const url = t.url || t.pendingUrl || '';
      return {
        id: t.id,
        windowId: w.id,
        index: t.index,
        title: t.title || url || emptyTitle,
        url,
        favIconUrl: t.favIconUrl || '',
        active: Boolean(t.active),
        discarded: Boolean(t.discarded),
        audible: Boolean(t.audible),
        muted: Boolean(t.mutedInfo?.muted),
      };
    }),
  );

  const pinByTab = new Map(tabs.map((tab) => [tab.id, pins.find((pin) => sameTarget(pin.url, tab.url))]));
  const assigned = new Map();
  if (pinTabs) {
    pinByTab.clear();
    for (const pin of pins) {
      const tab = tabs.find((item) => item.id === pinTabs[pin.id]);
      if (tab && !pinByTab.has(tab.id)) {
        pinByTab.set(tab.id, pin);
        assigned.set(pin.id, tab.id);
      }
    }
    const missing = pins.filter((pin) => !(pin.id in pinTabs));
    for (const pin of missing) {
      const exact = matchPin(pin, tabs.filter((tab) => !pinByTab.has(tab.id) && sameTarget(pin.url, tab.url)), currentWindowId);
      if (exact) {
        pinByTab.set(exact.id, pin);
        assigned.set(pin.id, exact.id);
      }
    }
    const candidates = missing.filter((pin) => !assigned.has(pin.id)).map((pin) => [pin, matchPin(pin, tabs.filter((tab) => !pinByTab.has(tab.id)), currentWindowId)]);
    for (const [pin, tab] of candidates) {
      if (tab && candidates.filter(([, candidate]) => candidate?.id === tab.id).length === 1) {
        pinByTab.set(tab.id, pin);
        assigned.set(pin.id, tab.id);
      }
    }
  }
  return {
    windows: normal.map((w) => ({
      id: w.id,
      isCurrent: w.id === currentWindowId,
      minimized: w.state === 'minimized',
      tabs: tabs
        .filter((t) => t.windowId === w.id)
        .map((t) => ({ ...t, pinId: pinByTab.get(t.id)?.id ?? null })),
    })),
    pins: pins.map((p) => ({
      ...p,
      openTabId: pinTabs ? (assigned.get(p.id) ?? null) : (matchPin(p, tabs.filter((tab) => !pinByTab.get(tab.id) || pinByTab.get(tab.id) === p), currentWindowId)?.id ?? null),
    })),
  };
}

export function filterView(view, query) {
  const q = query.trim().toLowerCase();
  if (!q) return view;
  const hit = (x) => x.title.toLowerCase().includes(q) || x.url.toLowerCase().includes(q);
  return {
    windows: view.windows
      .map((w) => ({ ...w, tabs: w.tabs.filter(hit) }))
      .filter((w) => w.tabs.length > 0),
    pins: view.pins.filter(hit),
  };
}

// Devuelve la misma lista si la pestaña no es http(s) o ya hay un pin para esa dirección.
export function addPin(pins, tab, id) {
  if (!normalizeUrl(tab.url) || pins.some((p) => sameTarget(p.url, tab.url))) return pins;
  const url = new URL(tab.url);
  url.hash = '';
  return [...pins, { id, url: url.href, title: tab.title || url.href, favIconUrl: tab.favIconUrl || '' }];
}

export function removePin(pins, id) {
  return pins.filter((p) => p.id !== id);
}

// Índice final que espera tabs.move al soltar antes de `insertBefore` (posición en la lista original).
export function dropIndex({ fromWindowId, fromIndex, toWindowId, insertBefore }) {
  if (fromWindowId === toWindowId && insertBefore > fromIndex) return insertBefore - 1;
  return insertBefore;
}

// Qué hace el clic en una pestaña: traerla a la ventana actual ('bring') o ir a su ventana ('go'). Shift fuerza ir.
// Mover la única pestaña de una ventana la cerraría, así que en ese caso también se va.
export function clickAction({ tabWindowId, windowTabCount, hereWindowId, shift }) {
  if (tabWindowId === hereWindowId) return 'stay';
  return shift || windowTabCount === 1 ? 'go' : 'bring';
}

// Pestañas sobrantes entre las que apuntan a la misma dirección exacta: de cada grupo se conserva la activa, o la primera.
export function duplicateTabIds(view) {
  const groups = new Map();
  for (const win of view.windows) {
    for (const tab of win.tabs) {
      const n = normalizeUrl(tab.url);
      if (!n) continue;
      const key = `${n.host}${n.path}${n.search}`;
      groups.set(key, [...(groups.get(key) ?? []), tab]);
    }
  }
  const extra = [];
  for (const tabs of groups.values()) {
    const keep = tabs.find((t) => t.active) ?? tabs[0];
    for (const tab of tabs) if (tab !== keep && !tab.pinId) extra.push(tab.id);
  }
  return extra;
}

// Reordena un pin delante de `beforeId` (null: al final). Devuelve la misma lista si no cambia nada.
export function movePin(pins, id, beforeId) {
  const item = pins.find((p) => p.id === id);
  if (!item) return pins;
  const rest = pins.filter((p) => p.id !== id);
  const at = beforeId === null ? rest.length : rest.findIndex((p) => p.id === beforeId);
  if (at < 0) return pins;
  rest.splice(at, 0, item);
  return rest.every((p, i) => p === pins[i]) ? pins : rest;
}

// Lee una copia exportada: solo pins http(s) válidos y sin duplicados, y los ajustes normalizados. null si no es una copia.
export function parseBackup(text, normalizeSettings) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (data?.app !== 'tab-shelf' || !Array.isArray(data.pins)) return null;
  const text_ = (v) => (typeof v === 'string' ? v : '');
  const pins = data.pins
    .filter((p) => typeof p?.url === 'string' && normalizeUrl(p.url))
    .map((p) => ({ url: p.url, title: text_(p.title), favIconUrl: normalizeUrl(text_(p.favIconUrl)) ? p.favIconUrl : '' }));
  return { pins, settings: normalizeSettings(data.settings) };
}
