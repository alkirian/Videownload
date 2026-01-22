const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const archiver = require('archiver');

const app = express();
const PORT = process.env.PORT || 3000;

// ═══════════════════════════════════════════════════════════
// DETECCIÓN DE MODO ELECTRON Y RUTAS DE HERRAMIENTAS
// ═══════════════════════════════════════════════════════════

const isElectronMode = process.env.ELECTRON_MODE === 'true';

// Función para obtener la ruta de yt-dlp
function getYtDlpPath() {
    // 1. Si está en modo Electron, usar variable de entorno
    if (process.env.YT_DLP_PATH && fs.existsSync(process.env.YT_DLP_PATH)) {
        return process.env.YT_DLP_PATH;
    }

    // 2. Fallback a WinGet
    return path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'WinGet', 'Links', 'yt-dlp.exe');
}

// Función para obtener el directorio de ffmpeg
function getFfmpegDir() {
    // 1. Si está en modo Electron, usar variable de entorno
    if (process.env.FFMPEG_DIR && fs.existsSync(process.env.FFMPEG_DIR)) {
        return process.env.FFMPEG_DIR;
    }

    // 2. Buscar en paquetes de WinGet
    const packagesDir = path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages');
    try {
        const dirs = fs.readdirSync(packagesDir);
        for (const dir of dirs) {
            if (dir.toLowerCase().includes('ffmpeg')) {
                const binPath = path.join(packagesDir, dir);
                // Buscar recursivamente ffmpeg.exe
                const findFfmpeg = (dirPath) => {
                    const files = fs.readdirSync(dirPath);
                    for (const file of files) {
                        const fullPath = path.join(dirPath, file);
                        const stat = fs.statSync(fullPath);
                        if (stat.isDirectory()) {
                            const result = findFfmpeg(fullPath);
                            if (result) return result;
                        } else if (file.toLowerCase() === 'ffmpeg.exe') {
                            return path.dirname(fullPath);
                        }
                    }
                    return null;
                };
                const result = findFfmpeg(binPath);
                if (result) return result;
            }
        }
    } catch (e) {
        console.error('Error buscando ffmpeg:', e);
    }

    // 3. Fallback
    return path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'WinGet', 'Links');
}

const YT_DLP_PATH = getYtDlpPath();
const FFMPEG_DIR = getFfmpegDir();

console.log('Modo Electron:', isElectronMode);
console.log('yt-dlp:', YT_DLP_PATH);
console.log('FFmpeg:', FFMPEG_DIR);

// ═══════════════════════════════════════════════════════════
// DETECCIÓN DE PLATAFORMA
// ═══════════════════════════════════════════════════════════

function detectPlatform(url) {
    const urlLower = url.toLowerCase();

    if (urlLower.includes('youtube.com') || urlLower.includes('youtu.be')) {
        return 'youtube';
    }
    if (urlLower.includes('tiktok.com')) {
        return 'tiktok';
    }
    if (urlLower.includes('instagram.com')) {
        return 'instagram';
    }
    if (urlLower.includes('twitter.com') || urlLower.includes('x.com')) {
        return 'twitter';
    }
    if (urlLower.includes('facebook.com') || urlLower.includes('fb.watch') || urlLower.includes('fb.com')) {
        return 'facebook';
    }
    if (urlLower.includes('vimeo.com')) {
        return 'vimeo';
    }
    if (urlLower.includes('twitch.tv')) {
        return 'twitch';
    }
    if (urlLower.includes('reddit.com') || urlLower.includes('redd.it')) {
        return 'reddit';
    }
    if (urlLower.includes('pinterest.com') || urlLower.includes('pin.it')) {
        return 'pinterest';
    }
    if (urlLower.includes('dailymotion.com') || urlLower.includes('dai.ly')) {
        return 'dailymotion';
    }
    if (urlLower.includes('soundcloud.com')) {
        return 'soundcloud';
    }

    return 'unknown';
}

