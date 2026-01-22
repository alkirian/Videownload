const { app, BrowserWindow, dialog, ipcMain, Tray, Menu, Notification, nativeImage, clipboard } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { spawn } = require('child_process');

// Determinar si estamos en modo empaquetado
const isPackaged = app.isPackaged;
const appPath = isPackaged ? process.resourcesPath : __dirname;

// Directorio de datos de la aplicación
const userDataPath = app.getPath('userData');
const binPath = path.join(userDataPath, 'bin');

// Rutas de las herramientas
const ytDlpPath = path.join(binPath, 'yt-dlp.exe');
const ffmpegPath = path.join(binPath, 'ffmpeg.exe');
const ffprobePath = path.join(binPath, 'ffprobe.exe');

// URLs de descarga
const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
const FFMPEG_URL = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip';

let mainWindow;
let splashWindow;
let serverProcess;
let tray = null;
let clipboardInterval = null;
let lastClipboardText = '';

// Archivo de configuración
const settingsPath = path.join(userDataPath, 'settings.json');

// Configuración por defecto
const defaultSettings = {
    autoStart: false,
    startMinimized: false,
    clipboardMonitoring: true,
    notifications: true,
    closeAction: 'ask',  // 'ask', 'tray', 'quit'
    askOnClose: true     // Si preguntar al cerrar
};

// Cargar configuración
function loadSettings() {
    try {
        if (fs.existsSync(settingsPath)) {
            return { ...defaultSettings, ...JSON.parse(fs.readFileSync(settingsPath, 'utf8')) };
        }
    } catch (e) {
        console.error('Error cargando settings:', e);
    }
    return defaultSettings;
}

// Guardar configuración
function saveSettings(settings) {
    try {
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    } catch (e) {
        console.error('Error guardando settings:', e);
    }
}

let settings = loadSettings();

// ═══════════════════════════════════════════════════════════
// SISTEMA DE BORRADORES (Drafts)
// ═══════════════════════════════════════════════════════════

const draftsPath = path.join(userDataPath, 'drafts.json');

// Cargar borradores
function loadDrafts() {
    try {
        if (fs.existsSync(draftsPath)) {
            return JSON.parse(fs.readFileSync(draftsPath, 'utf8'));
        }
    } catch (e) {
        console.error('Error cargando drafts:', e);
    }
    return [];
}

// Guardar borradores
function saveDrafts(drafts) {
    try {
        fs.writeFileSync(draftsPath, JSON.stringify(drafts, null, 2));
    } catch (e) {
        console.error('Error guardando drafts:', e);
    }
}

// Agregar video a borradores
function addToDrafts(videoData) {
    const drafts = loadDrafts();

    // Verificar si ya existe (por URL)
    const exists = drafts.some(d => d.url === videoData.url);
    if (exists) {
        console.log('Video ya existe en borradores');
        return drafts;
    }

    // Agregar con timestamp
    drafts.unshift({
        ...videoData,
        id: Date.now().toString(),
        addedAt: new Date().toISOString()
    });

    // Limitar a 50 borradores máximo
    if (drafts.length > 50) {
        drafts.pop();
    }

    saveDrafts(drafts);
    console.log('Video agregado a borradores:', videoData.title);
    return drafts;
}

// Eliminar de borradores
function removeFromDrafts(id) {
    let drafts = loadDrafts();
    drafts = drafts.filter(d => d.id !== id);
    saveDrafts(drafts);
    return drafts;
}

// Limpiar todos los borradores
function clearDrafts() {
    saveDrafts([]);
    return [];
}

// ═══════════════════════════════════════════════════════════
// PLATAFORMAS SOPORTADAS (para detectar links)
// ═══════════════════════════════════════════════════════════

