# tab-actions

## Why

Un gestor de pestañas sin cerrar ni silenciar obliga a ir a cada ventana; además "traer aquí" perdió el "ir a la ventana" del MVP.

## Non-goals

Agrupar u ordenar por dominio, carpetas de pins, previews.

## Verify

CDP en Helium con perfil temporal (`h.mjs`): botón cerrar y `Delete` con foco al vecino, Shift+clic, botón de silencio sobre una pestaña con audio real. `node --test` cubre `buildView` y `clickAction`.
