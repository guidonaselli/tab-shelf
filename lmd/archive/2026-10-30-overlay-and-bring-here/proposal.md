# overlay-and-bring-here

## Why

El side panel de Chromium no permite elegir lado ni ocultarse con hover, y el clic en una pestaña de otra ventana saltaba a esa ventana.

## Non-goals

Panel de borde en `chrome://`, nueva pestaña o la tienda (el content script no corre ahí); redimensionar el panel.

## Verify

CDP en Helium con perfil temporal: hover al borde izquierdo abre el panel (`panel.html?window=<id de la ventana>`); clic en la pestaña de otra ventana la mueve a la ventana actual y cierra el panel; con lado derecho, el hover al borde derecho abre; con modo desactivado no abre. `node --test` 22/22.
