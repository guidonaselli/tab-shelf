# keyboard

## Why

Abrir el panel sin mouse y recorrerlo con teclado.

## Non-goals

Atajos para acciones sobre pestañas (cerrar, mover) más allá de `Delete` y `Alt+flechas`.

## Verify

CDP en Helium con perfil temporal (`h.mjs`): el mensaje del atajo abre el panel con el buscador enfocado y no se cierra solo, lo cierra al repetirlo, responde `false` en un sitio desactivado; `Enter` abre el primer resultado y `↓` entra a la lista.