// Configuración por plataforma
const PLATFORM_CONFIG = {
    youtube: {
        name: 'YouTube',
        icon: '▶️',
        supportsQuality: true,
        supportsTrim: true,
        supportsPlaylist: true
    },
    tiktok: {
        name: 'TikTok',
        icon: '🎵',
        supportsQuality: false,
        supportsTrim: true,
        supportsPlaylist: false
    },
    instagram: {
        name: 'Instagram',
        icon: '📷',
        supportsQuality: false,
        supportsTrim: true,
        supportsPlaylist: false
    },
    twitter: {
        name: 'Twitter/X',
        icon: '🐦',
        supportsQuality: true,
        supportsTrim: true,
        supportsPlaylist: false
    },
    facebook: {
        name: 'Facebook',
        icon: '📘',
        supportsQuality: true,
        supportsTrim: true,
        supportsPlaylist: false
    },
    vimeo: {
        name: 'Vimeo',
        icon: '🎬',
        supportsQuality: true,
        supportsTrim: true,
        supportsPlaylist: false
    },
    twitch: {
        name: 'Twitch',
        icon: '🎮',
        supportsQuality: true,
        supportsTrim: true,
        supportsPlaylist: false
    },
    reddit: {
        name: 'Reddit',
        icon: '🤖',
        supportsQuality: false,
        supportsTrim: true,
        supportsPlaylist: false
    },
    pinterest: {
        name: 'Pinterest',
        icon: '📌',
        supportsQuality: false,
        supportsTrim: false,
        supportsPlaylist: false
    },
    dailymotion: {
        name: 'Dailymotion',
        icon: '📺',
        supportsQuality: true,
        supportsTrim: true,
        supportsPlaylist: false
    },
    soundcloud: {
        name: 'SoundCloud',
        icon: '🔊',
        supportsQuality: false,
        supportsTrim: true,
        supportsPlaylist: false,
        audioOnly: true  // SoundCloud es solo audio
    },
    unknown: {
        name: 'Otro',
        icon: '🎬',
        supportsQuality: true,
        supportsTrim: true,
        supportsPlaylist: false
    }
};

// Middleware
app.use(cors());
app.use(express.json());

// Determinar la ruta base de la aplicación
const APP_PATH = process.env.APP_PATH || __dirname;

// Servir archivos estáticos desde la ruta correcta
// Deshabilitar caché en desarrollo para asegurar archivos actualizados
app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    next();
});
app.use(express.static(path.join(APP_PATH, 'public')));


// Directorio para archivos temporales (fuera del ASAR en modo Electron)
const TEMP_DIR = isElectronMode
    ? path.join(process.env.TEMP_PATH || path.join(require('os').homedir(), 'AppData', 'Roaming', 'downloadflow', 'temp'))
    : path.join(__dirname, 'temp');

if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Almacén de progreso de descargas
const downloads = new Map();

// Función para ejecutar comandos y capturar salida
function runCommand(command, args) {
    return new Promise((resolve, reject) => {
        const proc = spawn(command, args, { shell: true });
        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        proc.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        proc.on('close', (code) => {
            if (code === 0) {
                resolve(stdout);
            } else {
                reject(new Error(stderr || stdout));
            }
        });

        proc.on('error', (err) => {
            reject(err);
        });
    });
}

