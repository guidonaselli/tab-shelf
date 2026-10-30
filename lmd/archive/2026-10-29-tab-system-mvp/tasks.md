# Tareas

## 1. Spike: lo que Helium sí permite
- [x] 1.1 `manifest.json` MV3, `background.js` y `panel.html` con diagnóstico (UA, `sidePanel`, ventanas)
- [x] 1.2 Side panel real abierto con `sidePanel.open` (con gesto de usuario simulado por CDP): `getCurrent` y `getLastFocused` coinciden y la lista se dibuja; resultados en `design.md`

## 2. Modelo
- [x] 2.1 `src/model.js`: `normalizeUrl`, `matchPin`, `buildView`, `filterView`, `addPin`, `removePin`, `dropIndex`
- [x] 2.2 `test/model.test.js` con valores literales; `node --test` da 12 de 12

## 3. Lista y salto entre ventanas
- [x] 3.1 Panel con `render()` por lotes (~100 ms) y listeners de `tabs`, `windows` y `storage.onChanged`
- [x] 3.2 Verificado por CDP: el panel se redibuja al mover pestañas, cerrar una ventana y minimizarla
- [x] 3.3 Clic o Enter en una fila: `tabs.update` + `windows.update({ focused: true })`
- [ ] 3.4 [manual] Saltar entre dos monitores físicos
- [x] 3.5 Búsqueda por título o URL, enfocada al abrir

## 4. Mover pestañas
- [x] 4.1 Arrastrar con tipo de dato propio, render pausado durante el arrastre, y botón "mover a otra ventana"
- [ ] 4.2 [manual] Arrastre con mouse real y un video que sigue reproduciendo al mover su pestaña

## 5. Pins compartidos
- [x] 5.1 Botón de pin y despin en cada fila; escritura en `storage.local`; solo http(s)
- [x] 5.2 `openOrFocus(pin)`: enfoca la pestaña que coincide o abre una en la ventana actual; los errores se muestran
- [ ] 5.3 [manual] Un pin hecho en el panel de la ventana A aparece en el de la ventana B; clic doble no duplica pestañas con un redirect real (Gmail)
- [x] 5.4 `key` en el manifest: el ID (`ndaibachpaafiamdbbnfpmnfbfcpehag`) se mantuvo al cargar una copia desde otra carpeta

## 6. Idiomas
- [x] 6.1 `_locales` en `en` y `es`, manifest y panel sin textos fijos
