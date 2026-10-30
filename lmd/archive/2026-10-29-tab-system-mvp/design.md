# Diseño

Etiquetas: **K** conocido, **I** inferido, **U** sin confirmar (se resuelve a mano en Helium).

## Arquitectura

- Archivos: `manifest.json`, `background.js`, `panel.html`, `panel.css`, `panel.js`,
  `src/model.js`, `test/model.test.js`, `package.json` con solo `{"type":"module"}`.
- `background.js` solo llama `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`
  en `onInstalled` y `onStartup`. Que el ajuste persista entre reinicios es **U**.
- Sin mensajería. El panel es dueño de los listeners (no depende del ciclo de vida del service
  worker, **K**). `render()` lee `windows.getAll({ populate: true, windowTypes: ['normal'] })`,
  `storage.local.get('pins')` y `windows.getCurrent()`, pasa todo a `buildView` y dibuja el DOM.
  Los eventos de `tabs`, `windows` y `storage.onChanged` llaman a `scheduleRender()` (lote de
  ~100 ms; pausado entre `dragstart` y `dragend`).
- Cada ventana tiene su propia instancia del panel (**I**); los pins se sincronizan por
  `storage.onChanged` y se releen justo antes de cada escritura.

## Datos

- Pin: `{ id, url, title, favIconUrl }`, solo http(s).
- Vista: `{ windows: [{ id, isCurrent, focused, tabs: [{ id, title, url, favIconUrl, active,
  discarded, pinId }] }], pins: [{ ...pin, openTabId }] }`.
- Título: `title` → `url` → `pendingUrl` → "Nueva pestaña". URL: `url || pendingUrl`.
- Ventanas ordenadas por `left` para que la lista siga el orden de los monitores; la actual
  marcada.

## Reglas

- Solo ventanas `normal`; incognito fuera (mover entre incognito y normal probablemente falla, **I**).
- `tabs.move` a la última posición de una ventana; mover la última pestaña de una ventana cierra
  esa ventana y su panel (**K**).
- Pin: cubre su sitio (host:puerto, http y https cuentan como uno) y todo lo que cuelga de su ruta,
  ignorando hash y query. Si hay varias pestañas que coinciden, gana la de la ventana actual.
- Una pestaña "es" un pin solo con la misma dirección exacta (sitio, ruta y query): así un pin
  ancestro no hace que el botón de una pestaña hija borre el pin de la raíz, y dos videos con
  distinta query son pins distintos.
- Pin desde cualquier fila de pestaña, no desde "la activa"; no se agregan duplicados. Las
  escrituras de pins se serializan con `navigator.locks` (compartido entre paneles).
- Favicon con `<img>` y letra inicial si falla. Filas como `<button>`, búsqueda enfocada al abrir,
  Enter salta, botón "mover a otra ventana" como alternativa a arrastrar.
- Estados vacíos: sin pins, sin resultados, una sola ventana.

## Fallback

Si Helium no soporta `chrome.sidePanel`: la misma `panel.html` como `action.default_popup`
(abre en la ventana donde se hace clic) y atajo con `commands._execute_action`. No usar una
pestaña fija de la extensión: vive en una sola ventana y anula el objetivo de dos monitores.

## Fuera de alcance de v1

Importar pins desde marcadores (requiere permiso `bookmarks`), reordenar o renombrar pins,
arrastrar varias pestañas, arrastrar entre dos paneles, permiso `favicon`, modos de match por pin.

## Decisiones (cerradas por el usuario)

1. Match de pins: mismo sitio + prefijo de ruta, ignorando hash y query. Si la verificación
   manual 5.3 muestra pestañas perdidas en SPAs o redirects, evaluar atar el pin a la pestaña que
   abrió (más parecido a Zen, más estado).
2. Respaldo de pins: `key` fija en el manifest para que el ID no cambie al mover la carpeta
   (sin esto, mover o reinstalar vacía `storage.local`, **K**). Solo hace falta la clave pública
   en el manifest; no se guarda ninguna clave privada en el repo.
3. Arrastrar: posición exacta + botón "mover a otra ventana".
4. Tras mover: el foco no sigue a la pestaña.

## i18n

