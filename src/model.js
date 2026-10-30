// Sitio + ruta sin barra final; ignora hash y query. null si no es http(s).
export function normalizeUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  return { origin: u.origin, path: u.pathname.replace(/\/+$/, '') };
}

function matches(pin, tab) {
  const p = normalizeUrl(pin.url);
  const t = normalizeUrl(tab.url);
  if (!p || !t || p.origin !== t.origin) return false;
  return t.path === p.path || t.path.startsWith(p.path + '/');
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
    .sort((a, b) => (a.left ?? 0) - (b.left ?? 0));

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
        .map((t) => ({ ...t, pinId: pins.find((p) => matches(p, t))?.id ?? null })),
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

// Devuelve la misma lista si la pestaña no es http(s) o ya hay un pin para esa ruta.
export function addPin(pins, tab, id) {
  const n = normalizeUrl(tab.url);
  if (!n) return pins;
  const same = (p) => {
    const q = normalizeUrl(p.url);
    return q && q.origin === n.origin && q.path === n.path;
  };
  if (pins.some(same)) return pins;
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
