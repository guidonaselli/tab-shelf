# Lista compartida entre ventanas

## Why

Las pestañas cambian de grupo al consultarlas desde otra ventana. Una lista compartida y estable debe permitir trabajar desde ambas ventanas sin organizar por su ubicación física.

## Objetivo y terminado

El panel muestra el mismo orden de pestañas en todas las ventanas; permite activar, buscar, reordenar, cerrar y usar pins sin perder ventanas ni estado de página. Los cambios concurrentes y el reinicio del worker no deben corromper la lista. El diseño concreto se deriva del análisis profundo y de las limitaciones de Chromium.

## Diseño

- Chromium conserva cada pestaña real en una sola ventana. El panel presenta una lista plana global y el background serializa las intenciones de activación y orden.
- Orden en storage.session con IDs de pestaña: conservar posición al mover o navegar; incorporar nuevas, eliminar cerradas y sustituir reemplazadas. Nunca eliminar por una lectura transitoria durante detach. Al reiniciar el navegador se reconstruye sin adivinar identidades por URL.
- Clic trae la pestaña a la ventana actual; Shift+clic enfoca su ventana. Antes de trasladar la última se crea una pestaña auxiliar identificada para conservar la ventana. No se elimina automáticamente contenido del usuario.
- Resolver contexto vivo del overlay y de su ventana contenedora; separar consultas y foco por ventana. Usar un solo coordinador para pestañas y pins, con datos actuales y errores visibles.
- Arrastre y Alt+flechas reordenan la lista global, no mueven pestañas entre ventanas. Mantener el control explícito de traslado, búsqueda, cierre, pins, foco, scroll e idiomas.
- Inicialización y rollback no alteran pins, ajustes ni sesiones. No reconstruir formularios ni duplicar pestañas para simular vistas simultáneas.

## Paralelismo

- Bloqueante: diseño y contrato antes de integración.
- Frentes: pruebas de modelo; luego implementación coordinada y documentación.
- Estado compartido: un escritor por árbol; cola única para orden y pins.
- Una implementación principal evita escrituras concurrentes sobre panel y background.

## Non-goals

Modificar Chromium o prometer dos vistas activas simultáneas de una instancia. No duplicar pestañas para simular estado compartido.

## Verify

Tests de comportamiento y comprobación en navegador real con dos ventanas, incluyendo orden, activación, última pestaña, teclado, arrastre, pins y estado vivo; captura del panel.
