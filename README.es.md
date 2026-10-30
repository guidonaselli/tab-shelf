# Tab Shelf

Extensión MV3 para Chromium/Helium: lista las pestañas de todas las ventanas en un panel lateral,
salta a cualquiera con un clic, mueve pestañas entre ventanas (arrastrar o botón) y guarda pins
compartidos que enfocan la pestaña abierta o abren una nueva.

## Uso

1. `chrome://extensions` → activar modo desarrollador → "Cargar descomprimida" → esta carpeta.
2. Clic en el ícono de la extensión para abrir el panel.

**Panel de borde.** Además del side panel, al pasar el mouse por el borde izquierdo o derecho de cualquier página http(s) aparece el mismo panel encima de la página (se oculta al sacar el mouse, con `Esc` o al hacer clic afuera). Por defecto va a la izquierda; con las pestañas verticales de Helium a ese lado el borde de pantalla es esa barra y no la página, así que ahí conviene elegir derecha. Lado y activación se eligen en "Ajustes", al pie del panel. Al instalar o recargar la extensión, el panel se inyecta en las pestañas ya abiertas; antes había que recargarlas. Límites: no aparece en `chrome://`, la nueva pestaña ni la tienda (ahí queda el side panel); la zona de disparo son los 32 px del borde (se detecta por posición del mouse, así que ningún elemento de la página la tapa); con el mouse apretado (arrastrando o usando el scroll) no se dispara; el script de contenido pide acceso a todas las páginas http(s) aunque solo dibuja el panel.

**Clic en una pestaña** de otra ventana la trae a la ventana actual (la del panel) y la activa.

El ID de la extensión es fijo (`key` del manifest), así que los pins sobreviven a mover la carpeta.

## Teclado

- `Alt+↑` / `Alt+↓` sobre una pestaña la reordena dentro de su ventana.
- Con varias ventanas, el selector `↗` de cada fila mueve la pestaña a la ventana elegida.

## Tests

`npm test` (usa `node --test`, sin dependencias).

## Agregar un idioma

Copiar `_locales/en/messages.json` a `_locales/<código>/messages.json` y traducir los valores.
