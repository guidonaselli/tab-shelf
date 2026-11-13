# QA de lista compartida

## Why

El panel mostró un error tras actualizar y la verificación anterior no cubrió todas las carreras ni el navegador del usuario.

## Diseño

Reproducir el error y comparar versión anterior y actual en Chromium aislado. Identificar auxiliares nuevas por una URL reservada independiente de la extensión y reconocer las anteriores por ID durante la sesión; preservar la ventana antes de mover una pestaña y reutilizar la auxiliar sin ocultar contenido navegado. Eliminar el iframe anterior al reabrir el panel para evitar que dos vistas ocupen la misma transición. Documentar el costo: la auxiliar también se crea cuando la ventana tiene otras pestañas.

## Non-goals

Manipular perfiles o pestañas reales del usuario. Suponer que pruebas aisladas comprueban Helium o equivalencia total con Zen.

## Verify

Matriz de UI real y fuente chrome.tabs/windows/session, carreras repetidas, regresiones automatizadas, revisión del diff y captura inspeccionada. Dejar verificador reproducible y registrar casos no observados.