// GET /api/info - Obtener información del video
app.get('/api/info', async (req, res) => {
    let { url } = req.query;

    if (!url) {
        return res.status(400).json({ error: 'URL requerida' });
    }

    // Detectar plataforma
    const platform = detectPlatform(url);
    const platformConfig = PLATFORM_CONFIG[platform];

    // Limpiar la URL solo para YouTube: extraer solo el video ID si tiene parámetros de mix/playlist
    if (platform === 'youtube') {
        try {
            const urlObj = new URL(url);
            const videoId = urlObj.searchParams.get('v');
            if (videoId && (urlObj.searchParams.has('list') || urlObj.searchParams.has('start_radio'))) {
                // Es un mix o playlist, usar solo el video ID
                url = `https://www.youtube.com/watch?v=${videoId}`;
            }
        } catch (e) {
            // Si falla el parsing, continuar con la URL original
        }
    }

    try {
        const output = await runCommand(YT_DLP_PATH, [
            '--dump-json',
            '--no-playlist',
            '--ignore-errors',
            '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            url
        ]);

        const info = JSON.parse(output);

        // Verificar si es una transmisión en vivo
        if (info.is_live || info.live_status === 'is_live') {
            return res.status(400).json({
                error: '🔴 Este video es una transmisión EN VIVO. No se pueden descargar transmisiones en vivo.',
                isLive: true,
                platform: platform
            });
        }

        // Verificar si es un video que aún no ha terminado (premiere)
        if (info.live_status === 'is_upcoming') {
            return res.status(400).json({
                error: '⏳ Este video es un ESTRENO programado. Espera a que comience y termine para descargarlo.',
                isUpcoming: true,
                platform: platform
            });
        }

        // Extraer formatos disponibles
        const formats = (info.formats || [])
            .filter(f => f.vcodec !== 'none' || f.acodec !== 'none')
            .map(f => ({
                format_id: f.format_id,
                ext: f.ext,
                resolution: f.resolution || 'audio only',
                filesize: f.filesize,
                vcodec: f.vcodec,
                acodec: f.acodec,
                quality: f.quality,
                format_note: f.format_note
            }))
            .filter(f => f.resolution !== 'audio only' || f.acodec !== 'none');

        // Obtener calidades de video únicas
        const videoQualities = [...new Set(
            (info.formats || [])
                .filter(f => f.vcodec !== 'none' && f.height)
                .map(f => f.height)
        )].sort((a, b) => b - a);

        res.json({
            id: info.id,
            title: info.title,
            thumbnail: info.thumbnail,
            duration: info.duration,
            uploader: info.uploader || info.channel || info.creator || platformConfig.name,
            view_count: info.view_count,
            upload_date: info.upload_date,
            description: info.description?.substring(0, 200),
            videoQualities: platformConfig.supportsQuality ? videoQualities : [],
            formats,
            // Información de plataforma
            platform: platform,
            platformName: platformConfig.name,
            platformIcon: platformConfig.icon,
            supportsQuality: platformConfig.supportsQuality,
            supportsTrim: platformConfig.supportsTrim,
            supportsPlaylist: platformConfig.supportsPlaylist
        });
    } catch (error) {
        console.error('Error obteniendo info:', error);
        res.status(500).json({
            error: `Error al obtener información del video de ${platformConfig.name}`,
            platform: platform
        });
    }
});

// GET /api/detect - Detectar si es playlist o video único
app.get('/api/detect', async (req, res) => {
    const { url } = req.query;

    if (!url) {
        return res.status(400).json({ error: 'URL requerida' });
    }

    try {
        // Verificar si es una playlist
        const isPlaylistUrl = url.includes('playlist') || url.includes('list=');

        if (isPlaylistUrl) {
            // Obtener info de la playlist
            const output = await runCommand(YT_DLP_PATH, [
                '--flat-playlist',
                '--dump-json',
                url
            ]);

            // Parsear cada línea como JSON (yt-dlp devuelve un JSON por línea para playlists)
            const lines = output.trim().split('\n').filter(line => line.trim());
            const videos = lines.map(line => {
                try {
                    const item = JSON.parse(line);
                    return {
                        id: item.id,
                        title: item.title || `Video ${item.id}`,
                        url: item.url || `https://www.youtube.com/watch?v=${item.id}`,
                        duration: item.duration
                    };
                } catch (e) {
                    return null;
                }
            }).filter(v => v !== null);

            res.json({
                isPlaylist: true,
                playlistTitle: videos.length > 0 ? 'Playlist' : 'Playlist',
                videoCount: videos.length,
                videos: videos
            });
        } else {
            // Es un video único
            res.json({
                isPlaylist: false,
                videoCount: 1
            });
        }
    } catch (error) {
        console.error('Error detectando tipo:', error);
        // Si falla, asumir que es video único
        res.json({
            isPlaylist: false,
            videoCount: 1
        });
    }
});

