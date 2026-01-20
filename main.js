const { app, BrowserWindow, dialog, ipcMain } = require('electron');
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

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// ═══════════════════════════════════════════════════════════
// CICLO DE VIDA DE LA APP
// ═══════════════════════════════════════════════════════════

app.whenReady().then(async () => {
    // Mostrar splash
    createSplashWindow();

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
// CICLO DE VIDA DE LA APP
// ═══════════════════════════════════════════════════════════

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (mainWindow === null) {
        createMainWindow();
    }
});

// Limpiar al cerrar
app.on('before-quit', () => {
    // El servidor se cierra automáticamente con el proceso
});