const SUPPORTED_PLATFORMS = [
    { name: 'YouTube', patterns: ['youtube.com/watch', 'youtu.be/', 'youtube.com/shorts'] },
    { name: 'TikTok', patterns: ['tiktok.com/'] },
    { name: 'Instagram', patterns: ['instagram.com/p/', 'instagram.com/reel/', 'instagram.com/reels/', 'instagram.com/stories/', 'instagram.com/tv/', 'instagr.am/'] },
    { name: 'Twitter', patterns: ['twitter.com/', 'x.com/'] },
    { name: 'Facebook', patterns: ['facebook.com/watch', 'fb.watch', 'facebook.com/reel'] },
    { name: 'Vimeo', patterns: ['vimeo.com/'] },
    { name: 'Twitch', patterns: ['twitch.tv/'] },
    { name: 'Reddit', patterns: ['reddit.com/', 'redd.it/'] },
    { name: 'Pinterest', patterns: ['pinterest.com/pin/', 'pin.it/'] },
    { name: 'Dailymotion', patterns: ['dailymotion.com/', 'dai.ly/'] },
    { name: 'SoundCloud', patterns: ['soundcloud.com/'] }
];

function isVideoUrl(text) {
    if (!text || typeof text !== 'string') return null;
    const trimmed = text.trim();

    // Verificar que parece una URL
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) return null;

    for (const platform of SUPPORTED_PLATFORMS) {
        for (const pattern of platform.patterns) {
            if (trimmed.includes(pattern)) {
                return { url: trimmed, platform: platform.name };
            }
        }
    }
    return null;
}

// ═══════════════════════════════════════════════════════════
// VENTANA DE SPLASH (Pantalla de carga)
// ═══════════════════════════════════════════════════════════