- `_locales/<idioma>/messages.json` + `chrome.i18n.getMessage`; `default_locale` es `en`, también hay `es`.
- El manifest usa `__MSG_extName__` y `__MSG_extDescription__`; el HTML usa `data-i18n*` y
  `panel.js` los resuelve al cargar. Los textos de `model.js` entran por parámetro (`emptyTitle`):
  el modelo no conoce el idioma.
- Un idioma nuevo es una carpeta nueva con las mismas claves; no hay que tocar código.

## Ventana actual

El panel usa `windows.getLastFocused({ windowTypes: ['normal'] })` y no `getCurrent`: un panel
lateral vive dentro de la ventana donde se abrió y un popup no es una ventana normal.

## Resultados del spike (Helium, Chrome/156, perfil temporal con `--load-extension`)

Verificado automáticamente por CDP contra el `chrome.exe` de Helium:

- La extensión carga y `chrome.sidePanel` existe.
- `getCurrent` y `getLastFocused` coinciden cuando el panel corre como pestaña.
- `tabs.move` entre ventanas funciona; si era la última pestaña, la ventana de origen se cierra
  y el panel se redibuja solo (4 → 3 secciones).
- Soltar sobre la mitad inferior de una fila deja la pestaña después de esa fila (`dropIndex`).
- `windows.update({ focused: true })` alcanza para restaurar una ventana minimizada (no hace falta
  forzar `state: 'normal'`, que desinmaximiza); el panel muestra la etiqueta "minimizada" gracias a
  `windows.onBoundsChanged`.
- Un pin hecho desde una fila queda en `storage.local` y aparece en la lista de pins.
- Los textos salen en inglés o español según `--lang`.

- El side panel real abre con `sidePanel.open` (gesto simulado por CDP) y su instancia muestra las
  mismas ventanas; `getCurrent` y `getLastFocused` coinciden ahí también.
- Cargar una copia de la extensión desde otra carpeta conserva el ID (`key` del manifest).
- `setPanelBehavior` se llama en cada arranque del service worker, así que no depende de que el
  ajuste persista.

- Un arrastre con input real de CDP (`mousePressed`/`mouseMoved` + `dispatchDragEvent`) desde el
  botón, el título o el botón de mover inicia el drag y mueve la pestaña entre ventanas.
- Tras mover una pestaña conserva su estado de página y un `<video>` sigue reproduciendo.
- Pins: un pin sobre la URL final de un redirect no duplica pestañas al abrirlo dos veces, y se ve
  en el side panel real.

Límite de lo verificado: los dos monitores se simularon con ventanas en `left` 0 y 2000 y el caso
Gmail con un redirect local; el comportamiento con tus monitores y con Gmail real no se probó.

## Revisión (diff-review)

Corregido: botón "mover" con filtro activo (iba siempre a la primera ventana), pins que difieren
solo en la query, pin ancestro vs. pestaña hija, re-render que sacaba el foco del teclado, carga
lenta que pisaba una más nueva, carrera de escritura de pins, pin cuya pestaña se cierra dentro del
lote, redirect http→https, fallback popup sin `onStartup`/`onInstalled`, diagnóstico con textos
fijos (se eliminó: era del spike), "Quitar" ambiguo en español (ahora "Desfijar"), etiquetas
accesibles con el título de la pestaña y `aria-current` en la activa.

Después de la revisión: con 3 o más ventanas el control de mover es un selector que elige la
ventana exacta (con una sola de destino sigue siendo un botón); `Alt+↑` / `Alt+↓` sobre una pestaña
la reordena dentro de su ventana y el foco se conserva.

Verificado en los dos monitores físicos de esta máquina (DISPLAY1 en x=-1920..0 y el principal en
x=0..2560) con ventanas colocadas en `left` -1900, 200 y 1300: el panel las ordena por `left`
(la del monitor izquierdo primero, con coordenada negativa), un clic salta a la ventana del monitor
izquierdo y el SO le da foco, el selector mueve a la ventana elegida y `Alt+↑` reordena.

Límites conocidos: el arrastre con input real se verificó con el pipeline de CDP (6 de 6 corridas
seguidas y en las verificaciones posteriores); 2 corridas anteriores no iniciaron el arrastre y
coincidieron con otra actividad en el escritorio, pero la causa no se confirmó. El caso Gmail con
sesión real no se probó (requiere una cuenta): el pin se crea desde la URL final de la pestaña y se
compara por sitio exacto (`mail.google.com` y `accounts.google.com` son sitios distintos).
