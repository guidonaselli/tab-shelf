# tab-system-mvp

## Why

Zen comparte la lista de pestañas (fijas y esenciales) entre todas las ventanas; Chromium/Helium
no: una pestaña pertenece a una sola ventana y cambiar entre ventanas es incómodo con dos
monitores. Las extensiones existentes listan pestañas de todas las ventanas pero no tienen
pestañas fijas compartidas con "enfocar o abrir". Zen Tab System es una extensión MV3 local que
lo cubre en un side panel.

## Non-goals

- Reemplazar o esconder la barra de pestañas (lo cubre el layout vertical/frameless de Helium).
- Sincronización en la nube, cuentas, telemetría.
- Spaces/workspaces, grupos de pestañas propios, árbol de pestañas.
- Publicar en la Chrome Web Store; si se publica, renombrar (no sugerir afiliación con Zen).
- Firefox.

## Shape

- Datos: `pins` en `chrome.storage.local`: `[{ id, url, title, favIconUrl }]`. Todo lo demás se
  deriva en cada render de `chrome.windows.getAll({ populate: true })`; no se guarda estado de
  pestañas.
- Lógica pura en `src/model.js` (testeable con `node --test`): `buildView(windows, pins)` y
  `matchPin(pin, tabs)`.
- Acciones sobre APIs de Chromium: `focusTab` (`tabs.update` + `windows.update`), `moveTab`
  (`tabs.move` con `windowId`/`index`), `openOrFocus(pin)`.
- UI: side panel en HTML/CSS/JS plano, sin build ni dependencias.
- Permisos: `tabs`, `sidePanel`, `storage`. Sin permisos de host.
- Fallback si Helium no soporta `chrome.sidePanel`: la misma página como `action.default_popup`
  (detalle y motivos en `design.md`).

## Verify

- `node --test` sobre `model.js` (agrupar por ventana, matchear pins, ignorar hash).
- Manual en Helium con dos ventanas: la lista refleja altas/bajas/movidas; clic salta a la
  pestaña en el otro monitor; arrastrar mueve la pestaña entre ventanas; un pin abre o enfoca
  sin duplicar.