function createSplashWindow() {
    splashWindow = new BrowserWindow({
        width: 400,
        height: 300,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    splashWindow.loadFile(path.join(__dirname, 'splash.html'));
    splashWindow.center();
}

function updateSplashStatus(message, progress = null) {
    if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.webContents.send('status-update', { message, progress });
    }
}

// ═══════════════════════════════════════════════════════════
// DESCARGA DE DEPENDENCIAS
// ═══════════════════════════════════════════════════════════

function downloadFile(url, destPath, onProgress) {
    return new Promise((resolve, reject) => {
        // Crear directorio si no existe
        const dir = path.dirname(destPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        const file = fs.createWriteStream(destPath);

        const request = (urlToFollow) => {
            https.get(urlToFollow, (response) => {
                // Manejar redirects
                if (response.statusCode === 302 || response.statusCode === 301) {
                    request(response.headers.location);
                    return;
                }

                if (response.statusCode !== 200) {
                    reject(new Error(`HTTP Error: ${response.statusCode}`));
                    return;
                }

                const totalSize = parseInt(response.headers['content-length'], 10);
                let downloadedSize = 0;

                response.on('data', (chunk) => {
                    downloadedSize += chunk.length;
                    if (totalSize && onProgress) {
                        const percent = Math.round((downloadedSize / totalSize) * 100);
                        onProgress(percent);
                    }
                });

                response.pipe(file);

                file.on('finish', () => {
                    file.close();
                    resolve();
                });

                file.on('error', (err) => {
                    fs.unlink(destPath, () => { });
                    reject(err);
                });
            }).on('error', (err) => {
                reject(err);
            });
        };

        request(url);
    });
}

async function extractZip(zipPath, destDir) {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(destDir, true);

    // Buscar ffmpeg.exe en la estructura extraída
    const findFile = (dir, filename) => {
        const files = fs.readdirSync(dir);
        for (const file of files) {
            const fullPath = path.join(dir, file);
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
                const found = findFile(fullPath, filename);
                if (found) return found;
            } else if (file.toLowerCase() === filename.toLowerCase()) {
                return fullPath;
            }
        }
        return null;
    };

    // Mover ffmpeg y ffprobe al directorio bin
    const extractedDir = path.join(destDir, 'ffmpeg-extract');
    const ffmpegExe = findFile(extractedDir, 'ffmpeg.exe');
    const ffprobeExe = findFile(extractedDir, 'ffprobe.exe');

    if (ffmpegExe) {
        fs.copyFileSync(ffmpegExe, path.join(binPath, 'ffmpeg.exe'));
    }
    if (ffprobeExe) {
        fs.copyFileSync(ffprobeExe, path.join(binPath, 'ffprobe.exe'));
    }

    // Limpiar archivos temporales
    fs.rmSync(extractedDir, { recursive: true, force: true });
    fs.unlinkSync(zipPath);
}

async function ensureDependencies() {
    // Crear directorio bin si no existe
    if (!fs.existsSync(binPath)) {
        fs.mkdirSync(binPath, { recursive: true });
    }

    // Verificar yt-dlp
    if (!fs.existsSync(ytDlpPath)) {
        updateSplashStatus('Descargando yt-dlp...', 0);
        try {
            await downloadFile(YTDLP_URL, ytDlpPath, (percent) => {
                updateSplashStatus(`Descargando yt-dlp... ${percent}%`, percent);
            });
        } catch (err) {
            console.error('Error descargando yt-dlp:', err);
            dialog.showErrorBox('Error', 'No se pudo descargar yt-dlp. Verifica tu conexión a internet.');
            app.quit();
            return false;
        }
    }

    // Verificar ffmpeg
    if (!fs.existsSync(ffmpegPath)) {
        updateSplashStatus('Descargando ffmpeg (esto puede tomar unos minutos)...', 0);
        const zipPath = path.join(binPath, 'ffmpeg.zip');
        const extractDir = path.join(binPath, 'ffmpeg-extract');

        try {
            await downloadFile(FFMPEG_URL, zipPath, (percent) => {
                updateSplashStatus(`Descargando ffmpeg... ${percent}%`, percent);
            });

            updateSplashStatus('Extrayendo ffmpeg...', null);

            // Extraer manualmente ya que AdmZip puede no estar disponible
            // Usaremos PowerShell para extraer
            await new Promise((resolve, reject) => {
                const ps = spawn('powershell', [
                    '-Command',
                    `Expand-Archive -Path "${zipPath}" -DestinationPath "${extractDir}" -Force`
                ]);
                ps.on('close', (code) => {
                    if (code === 0) resolve();
                    else reject(new Error(`PowerShell exit code: ${code}`));
                });
                ps.on('error', reject);
            });

            // Buscar y mover ffmpeg.exe
            const findFile = (dir, filename) => {
                try {
                    const files = fs.readdirSync(dir);
                    for (const file of files) {
                        const fullPath = path.join(dir, file);
                        const stat = fs.statSync(fullPath);
                        if (stat.isDirectory()) {
                            const found = findFile(fullPath, filename);
                            if (found) return found;
                        } else if (file.toLowerCase() === filename.toLowerCase()) {
                            return fullPath;
                        }
                    }
                } catch (e) { }
                return null;
            };

            const ffmpegExe = findFile(extractDir, 'ffmpeg.exe');
            const ffprobeExe = findFile(extractDir, 'ffprobe.exe');

            if (ffmpegExe) {
                fs.copyFileSync(ffmpegExe, ffmpegPath);
            }
            if (ffprobeExe) {
                fs.copyFileSync(ffprobeExe, ffprobePath);
            }

            // Limpiar
            fs.rmSync(extractDir, { recursive: true, force: true });
            fs.unlinkSync(zipPath);

        } catch (err) {
            console.error('Error con ffmpeg:', err);
            dialog.showErrorBox('Error', 'No se pudo descargar/extraer ffmpeg. Verifica tu conexión a internet.');
            app.quit();
            return false;
        }
    }

    return true;
}

// ═══════════════════════════════════════════════════════════
// SERVIDOR EXPRESS
// ═══════════════════════════════════════════════════════════

function startServer() {
    return new Promise((resolve, reject) => {
        try {
            // Configurar variables de entorno para el servidor
            process.env.ELECTRON_MODE = 'true';
            process.env.YT_DLP_PATH = ytDlpPath;
            process.env.FFMPEG_DIR = binPath;

            // Ruta base de la app (para archivos estáticos)
            // En modo empaquetado, __dirname apunta al directorio de recursos
            const appBasePath = isPackaged
                ? path.join(process.resourcesPath, 'app.asar')
                : __dirname;

            process.env.APP_PATH = appBasePath;

            // Directorio temporal (fuera del ASAR)
            const tempPath = path.join(userDataPath, 'temp');
            process.env.TEMP_PATH = tempPath;

            console.log('Iniciando servidor con:');
            console.log('  - APP_PATH:', appBasePath);
            console.log('  - TEMP_PATH:', tempPath);
            console.log('  - YT_DLP_PATH:', ytDlpPath);
            console.log('  - FFMPEG_DIR:', binPath);

            // Cargar el servidor
            const server = require('./server');

            // Esperar a que el servidor determine el puerto
            const checkPort = () => {
                const port = server.getPort();
                if (port) {
                    global.serverPort = port;
                    console.log('Servidor iniciado en puerto:', port);
                    resolve(port);
                } else {
                    setTimeout(checkPort, 100);
                }
            };

            // Dar tiempo al servidor para iniciar y luego verificar
            setTimeout(checkPort, 500);

        } catch (err) {
            console.error('Error al cargar servidor:', err);
            reject(err);
        }
    });
}

// ═══════════════════════════════════════════════════════════
// VENTANA PRINCIPAL
// ═══════════════════════════════════════════════════════════

function createMainWindow() {
    const serverPort = global.serverPort || 3000;

    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        frame: true,
        show: false,
        icon: path.join(__dirname, 'assets', 'icon.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    // Cargar la aplicación desde el servidor local con el puerto dinámico
    console.log('Cargando UI desde puerto:', serverPort);
    mainWindow.loadURL(`http://localhost:${serverPort}`);

    // Mostrar cuando esté lista
    mainWindow.once('ready-to-show', () => {
        if (splashWindow && !splashWindow.isDestroyed()) {
            splashWindow.close();
        }
        mainWindow.show();
        mainWindow.focus();
    });

    // Abrir DevTools en desarrollo
    if (!isPackaged) {
        mainWindow.webContents.openDevTools();
    }

    // Manejo del cierre con diálogo de confirmación
    mainWindow.on('close', async (event) => {
        if (app.isQuitting) return; // Permitir cierre si ya se decidió salir

        event.preventDefault();

        // Si ya tiene una preferencia guardada, usarla
        if (!settings.askOnClose) {
            if (settings.closeAction === 'tray') {
                mainWindow.hide();
            } else if (settings.closeAction === 'quit') {
                app.isQuitting = true;
                app.quit();
            }
            return;
        }

        // Mostrar diálogo de confirmación
        const { response, checkboxChecked } = await dialog.showMessageBox(mainWindow, {
            type: 'question',
            buttons: ['Minimizar a bandeja', 'Cerrar aplicación', 'Cancelar'],
            defaultId: 0,
            cancelId: 2,
            title: 'Cerrar Videownload',
            message: '¿Qué deseas hacer?',
            detail: 'Puedes minimizar a la bandeja del sistema para seguir detectando videos, o cerrar completamente la aplicación.',
            checkboxLabel: 'Recordar mi elección',
            checkboxChecked: false
        });

        if (response === 0) {
            // Minimizar a bandeja
            if (checkboxChecked) {
                settings.askOnClose = false;
                settings.closeAction = 'tray';
                saveSettings(settings);
            }
            mainWindow.hide();
        } else if (response === 1) {
            // Cerrar aplicación
            if (checkboxChecked) {
                settings.askOnClose = false;
                settings.closeAction = 'quit';
                saveSettings(settings);
            }
            app.isQuitting = true;
            app.quit();
        }
        // Si response === 2 (Cancelar), no hacer nada
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// ═══════════════════════════════════════════════════════════
// SYSTEM TRAY
// ═══════════════════════════════════════════════════════════

function createTray() {
    // Crear icono de tray simple y visible (16x16 con flecha de descarga)
    // Este es un PNG 16x16 con fondo teal y flecha blanca de descarga
    const trayIconBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAA3klEQVQ4T6WTwQ3CMAyG/wRGgBFgBBiBjkBHgBFgBBiBjgAbwAawAYxAN6hJZMWhSd9hysn2Z9v5E9FxU+R4ACvFlkNEzAE8AVwAvEPLM4APgCMAT1fMzFuPZOYFAL8xszeotwSwcS+8jK4B7IjoPVS5CWDv+mQPyPY54CMic4fIzJYueBD4mJnXoRmBW6zJnxg1i+f3RqLWLIi2zjPw3OoFVaJTB+SoJVqJKjKziRjsInIGkJqY+SoGiAxiReQ1lG/0FZK0JyKdZ4C+0QOQHxL1V3MZBGJUiSZU9DtxfAB1E8Q4AXyhdgAAAABJRU5ErkJggg==';

    let trayIcon;
    try {
        trayIcon = nativeImage.createFromDataURL(trayIconBase64);

        // Intentar cargar el icono personalizado si existe
        let iconPath = path.join(__dirname, 'assets', 'icon.png');
        if (isPackaged) {
            iconPath = path.join(process.resourcesPath, 'app.asar', 'assets', 'icon.png');
        }

        const customIcon = nativeImage.createFromPath(iconPath);
        if (!customIcon.isEmpty()) {
            // Solo usar el icono personalizado si carga correctamente y se ve bien
            const resized = customIcon.resize({ width: 16, height: 16 });
            // Verificar que el icono tiene píxeles visibles
            if (!resized.isEmpty()) {
                trayIcon = resized;
            }
        }
    } catch (err) {
        console.error('Error cargando icono del tray:', err);
        // Mantener el icono base64 de fallback
        trayIcon = nativeImage.createFromDataURL(trayIconBase64);
    }

    tray = new Tray(trayIcon);
    tray.setToolTip('Videownload - Click para abrir');

    const contextMenu = Menu.buildFromTemplate([
        {
            label: '📂 Abrir Videownload',
            click: () => {
                if (mainWindow) {
                    mainWindow.show();
                    mainWindow.focus();
                }
            }
        },
        { type: 'separator' },
        {
            label: settings.clipboardMonitoring ? '✓ Monitorear Portapapeles' : '   Monitorear Portapapeles',
            click: () => {
                settings.clipboardMonitoring = !settings.clipboardMonitoring;
                saveSettings(settings);
                if (settings.clipboardMonitoring) {
                    startClipboardMonitoring();
                } else {
                    stopClipboardMonitoring();
                }
                createTray(); // Recrear para actualizar el menú
            }
        },
        {
            label: settings.autoStart ? '✓ Iniciar con Windows' : '   Iniciar con Windows',
            click: () => {
                settings.autoStart = !settings.autoStart;
                saveSettings(settings);
                app.setLoginItemSettings({
                    openAtLogin: settings.autoStart,
                    args: ['--hidden']
                });
                createTray();
            }
        },
        { type: 'separator' },
        {
            label: '❌ Salir',
            click: () => {
                app.isQuitting = true;
                app.quit();
            }
        }
    ]);

    tray.setContextMenu(contextMenu);

    tray.on('click', () => {
        if (mainWindow) {
            if (mainWindow.isVisible()) {
                mainWindow.focus();
            } else {
                mainWindow.show();
            }
        }
    });
}

// ═══════════════════════════════════════════════════════════
// CLIPBOARD MONITORING
// ═══════════════════════════════════════════════════════════

let isAnalyzing = false;
let lastAnalyzedUrl = '';

function startClipboardMonitoring() {
    if (clipboardInterval) return;

    lastClipboardText = clipboard.readText();

    clipboardInterval = setInterval(async () => {
        if (isAnalyzing) return; // No analizar mientras hay uno en progreso

        const currentText = clipboard.readText();

        if (currentText !== lastClipboardText) {
            lastClipboardText = currentText;

            const videoInfo = isVideoUrl(currentText);
            if (videoInfo && videoInfo.url !== lastAnalyzedUrl) {
                console.log('Video URL detectada:', videoInfo);
                await analyzeAndNotify(videoInfo);
            }
        }
    }, 1000);

    console.log('Clipboard monitoring iniciado');
}

function stopClipboardMonitoring() {
    if (clipboardInterval) {
        clearInterval(clipboardInterval);
        clipboardInterval = null;
        console.log('Clipboard monitoring detenido');
    }
}

// ═══════════════════════════════════════════════════════════
// ANALYZE VIDEO & NATIVE NOTIFICATIONS
// ═══════════════════════════════════════════════════════════

// Función para generar Toast XML para Windows (notificaciones avanzadas)
function generateToastXml(title, platform) {
    // Fallback: dejar que Electron use su propio formato
    return undefined;
}

// Función para iniciar descarga directa desde la notificación (sin abrir UI)
async function startDirectDownload(videoData) {
    try {
        const http = require('http');
        const serverPort = global.serverPort || 3000;

        // Obtener la carpeta de descargas
        const downloadFolder = settings.downloadFolder || app.getPath('downloads');

        // Mostrar notificación de inicio de descarga
        const downloadingNotification = new Notification({
            title: '⬇️ Descargando...',
            body: `${videoData.title?.substring(0, 40) || 'Video'}`,
            icon: path.join(__dirname, 'assets', 'icon.png'),
            silent: true
        });
        downloadingNotification.show();

        // Preparar parámetros de descarga
        const downloadParams = new URLSearchParams({
            url: videoData.url,
            quality: videoData.quality || 1080,
            audioOnly: videoData.audioOnly ? 'true' : 'false',
            outputDir: downloadFolder
        });

        // Iniciar la descarga via API
        const downloadUrl = `http://localhost:${serverPort}/api/download?${downloadParams.toString()}`;

        // Hacer la petición de descarga
        const downloadRequest = http.get(downloadUrl, (res) => {
            let lastProgress = 0;

            res.on('data', (chunk) => {
                const text = chunk.toString();
                // Parsear eventos SSE
                const lines = text.split('\n');
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.substring(6));
                            if (data.progress && data.progress > lastProgress + 20) {
                                lastProgress = data.progress;
                                downloadingNotification.title = `⬇️ ${Math.round(data.progress)}%`;
                            }
                            if (data.status === 'completed') {
                                downloadingNotification.close();

                                // Notificación de éxito
                                const doneNotification = new Notification({
                                    title: '✅ Descarga completada',
                                    body: `${videoData.title?.substring(0, 40) || 'Video'}`,
                                    icon: path.join(__dirname, 'assets', 'icon.png'),
                                    silent: false
                                });

                                doneNotification.on('click', () => {
                                    // Abrir la carpeta de descargas
                                    require('electron').shell.openPath(downloadFolder);
                                });

                                doneNotification.show();
                                setTimeout(() => { try { doneNotification.close(); } catch (e) { } }, 5000);
                            }
                        } catch (e) { /* ignore parse errors */ }
                    }
                }
            });
        });

        downloadRequest.on('error', (err) => {
            console.error('Error en descarga directa:', err);
            downloadingNotification.close();

            const errorNotification = new Notification({
                title: '❌ Error en descarga',
                body: 'No se pudo completar la descarga',
                icon: path.join(__dirname, 'assets', 'icon.png')
            });
            errorNotification.show();
        });

    } catch (error) {
        console.error('Error iniciando descarga directa:', error);
    }
}

async function analyzeAndNotify(videoInfo) {
    if (!settings.notifications) return;

    isAnalyzing = true;
    lastAnalyzedUrl = videoInfo.url;

    // Notificación de "analizando"
    const analyzingNotification = new Notification({
        title: 'Analizando...',
        body: `Detectado enlace de ${videoInfo.platform}`,
        icon: path.join(__dirname, 'assets', 'icon.png'),
        silent: true
    });
    analyzingNotification.show();

    try {
        // Esperar a que el servidor esté listo
        const serverPort = global.serverPort || 3000;

        // Llamar a la API para obtener info del video
        const http = require('http');
        const videoData = await new Promise((resolve, reject) => {
            const req = http.get(
                `http://localhost:${serverPort}/api/info?url=${encodeURIComponent(videoInfo.url)}`,
                (res) => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => {
                        try {
                            resolve(JSON.parse(data));
                        } catch (e) {
                            reject(new Error('Error parsing response'));
                        }
                    });
                }
            );
            req.on('error', reject);
            req.setTimeout(30000, () => {
                req.destroy();
                reject(new Error('Timeout'));
            });
        });

        // Cerrar notificación de análisis
        analyzingNotification.close();

        // Crear objeto completo del video para la cola
        const fullVideoData = {
            ...videoData,
            url: videoInfo.url,
            platform: videoInfo.platform,
            id: Date.now().toString(),
            addedAt: new Date().toISOString(),
            quality: 1080, // Calidad por defecto
            audioOnly: false
        };

        // Guardar referencia para descarga directa desde notificación
        global.pendingDownload = fullVideoData;

        // Enviar video directamente a la cola del frontend
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('add-to-queue', fullVideoData);
        }

        // Notificación de éxito
        const successNotification = new Notification({
            title: 'Análisis exitoso',
            body: `${videoData.title?.substring(0, 50) || 'Video listo'}`,
            icon: path.join(__dirname, 'assets', 'icon.png'),
            silent: false,
            // Sin botones de acción, solo click simple
            toastXml: generateToastXml('Análisis exitoso', videoData.title)
        });

        // Click en la notificación = Abrir App (NO descargar)
        successNotification.on('click', () => {
            if (mainWindow) {
                if (mainWindow.isMinimized()) mainWindow.restore();
                mainWindow.show();
                mainWindow.focus();
            }
        });

        successNotification.show();

        // Cerrar automáticamente después de 5 segundos
        setTimeout(() => {
            try { successNotification.close(); } catch (e) { }
        }, 5000);

    } catch (error) {
        console.error('Error analizando video:', error);
        try { analyzingNotification.close(); } catch (e) { }

        // Notificación de error (NO se guarda en borradores)
        const errorNotification = new Notification({
            title: 'Error al analizar',
            body: 'No se pudo obtener información del video',
            icon: path.join(__dirname, 'assets', 'icon.png'),
            silent: false
        });
        errorNotification.show();
    } finally {
        isAnalyzing = false;
    }
}