// POST /api/download - Iniciar descarga
app.post('/api/download', async (req, res) => {
    const { url, quality, audioOnly, startTime, endTime } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'URL requerida' });
    }

    const downloadId = uuidv4();
    const outputPath = path.join(TEMP_DIR, downloadId);

    downloads.set(downloadId, {
        status: 'starting',
        progress: 0,
        filename: null,
        error: null
    });

    res.json({ downloadId });

    // Proceso de descarga en background
    (async () => {
        try {
            downloads.set(downloadId, { ...downloads.get(downloadId), status: 'downloading', progress: 5 });

            // Construir argumentos de yt-dlp
            const args = [
                '--no-playlist',
                '--ffmpeg-location', FFMPEG_DIR,
                '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            ];

            if (audioOnly) {
                args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
            } else {
                // Forzar salida en MP4
                args.push('--merge-output-format', 'mp4');

                if (quality) {
                    // Formato: mejor video con altura exacta + mejor audio, fallback a mejor disponible
                    args.push('-f', `bestvideo[height=${quality}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height=${quality}]+bestaudio/bestvideo[height<=${quality}]+bestaudio/best`);
                } else {
                    args.push('-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best');
                }
            }

            // Si hay recorte de tiempo - OPTIMIZADO: sin re-encoding para mayor velocidad
            if (startTime !== undefined && endTime !== undefined && startTime !== endTime) {
                // --download-sections descarga solo el fragmento seleccionado
                // NO usamos --force-keyframes-at-cuts para evitar re-encoding lento
                // El corte puede ser levemente impreciso (hasta el keyframe más cercano)
                args.push('--download-sections', `*${startTime}-${endTime}`);
            }

            // Nombre de archivo: ID_Titulo.ext (el ID permite encontrarlo, el título para el usuario)
            args.push('-o', `${outputPath}_%(title)s.%(ext)s`, url);

            // Ejecutar yt-dlp con progreso
            console.log('Ejecutando yt-dlp con args:', JSON.stringify(args));
            const proc = spawn(YT_DLP_PATH, args);
            let fullStderr = '';

            proc.stdout.on('data', (data) => {
                const output = data.toString();
                console.log('stdout:', output);
                const match = output.match(/(\d+\.?\d*)%/);
                if (match) {
                    const progress = Math.min(parseFloat(match[1]), 95);
                    downloads.set(downloadId, {
                        ...downloads.get(downloadId),
                        progress,
                        status: 'downloading'
                    });
                }
            });

            proc.stderr.on('data', (data) => {
                const output = data.toString();
                fullStderr += output;
                console.log('stderr:', output);
                const match = output.match(/(\d+\.?\d*)%/);
                if (match) {
                    const progress = Math.min(parseFloat(match[1]), 95);
                    downloads.set(downloadId, {
                        ...downloads.get(downloadId),
                        progress,
                        status: 'downloading'
                    });
                }
            });

            await new Promise((resolve, reject) => {
                proc.on('close', (code) => {
                    if (code === 0) resolve();
                    else {
                        console.error('yt-dlp stderr completo:', fullStderr);
                        reject(new Error(`yt-dlp exited with code ${code}: ${fullStderr.slice(-500)}`));
                    }
                });
                proc.on('error', reject);
            });

            // Buscar el archivo descargado
            const files = fs.readdirSync(TEMP_DIR);
            const downloadedFile = files.find(f => f.startsWith(downloadId));

            if (!downloadedFile) {
                throw new Error('Archivo no encontrado después de la descarga');
            }

            downloads.set(downloadId, {
                status: 'completed',
                progress: 100,
                filename: downloadedFile,
                error: null
            });

        } catch (error) {
            console.error('Error en descarga:', error);
            downloads.set(downloadId, {
                status: 'error',
                progress: 0,
                filename: null,
                error: error.message
            });
        }
    })();
});

