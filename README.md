# Zen Tab System

Extensión MV3 para Chromium/Helium: lista las pestañas de todas las ventanas en un panel lateral,
salta a cualquiera con un clic, mueve pestañas entre ventanas (arrastrar o botón) y guarda pins
compartidos que enfocan la pestaña abierta o abren una nueva.

## Uso

1. `chrome://extensions` → activar modo desarrollador → "Cargar descomprimida" → esta carpeta.
2. Clic en el ícono de la extensión para abrir el panel.

El ID de la extensión es fijo (`key` del manifest), así que los pins sobreviven a mover la carpeta.

## Teclado

- `Alt+↑` / `Alt+↓` sobre una pestaña la reordena dentro de su ventana.
- Con varias ventanas, el selector `↗` de cada fila mueve la pestaña a la ventana elegida.

## Tests

`npm test` (usa `node --test`, sin dependencias).

## Agregar un idioma

Copiar `_locales/en/messages.json` a `_locales/<código>/messages.json` y traducir los valores.