// Función auxiliar para formatear duración
function formatDuration(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ═══════════════════════════════════════════════════════════
// CICLO DE VIDA DE LA APP
// ═══════════════════════════════════════════════════════════

app.whenReady().then(async () => {
    // Verificar si se inició con --hidden (inicio automático)
    const startHidden = process.argv.includes('--hidden') || settings.startMinimized;

    // Mostrar splash solo si no está oculto
    if (!startHidden) {
        createSplashWindow();
    }

    // Verificar/descargar dependencias
    updateSplashStatus('Verificando dependencias...');
    const depsOk = await ensureDependencies();
    if (!depsOk) return;

    // Iniciar servidor
    updateSplashStatus('Iniciando servidor...');
    try {
        await startServer();
    } catch (err) {
        console.error('Error iniciando servidor:', err);
        dialog.showErrorBox('Error', 'No se pudo iniciar el servidor interno.');
        app.quit();
        return;
    }

    // Crear ventana principal
    updateSplashStatus('Cargando interfaz...');
    createMainWindow();

    // Crear system tray
    createTray();

    // Iniciar monitoreo del portapapeles si está habilitado
    if (settings.clipboardMonitoring) {
        startClipboardMonitoring();
    }

    // Si se inició oculto, esconder la ventana después de cargar
    if (startHidden && mainWindow) {
        mainWindow.once('ready-to-show', () => {
            if (splashWindow && !splashWindow.isDestroyed()) {
                splashWindow.close();
            }
            // No mostrar ventana, mantener en tray
        });
    }

    // Aplicar configuración de auto-start
    app.setLoginItemSettings({
        openAtLogin: settings.autoStart,
        args: ['--hidden']
    });
});

// ═══════════════════════════════════════════════════════════
// IPC HANDLERS - SISTEMA DE DESCARGAS
// ═══════════════════════════════════════════════════════════

const { shell } = require('electron');

// Guardar carpeta de descarga seleccionada
let selectedDownloadPath = null;

// Seleccionar carpeta de destino
ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Seleccionar carpeta de descargas',
        defaultPath: selectedDownloadPath || app.getPath('downloads'),
        properties: ['openDirectory', 'createDirectory']
    });

    if (!result.canceled && result.filePaths.length > 0) {
        selectedDownloadPath = result.filePaths[0];
        return {
            success: true,
            path: selectedDownloadPath,
            name: path.basename(selectedDownloadPath)
        };
    }

    return { success: false };
});

