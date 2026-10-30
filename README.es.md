# Tab Shelf

Extensión MV3 para Chromium/Helium: lista las pestañas de todas las ventanas en un panel lateral,
salta a cualquiera con un clic, mueve pestañas entre ventanas (arrastrar o botón) y guarda pins
compartidos que enfocan la pestaña abierta o abren una nueva.

## Uso

1. `chrome://extensions` → activar modo desarrollador → "Cargar descomprimida" → esta carpeta.
2. Clic en el ícono de la extensión para abrir el panel.

**Panel de borde.** Además del side panel, al pasar el mouse por el borde izquierdo o derecho de cualquier página http(s) aparece el mismo panel encima de la página (se oculta al sacar el mouse, con `Esc` o al hacer clic afuera). Por defecto va a la izquierda; con las pestañas verticales de Helium a ese lado el borde de pantalla es esa barra y no la página, así que ahí conviene elegir derecha. Lado, ancho, opacidad, color de acento, tamaño de la zona, velocidad y activación se eligen en Ajustes (el botón de controles junto al buscador); también se puede desactivar por sitio, por ejemplo en juegos o apps web que usan el borde. Al instalar o recargar la extensión, el panel se inyecta en las pestañas ya abiertas; antes había que recargarlas. Límites: no aparece en `chrome://`, la nueva pestaña ni la tienda (ahí queda el side panel); la zona de disparo se detecta por posición del mouse, así que ningún elemento común de la página la tapa (un iframe de otro origen que llegue al borde sí, porque la página no ve el mouse sobre él); con el mouse apretado, en pantalla completa o con el puntero capturado no se dispara; en ventanas de incógnito no funciona; para reactivar un sitio desactivado, abrí el side panel sobre ese sitio y usá los ajustes; pide Chrome 123 o más nuevo; el script de contenido pide acceso a todas las páginas http(s) aunque solo dibuja el panel.

**Clic en una pestaña** de otra ventana la trae a la ventana actual (la del panel) y la activa. `Shift`+clic salta a la ventana de esa pestaña. Si era la única de su ventana, el clic siempre salta, para no cerrarla.

**Cerrar y silenciar.** Se cierra con el botón `x`, clic medio o `Supr`. Las pestañas con sonido muestran un botón de parlante para silenciarlas.

El ID de la extensión es fijo (`key` del manifest), así que los pins sobreviven a mover la carpeta.

## Teclado

- `Alt+Shift+S` muestra u oculta el panel de borde y deja el foco en la búsqueda (donde no puede correr, abre el side panel). Se cambia en `chrome://extensions/shortcuts`.
- En la búsqueda, `Enter` abre el primer resultado y `↓` baja a la lista; `↑` y `↓` recorren las filas.
- `Alt+↑` / `Alt+↓` sobre una pestaña la reordena dentro de su ventana.
- Con varias ventanas, el selector `↗` de cada fila mueve la pestaña a la ventana elegida.

## Tests

`npm test` (usa `node --test`, sin dependencias).

## Agregar un idioma

Copiar `_locales/en/messages.json` a `_locales/<código>/messages.json` y traducir los valores.
