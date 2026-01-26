# Changelog

## [1.0.8] - 2026-01-26

### ✨ Nuevas Funcionalidades
- **Botón de Detener Descargas**: Agregado botón "⏹ Detener" que aparece durante descargas batch
  - Permite cancelar la cola de descargas en progreso
  - Cierra la conexión SSE actual
  - Marca el video actual como 'cancelled'
  - Videos pendientes permanecen como 'pending' para reiniciar después
  - Estilo rojo de peligro para indicar acción destructiva

### 🐛 Correcciones de Bugs
- **Fix: Descarga Individual**: Corregido bug donde el botón de descarga individual (⬇️) descargaba toda la cola en lugar de solo el video seleccionado
  - Reescrita función `downloadSingleItem()` para usar su propia lógica SSE
  - Ya no llama a `processQueue()` que procesaba todos los items pendientes

### 🔧 Mejoras Técnicas
- Agregado estado `isQueuePaused` para controlar detención de cola
- Agregado `currentEventSource` para mantener referencia al EventSource activo
- Modificado `processQueue()` para verificar `isQueuePaused` en cada iteración
- Mejorado manejo de errores en EventSource (distingue entre error y cancelación)
- Agregados estilos CSS para `.batch-progress` con animación pulse
- Agregados estilos CSS para `.stop-queue-btn` y estado `.queue-item.cancelled`

### 📝 Notas
- La función de "pausar" no está disponible ya que yt-dlp no soporta pausar/reanudar descargas parciales
- Solo se implementó "detener/cancelar" que es lo que yt-dlp permite

---

## [1.0.7] - 2024-XX-XX
- Settings, light theme, notification sound
- Vimeo fix
- Completed state improvements

## Versiones anteriores
Ver historial de commits en GitHub
