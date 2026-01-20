const { contextBridge, ipcRenderer } = require('electron');

// Exponer APIs seguras al renderer
contextBridge.exposeInMainWorld('electronAPI', {
    // Información de la app
    isElectron: true,

    // Recibir actualizaciones de estado
    onStatusUpdate: (callback) => {
        ipcRenderer.on('status-update', (event, data) => callback(data));
    },

    // Abrir enlaces externos
    openExternal: (url) => {
        ipcRenderer.send('open-external', url);
    },

    // ═══════════════════════════════════════════════════════════
    // NUEVAS APIs PARA SISTEMA DE DESCARGAS
    // ═══════════════════════════════════════════════════════════

    // Seleccionar carpeta de destino
    selectFolder: () => {
        return ipcRenderer.invoke('select-folder');
    },

    // Obtener carpeta de descargas por defecto
    getDefaultDownloadPath: () => {
        return ipcRenderer.invoke('get-default-download-path');
    },

    // Abrir archivo o carpeta en el explorador
    openPath: (filePath) => {
        return ipcRenderer.invoke('open-path', filePath);
    },

    // Mostrar archivo en la carpeta
    showItemInFolder: (filePath) => {
        return ipcRenderer.invoke('show-item-in-folder', filePath);
    },

    // Recibir progreso de descarga
    onDownloadProgress: (callback) => {
        ipcRenderer.on('download-progress', (event, data) => callback(data));
    },

    // Recibir descarga completada
    onDownloadComplete: (callback) => {
        ipcRenderer.on('download-complete', (event, data) => callback(data));
    },

    // Recibir error de descarga
    onDownloadError: (callback) => {
        ipcRenderer.on('download-error', (event, data) => callback(data));
    },

    // ═══════════════════════════════════════════════════════════
    // CLIPBOARD MONITORING & SETTINGS
    // ═══════════════════════════════════════════════════════════

    // Recibir URL detectada del portapapeles
    onClipboardUrl: (callback) => {
        ipcRenderer.on('clipboard-url', (event, url) => callback(url));
    },

    // Obtener configuración
    getSettings: () => {
        return ipcRenderer.invoke('get-settings');
    },

    // Guardar configuración
    saveSettings: (settings) => {
        return ipcRenderer.invoke('save-settings', settings);
    }
});