// Obtener carpeta de descargas por defecto
ipcMain.handle('get-default-download-path', () => {
    return selectedDownloadPath || app.getPath('downloads');
});

// Abrir archivo o carpeta
ipcMain.handle('open-path', async (event, filePath) => {
    try {
        await shell.openPath(filePath);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// Mostrar archivo en la carpeta (abrir explorador con archivo seleccionado)
ipcMain.handle('show-item-in-folder', (event, filePath) => {
    shell.showItemInFolder(filePath);
    return { success: true };
});

// ═══════════════════════════════════════════════════════════
// IPC HANDLERS - SETTINGS
// ═══════════════════════════════════════════════════════════

ipcMain.handle('get-settings', () => {
    return settings;
});

ipcMain.handle('save-settings', (event, newSettings) => {
    settings = { ...settings, ...newSettings };
    saveSettings(settings);

    // Aplicar cambios inmediatamente
    if (newSettings.autoStart !== undefined) {
        app.setLoginItemSettings({
            openAtLogin: settings.autoStart,
            args: ['--hidden']
        });
    }

    if (newSettings.clipboardMonitoring !== undefined) {
        if (settings.clipboardMonitoring) {
            startClipboardMonitoring();
        } else {
            stopClipboardMonitoring();
        }
    }

    // Recrear tray para reflejar cambios
    if (tray) {
        tray.destroy();
    }
    createTray();

    return { success: true };
});

// ═══════════════════════════════════════════════════════════
// IPC HANDLERS - BORRADORES (DRAFTS)
// ═══════════════════════════════════════════════════════════

ipcMain.handle('get-drafts', () => {
    return loadDrafts();
});

ipcMain.handle('remove-draft', (event, id) => {
    return removeFromDrafts(id);
});

ipcMain.handle('clear-drafts', () => {
    return clearDrafts();
});

// ═══════════════════════════════════════════════════════════
// AUTO-UPDATER (Actualizaciones Automáticas via GitHub)
// ═══════════════════════════════════════════════════════════

function setupAutoUpdater() {
    // Solo activar en modo empaquetado
    if (!isPackaged) {
        console.log('Auto-updater desactivado en desarrollo');
        return;
    }

    // Configurar autoUpdater
    autoUpdater.autoDownload = false; // Preguntar antes de descargar
    autoUpdater.autoInstallOnAppQuit = true;

    // Evento: hay una nueva versión disponible
    autoUpdater.on('update-available', (info) => {
        console.log('Nueva versión disponible:', info.version);

        const notification = new Notification({
            title: '🆕 Nueva versión disponible',
            body: `Videownload ${info.version} está lista para descargar`,
            icon: path.join(__dirname, 'assets', 'icon.png')
        });

        notification.on('click', async () => {
            const { response } = await dialog.showMessageBox(mainWindow, {
                type: 'info',
                buttons: ['Descargar ahora', 'Después'],
                title: 'Actualización disponible',
                message: `Nueva versión ${info.version}`,
                detail: 'Hay una nueva versión de Videownload disponible. ¿Deseas descargarla ahora?'
            });

            if (response === 0) {
                autoUpdater.downloadUpdate();
            }
        });

        notification.show();
    });

    // Evento: descarga en progreso
    autoUpdater.on('download-progress', (progress) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.setProgressBar(progress.percent / 100);
        }
    });

    // Evento: actualización descargada
    autoUpdater.on('update-downloaded', async (info) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.setProgressBar(-1); // Quitar barra de progreso
        }

        const notification = new Notification({
            title: '✅ Actualización lista',
            body: 'Click para instalar y reiniciar',
            icon: path.join(__dirname, 'assets', 'icon.png')
        });

        notification.on('click', () => {
            autoUpdater.quitAndInstall();
        });

        notification.show();

        // También mostrar diálogo
        const { response } = await dialog.showMessageBox(mainWindow, {
            type: 'info',
            buttons: ['Reiniciar ahora', 'Después'],
            title: 'Actualización descargada',
            message: `Videownload ${info.version} está lista`,
            detail: 'La actualización se instalará al reiniciar la aplicación.'
        });

        if (response === 0) {
            autoUpdater.quitAndInstall();
        }
    });

    // Evento: error
    autoUpdater.on('error', (err) => {
        console.error('Error en auto-updater:', err);
    });

    // Chequear actualizaciones cada hora
    setInterval(() => {
        autoUpdater.checkForUpdates();
    }, 60 * 60 * 1000);

    // Chequear al iniciar (después de 10 segundos)
    setTimeout(() => {
        autoUpdater.checkForUpdates();
    }, 10000);
}

// Inicializar auto-updater cuando la app esté lista
app.on('ready', () => {
    setupAutoUpdater();
});

// ═══════════════════════════════════════════════════════════
// CICLO DE VIDA DE LA APP
// ═══════════════════════════════════════════════════════════

app.on('window-all-closed', () => {
    // No cerrar si hay tray activo
    if (!tray) {
        if (process.platform !== 'darwin') {
            app.quit();
        }
    }
});

app.on('activate', () => {
    if (mainWindow === null) {
        createMainWindow();
    }
});

// Limpiar al cerrar
app.on('before-quit', () => {
    app.isQuitting = true;
    stopClipboardMonitoring();
});