// GET /api/progress/:id - Obtener progreso
app.get('/api/progress/:id', (req, res) => {
    const { id } = req.params;
    const download = downloads.get(id);

    if (!download) {
        return res.status(404).json({ error: 'Descarga no encontrada' });
    }

    res.json(download);
});

// GET /api/file/:id - Descargar archivo
app.get('/api/file/:id', (req, res) => {
    const { id } = req.params;
    const download = downloads.get(id);

    if (!download || download.status !== 'completed') {
        return res.status(404).json({ error: 'Archivo no disponible' });
    }

    const filePath = path.join(TEMP_DIR, download.filename);

    // Extraer nombre limpio del archivo (quitar el UUID del inicio)
    // Formato: UUID_titulo.ext -> titulo.ext
    let friendlyName = download.filename;
    const underscoreIndex = friendlyName.indexOf('_');
    if (underscoreIndex !== -1) {
        friendlyName = friendlyName.substring(underscoreIndex + 1);
    }

    // Limpiar caracteres problemáticos del nombre
    friendlyName = friendlyName.replace(/[<>:"/\\|?*]/g, '_');

    res.download(filePath, friendlyName, (err) => {
        if (err) {
            console.error('Error enviando archivo:', err);
        }
        // Limpiar archivo después de descarga
        setTimeout(() => {
            try {
                fs.unlinkSync(filePath);
                downloads.delete(id);
            } catch (e) {
                console.error('Error limpiando archivo:', e);
            }
        }, 60000); // Esperar 1 minuto antes de limpiar
    });
});

// GET /api/download-direct - Descarga directa (el navegador maneja el progreso)
app.get('/api/download-direct', async (req, res) => {
    const { url, quality, audioOnly, startTime, endTime } = req.query;

    if (!url) {
        return res.status(400).send('URL requerida');
    }

    const downloadId = uuidv4();
    const outputPath = path.join(TEMP_DIR, downloadId);

    try {
        // Construir argumentos de yt-dlp con optimizaciones de velocidad
        const args = [
            '--no-playlist',
            '--ffmpeg-location', FFMPEG_DIR,
            // Optimizaciones de velocidad máxima
            '--concurrent-fragments', '8',   // Descargar 8 fragmentos en paralelo
            '--buffer-size', '64K',          // Buffer más grande
            '--http-chunk-size', '10M',      // Chunks de 10MB
            '--throttled-rate', '100K',      // Evitar throttling de YouTube
            '--no-check-certificate'         // Saltar verificación SSL
        ];

        if (audioOnly === 'true') {
            args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
        } else {
            args.push('--merge-output-format', 'mp4');
            if (quality) {
                args.push('-f', `bestvideo[height=${quality}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height=${quality}]+bestaudio/bestvideo[height<=${quality}]+bestaudio/best`);
            } else {
                args.push('-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best');
            }
        }

        // Si hay recorte de tiempo
        if (startTime && endTime && startTime !== endTime) {
            args.push(
                '--download-sections', `*${startTime}-${endTime}`,
                '--force-keyframes-at-cuts'
            );
        }

        args.push('-o', `${outputPath}_%(title)s.%(ext)s`, url);

        console.log('Download-direct: Ejecutando yt-dlp...');

        // Ejecutar yt-dlp y esperar a que termine
        await new Promise((resolve, reject) => {
            const proc = spawn(YT_DLP_PATH, args);

            proc.stdout.on('data', (data) => {
                console.log('yt-dlp:', data.toString());
            });

            proc.stderr.on('data', (data) => {
                console.log('yt-dlp stderr:', data.toString());
            });

            proc.on('close', (code) => {
                if (code === 0) resolve();
                else reject(new Error(`yt-dlp exited with code ${code}`));
            });

            proc.on('error', reject);
        });

        // Buscar el archivo descargado
        const files = fs.readdirSync(TEMP_DIR);
        const downloadedFile = files.find(f => f.startsWith(downloadId));

        if (!downloadedFile) {
            throw new Error('Archivo no encontrado');
        }

        const filePath = path.join(TEMP_DIR, downloadedFile);

        // Extraer nombre limpio (quitar UUID)
        let friendlyName = downloadedFile;
        const underscoreIndex = friendlyName.indexOf('_');
        if (underscoreIndex !== -1) {
            friendlyName = friendlyName.substring(underscoreIndex + 1);
        }
        friendlyName = friendlyName.replace(/[<>:"/\\|?*]/g, '_');

        console.log('Download-direct: Enviando archivo:', friendlyName);

        // Enviar archivo al navegador
        res.download(filePath, friendlyName, (err) => {
            if (err && !res.headersSent) {
                console.error('Error enviando archivo:', err);
            }
            // Limpiar después
            setTimeout(() => {
                try {
                    fs.unlinkSync(filePath);
                } catch (e) {
                    // Ignorar error de limpieza
                }
            }, 60000);
        });

    } catch (error) {
        console.error('Error en download-direct:', error);
        if (!res.headersSent) {
            res.status(500).send('Error al descargar el video');
        }
    }
});

// ═══════════════════════════════════════════════════════════
// GET /api/download-stream - Descarga con progreso en tiempo real (SSE)
// ═══════════════════════════════════════════════════════════
app.get('/api/download-stream', async (req, res) => {
    const { url, quality, audioOnly, startTime, endTime, outputDir } = req.query;

    if (!url) {
        return res.status(400).json({ error: 'URL requerida' });
    }

    // Configurar SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Enviar evento SSE
    const sendEvent = (event, data) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const downloadId = uuidv4();

    // Decodificar y validar carpeta de destino
    let decodedOutputDir = null;
    if (outputDir) {
        try {
            decodedOutputDir = decodeURIComponent(outputDir);
            console.log('Download-stream: outputDir recibido:', outputDir);
            console.log('Download-stream: outputDir decodificado:', decodedOutputDir);
            console.log('Download-stream: outputDir existe:', fs.existsSync(decodedOutputDir));
        } catch (e) {
            console.error('Download-stream: Error decodificando outputDir:', e);
            decodedOutputDir = outputDir;
        }
    }

    // Usar carpeta personalizada o TEMP_DIR
    const outputDirectory = decodedOutputDir && fs.existsSync(decodedOutputDir) ? decodedOutputDir : TEMP_DIR;
    console.log('Download-stream: Usando directorio:', outputDirectory);
    const outputPath = path.join(outputDirectory, downloadId);

    try {
        sendEvent('start', { message: 'Iniciando descarga...' });

        // Construir argumentos de yt-dlp con optimizaciones de velocidad
        const args = [
            '--no-playlist',
            '--ffmpeg-location', FFMPEG_DIR,
            '--newline',  // Importante para parsear progreso
            '--progress-template', '%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s',
            // Optimizaciones de velocidad máxima
            '--concurrent-fragments', '8',   // Descargar 8 fragmentos en paralelo
            '--buffer-size', '64K',          // Buffer más grande
            '--http-chunk-size', '10M',      // Chunks de 10MB
            '--throttled-rate', '100K',      // Evitar throttling de YouTube
            '--no-check-certificate'
        ];

        if (audioOnly === 'true') {
            args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
        } else {
            args.push('--merge-output-format', 'mp4');
            if (quality) {
                args.push('-f', `bestvideo[height=${quality}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height=${quality}]+bestaudio/bestvideo[height<=${quality}]+bestaudio/best`);
            } else {
                args.push('-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best');
            }
        }

        // Si hay recorte de tiempo
        if (startTime && endTime && startTime !== endTime) {
            args.push(
                '--download-sections', `*${startTime}-${endTime}`,
                '--force-keyframes-at-cuts'
            );
        }

        args.push('-o', `${outputPath}_%(title)s.%(ext)s`, url);

        console.log('Download-stream: Ejecutando yt-dlp con SSE...');

        // Ejecutar yt-dlp y parsear progreso
        await new Promise((resolve, reject) => {
            const proc = spawn(YT_DLP_PATH, args);

            proc.stdout.on('data', (data) => {
                const output = data.toString();
                console.log('yt-dlp:', output);

                // Parsear progreso
                const lines = output.split('\n');
                for (const line of lines) {
                    if (line.includes('%')) {
                        // Intentar extraer porcentaje
                        const match = line.match(/([\d.]+)%/);
                        if (match) {
                            const percent = parseFloat(match[1]);
                            sendEvent('progress', {
                                percent: Math.min(percent, 100),
                                raw: line.trim()
                            });
                        }
                    }
                }
            });

            proc.stderr.on('data', (data) => {
                console.log('yt-dlp stderr:', data.toString());
            });

            proc.on('close', (code) => {
                if (code === 0) resolve();
                else reject(new Error(`yt-dlp exited with code ${code}`));
            });

            proc.on('error', reject);
        });

        // Buscar archivo descargado
        const files = fs.readdirSync(outputDirectory);
        const downloadedFile = files.find(f => f.startsWith(downloadId));

        if (!downloadedFile) {
            throw new Error('Archivo no encontrado después de la descarga');
        }

        const filePath = path.join(outputDirectory, downloadedFile);
        const stats = fs.statSync(filePath);

        // Extraer nombre limpio (quitar UUID) y renombrar archivo
        let friendlyName = downloadedFile;
        const underscoreIndex = friendlyName.indexOf('_');
        if (underscoreIndex !== -1) {
            friendlyName = friendlyName.substring(underscoreIndex + 1);
        }
        // Sanitizar nombre para Windows
        friendlyName = friendlyName.replace(/[<>:"/\\|?*]/g, '_');

        // Renombrar archivo al nombre original del video
        const newFilePath = path.join(outputDirectory, friendlyName);

        // Si ya existe un archivo con ese nombre, agregar número
        let finalPath = newFilePath;
        let counter = 1;
        while (fs.existsSync(finalPath)) {
            const ext = path.extname(friendlyName);
            const baseName = path.basename(friendlyName, ext);
            finalPath = path.join(outputDirectory, `${baseName} (${counter})${ext}`);
            counter++;
        }

        // Renombrar el archivo
        fs.renameSync(filePath, finalPath);
        const finalName = path.basename(finalPath);

        sendEvent('complete', {
            success: true,
            filePath: finalPath,
            fileName: finalName,
            fileSize: stats.size,
            outputDir: outputDirectory
        });

        // Si se guardó en TEMP_DIR, limpiar después de un tiempo
        if (outputDirectory === TEMP_DIR) {
            setTimeout(() => {
                try {
                    fs.unlinkSync(finalPath);
                } catch (e) {
                    // Ignorar
                }
            }, 300000); // 5 minutos
        }

    } catch (error) {
        console.error('Error en download-stream:', error);
        sendEvent('error', {
            success: false,
            message: error.message || 'Error al descargar el video'
        });
    }

    res.end();
});

// POST /api/download-batch - Descargar múltiples videos (ZIP si son 3+)
app.post('/api/download-batch', async (req, res) => {
    const { videos } = req.body;  // Array de { url, quality, audioOnly }

    if (!videos || !Array.isArray(videos) || videos.length === 0) {
        return res.status(400).json({ error: 'Se requiere lista de videos' });
    }

    const MIN_FOR_ZIP = 3;  // Crear ZIP si hay 3 o más videos

    // Si son pocos videos, devolver URLs para descarga individual
    if (videos.length < MIN_FOR_ZIP) {
        const downloadUrls = videos.map(v => {
            const params = new URLSearchParams({
                url: v.url,
                audioOnly: (v.audioOnly || false).toString()
            });
            if (v.quality) params.set('quality', v.quality.toString());
            return `/api/download-direct?${params.toString()}`;
        });
        return res.json({ mode: 'individual', urls: downloadUrls });
    }

    // Crear batch ID y carpeta temporal
    const batchId = uuidv4();
    const batchDir = path.join(TEMP_DIR, `batch_${batchId}`);
    fs.mkdirSync(batchDir, { recursive: true });

    console.log(`Batch download iniciado: ${videos.length} videos`);

    try {
        // Descargar cada video
        for (let i = 0; i < videos.length; i++) {
            const video = videos[i];
            console.log(`Descargando video ${i + 1}/${videos.length}: ${video.url}`);

            const args = [
                '--no-playlist',
                '--ffmpeg-location', FFMPEG_DIR,
                // Optimizaciones de velocidad máxima
                '--concurrent-fragments', '8',
                '--buffer-size', '64K',
                '--http-chunk-size', '10M',
                '--throttled-rate', '100K',
                '--no-check-certificate'
            ];

            if (video.audioOnly) {
                args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
            } else {
                args.push('--merge-output-format', 'mp4');
                if (video.quality) {
                    args.push('-f', `bestvideo[height=${video.quality}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height=${video.quality}]+bestaudio/best`);
                } else {
                    args.push('-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best');
                }
            }

            args.push('-o', path.join(batchDir, '%(title)s.%(ext)s'), video.url);

            await new Promise((resolve, reject) => {
                const proc = spawn(YT_DLP_PATH, args);
                proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`yt-dlp error code ${code}`)));
                proc.on('error', reject);
            });
        }

        // Crear archivo ZIP
        const zipPath = path.join(TEMP_DIR, `videos_${batchId}.zip`);
        const output = fs.createWriteStream(zipPath);
        const archive = archiver('zip', { zlib: { level: 5 } });

        output.on('close', () => {
            console.log(`ZIP creado: ${archive.pointer()} bytes`);

            // Enviar ZIP al cliente
            res.download(zipPath, 'Videownload_Videos.zip', (err) => {
                // Limpiar archivos después
                setTimeout(() => {
                    try {
                        fs.rmSync(batchDir, { recursive: true, force: true });
                        fs.unlinkSync(zipPath);
                    } catch (e) {
                        console.error('Error limpiando batch:', e);
                    }
                }, 60000);
            });
        });

        archive.on('error', (err) => {
            throw err;
        });

        archive.pipe(output);
        archive.directory(batchDir, false);
        await archive.finalize();

    } catch (error) {
        console.error('Error en batch download:', error);
        // Limpiar en caso de error
        try {
            fs.rmSync(batchDir, { recursive: true, force: true });
        } catch (e) { }

        if (!res.headersSent) {
            res.status(500).json({ error: 'Error al descargar videos' });
        }
    }
});

// Iniciar servidor con manejo de puerto
const net = require('net');

function findAvailablePort(startPort, callback) {
    const server = net.createServer();
    server.listen(startPort, () => {
        const port = server.address().port;
        server.close(() => callback(null, port));
    });
    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            // Puerto en uso, probar el siguiente
            findAvailablePort(startPort + 1, callback);
        } else {
            callback(err);
        }
    });
}

// Buscar puerto disponible y arrancar
findAvailablePort(PORT, (err, availablePort) => {
    if (err) {
        console.error('Error buscando puerto:', err);
        process.exit(1);
    }

    app.listen(availablePort, () => {
        // Guardar el puerto en variable global para que Electron lo use
        global.SERVER_PORT = availablePort;

        console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🎬 Video Downloader Server                              ║
║   ════════════════════════════════════════════            ║
║                                                           ║
║   Servidor corriendo en: http://localhost:${availablePort}           ║
║                                                           ║
║   Endpoints:                                              ║
║   • GET  /api/info?url=...    - Info del video           ║
║   • POST /api/download        - Iniciar descarga         ║
║   • GET  /api/progress/:id    - Progreso                 ║
║   • GET  /api/file/:id        - Descargar archivo        ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
        `);
    });
});

// Exportar app y puerto para uso externo
module.exports = { app, getPort: () => global.SERVER_PORT || PORT };
