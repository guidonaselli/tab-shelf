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

// Un pin cubre su sitio y todo lo que cuelga de su ruta; la query no cuenta.
function matches(pin, tab) {
  const p = normalizeUrl(pin.url);
  const t = normalizeUrl(tab.url);
  if (!p || !t || p.host !== t.host) return false;
  return t.path === p.path || t.path.startsWith(p.path + '/');
}

// Misma dirección exacta (sitio, ruta y query): lo que decide si una pestaña "es" un pin.
function sameTarget(a, b) {
  const x = normalizeUrl(a);
  const y = normalizeUrl(b);
  return Boolean(x && y && x.host === y.host && x.path === y.path && x.search === y.search);
}

// Entre varias pestañas que coinciden gana la de la ventana actual, luego la activa.
export function matchPin(pin, tabs, currentWindowId) {
  const rank = (t) => (t.windowId === currentWindowId ? 2 : 0) + (t.active ? 1 : 0);
  let best;
  for (const t of tabs) {
    if (matches(pin, t) && (!best || rank(t) > rank(best))) best = t;
  }
  return best;
}

export function buildView(windows, pins, { currentWindowId, emptyTitle }) {
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

  return {
    windows: normal.map((w) => ({
      id: w.id,
      isCurrent: w.id === currentWindowId,
      minimized: w.state === 'minimized',
      tabs: tabs
        .filter((t) => t.windowId === w.id)
        .map((t) => ({ ...t, pinId: pins.find((p) => sameTarget(p.url, t.url))?.id ?? null })),
    })),
    pins: pins.map((p) => ({ ...p, openTabId: matchPin(p, tabs, currentWindowId)?.id ?? null })),
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
    for (const tab of tabs) if (tab !== keep) extra.push(tab.id);
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
