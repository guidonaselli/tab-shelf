# edge-panel-hardening

## Why

El análisis en frío del panel de borde encontró fallos de borde (pantalla completa, foco, cierre de la ventana de origen, ajustes duplicados) y faltaba poder apartarlo de sitios donde estorba.

## Non-goals

Previews, sincronización entre dispositivos, soporte de incógnito.

## Verify

CDP en Helium con perfil temporal (`h.mjs`): fullscreen no monta el panel, host desactivado desmonta, zona de 4 px, el hover no roba el foco, clic en la única pestaña de otra ventana salta sin cerrarla. `node --test`.
