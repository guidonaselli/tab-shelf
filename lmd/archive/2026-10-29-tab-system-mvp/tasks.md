# Tareas

## 1. Spike: lo que Helium sí permite
- [x] 1.1 `manifest.json` MV3, `background.js` y `panel.html` con diagnóstico (UA, `sidePanel`, ventanas)
- [x] 1.2 Side panel real abierto con `sidePanel.open` (con gesto de usuario simulado por CDP): `getCurrent` y `getLastFocused` coinciden y la lista se dibuja; resultados en `design.md`

## 2. Modelo
- [x] 2.1 `src/model.js`: `normalizeUrl`, `matchPin`, `buildView`, `filterView`, `addPin`, `removePin`, `dropIndex`
- [x] 2.2 `test/model.test.js` con valores literales; `node --test` da 22 de 22

## 3. Lista y salto entre ventanas
- [x] 3.1 Panel con `render()` por lotes (~100 ms) y listeners de `tabs`, `windows` y `storage.onChanged`
- [x] 3.2 Verificado por CDP: el panel se redibuja al mover pestañas, cerrar una ventana y minimizarla
- [x] 3.3 Clic o Enter en una fila: `tabs.update` + `windows.update({ focused: true })`
- [x] 3.4 Saltar entre ventanas en posiciones de dos monitores (`left` 0 y 2000, simuladas); el panel las lista por `left` y un clic restaura y enfoca una ventana minimizada
- [x] 3.5 Búsqueda por título o URL, enfocada al abrir

## 4. Mover pestañas
- [x] 4.1 Arrastrar con tipo de dato propio, render pausado durante el arrastre, y botón "mover a otra ventana"
- [x] 4.2 Arrastre con el pipeline de input de CDP (mouse real + `dispatchDragEvent`) deja la pestaña en la otra ventana; el estado de la página se conserva y un `<video>` sigue avanzando tras mover la pestaña

## 5. Pins compartidos
- [x] 5.1 Botón de pin y despin en cada fila; escritura en `storage.local`; solo http(s)
- [x] 5.2 `openOrFocus(pin)`: enfoca la pestaña que coincide o abre una en la ventana actual; los errores se muestran
- [x] 5.3 Un pin queda visible en el side panel real; pin sobre la URL final de un redirect local, cerrar la pestaña y abrir dos veces desde el pin deja una sola pestaña (el caso Gmail con ruta raíz está en los tests unitarios)
- [x] 5.4 `key` en el manifest: el ID (`ndaibachpaafiamdbbnfpmnfbfcpehag`) se mantuvo al cargar una copia desde otra carpeta

## 6. Idiomas
- [x] 6.1 `_locales` en `en` y `es`, manifest y panel sin textos fijos
