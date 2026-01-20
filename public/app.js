// ═══════════════════════════════════════════════════════════
// Video Downloader - Frontend Logic
// ═══════════════════════════════════════════════════════════

const API_BASE = '';

// Estado de la aplicación
const state = {
    videoInfo: null,
    selectedQuality: null,
    audioOnly: false,
    trimEnabled: false,
    startTime: 0,
    endTime: 0,
    duration: 0,
    downloadId: null,
    isDownloading: false,
    // Cola de descargas
    queue: [],
    isProcessingQueue: false,
    // Playlist
    pendingPlaylistVideos: [],
    currentUrl: '',
    // Carpeta de descarga
    downloadPath: null,
    downloadPathName: null,
    // Historial de descargas (guardado en localStorage)
    downloadHistory: JSON.parse(localStorage.getItem('downloadHistory') || '[]'),
    // Último archivo descargado (para modal de éxito)
    lastDownload: null
};

// Elementos del DOM
const elements = {
    urlInput: document.getElementById('urlInput'),
    fetchBtn: document.getElementById('fetchBtn'),
    errorMessage: document.getElementById('errorMessage'),
    videoPreview: document.getElementById('videoPreview'),
    thumbnail: document.getElementById('thumbnail'),
    durationBadge: document.getElementById('durationBadge'),
    platformBadge: document.getElementById('platformBadge'),
    videoTitle: document.getElementById('videoTitle'),
    videoUploader: document.getElementById('videoUploader'),
    videoToggle: document.getElementById('videoToggle'),
    audioToggle: document.getElementById('audioToggle'),
    qualityCard: document.getElementById('qualityCard'),
    qualitySelector: document.getElementById('qualitySelector'),
    trimEnabled: document.getElementById('trimEnabled'),
    timelineContainer: document.getElementById('timelineContainer'),
    timelineTrack: document.getElementById('timelineTrack'),
    timelineRange: document.getElementById('timelineRange'),
    handleStart: document.getElementById('handleStart'),
    handleEnd: document.getElementById('handleEnd'),
    startTimeDisplay: document.getElementById('startTimeDisplay'),
    endTimeDisplay: document.getElementById('endTimeDisplay'),
    timelineTicks: document.getElementById('timelineTicks'),
    downloadBtn: document.getElementById('downloadBtn'),
    addToQueueBtn: document.getElementById('addToQueueBtn'),
    progressContainer: document.getElementById('progressContainer'),
    progressFill: document.getElementById('progressFill'),
    progressText: document.getElementById('progressText'),
    statusText: document.getElementById('statusText'),
    // Cola
    queueSection: document.getElementById('queueSection'),
    queueCount: document.getElementById('queueCount'),
    queueList: document.getElementById('queueList'),
    clearQueueBtn: document.getElementById('clearQueueBtn'),
    downloadAllBtn: document.getElementById('downloadAllBtn'),
    // Modal Playlist
    playlistModal: document.getElementById('playlistModal'),
    playlistInfo: document.getElementById('playlistInfo'),
    singleVideoBtn: document.getElementById('singleVideoBtn'),
    addPlaylistBtn: document.getElementById('addPlaylistBtn'),
    closePlaylistModal: document.getElementById('closePlaylistModal'),
    // Folder picker
    folderPickerBtn: document.getElementById('folderPickerBtn'),
    folderPath: document.getElementById('folderPath'),
    // Modal Éxito
    successModal: document.getElementById('successModal'),
    successFileName: document.getElementById('successFileName'),
    successFileSize: document.getElementById('successFileSize'),
    openFileBtn: document.getElementById('openFileBtn'),
    openFolderBtn: document.getElementById('openFolderBtn'),
    closeSuccessModal: document.getElementById('closeSuccessModal'),
    // Modal Error
    errorModal: document.getElementById('errorModal'),
    errorModalMessage: document.querySelector('#errorModal .error-text'),
    errorDetails: document.getElementById('errorDetails'),
    retryDownloadBtn: document.getElementById('retryDownloadBtn'),
    closeErrorModal: document.getElementById('closeErrorModal'),
    // Historial
    historySection: document.getElementById('historySection'),
    historyList: document.getElementById('historyList'),
    toggleHistoryBtn: document.getElementById('toggleHistoryBtn'),
    clearHistoryBtn: document.getElementById('clearHistoryBtn')
};

// ═══════════════════════════════════════════════════════════
// UTILIDADES
// ═══════════════════════════════════════════════════════════

function formatDuration(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function showError(message) {
    elements.errorMessage.textContent = message;
    elements.errorMessage.style.animation = 'none';
    elements.errorMessage.offsetHeight; // Trigger reflow
    elements.errorMessage.style.animation = 'slideUp 0.3s ease-out';
}

function clearError() {
    elements.errorMessage.textContent = '';
}

function setLoading(button, loading) {
    button.disabled = loading;
    if (button === elements.fetchBtn) {
        button.classList.toggle('loading', loading);
        button.querySelector('span').textContent = loading ? 'Analizando...' : 'Analizar';
    }
}

// ═══════════════════════════════════════════════════════════
// API CALLS
// ═══════════════════════════════════════════════════════════

async function fetchVideoInfo(url) {
    const response = await fetch(`${API_BASE}/api/info?url=${encodeURIComponent(url)}`);
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Error al obtener información');
    }
    return response.json();
}

async function startDownload(options) {
    const response = await fetch(`${API_BASE}/api/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options)
    });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Error al iniciar descarga');
    }
    return response.json();
}

async function checkProgress(downloadId) {
    const response = await fetch(`${API_BASE}/api/progress/${downloadId}`);
    if (!response.ok) {
        throw new Error('Error al verificar progreso');
    }
    return response.json();
}

async function detectPlaylist(url) {
    const response = await fetch(`${API_BASE}/api/detect?url=${encodeURIComponent(url)}`);
    return response.json();
}

// ═══════════════════════════════════════════════════════════
// QUEUE MANAGEMENT
// ═══════════════════════════════════════════════════════════

function addToQueue(videoInfo, url) {
    const queueItem = {
        id: Date.now().toString(),
        url: url,
        title: videoInfo.title,
        thumbnail: videoInfo.thumbnail,
        duration: videoInfo.duration,
        quality: state.audioOnly ? null : state.selectedQuality,
        audioOnly: state.audioOnly,
        // Guardar recorte
        trimEnabled: state.trimEnabled,
        startTime: state.trimEnabled ? state.startTime : 0,
        endTime: state.trimEnabled ? state.endTime : videoInfo.duration,
        status: 'pending'
    };

    state.queue.push(queueItem);
    updateQueueUI();
    showQueueSection();
}

function removeFromQueue(id) {
    state.queue = state.queue.filter(item => item.id !== id);
    updateQueueUI();
    if (state.queue.length === 0) {
        hideQueueSection();
    }
}

// Editar item de la cola - carga el video para modificar parámetros
function editQueueItem(id) {
    const item = state.queue.find(i => i.id === id);
    if (!item) return;

    // Guardar referencia al item que estamos editando
    state.editingQueueItemId = id;

    // Cargar URL en el input
    elements.urlInput.value = item.url;

    // Simular la info del video
    state.videoInfo = {
        title: item.title,
        thumbnail: item.thumbnail,
        duration: item.duration
    };
    state.duration = item.duration;

    // Restaurar parámetros del item
    state.audioOnly = item.audioOnly;
    state.selectedQuality = item.quality;
    state.trimEnabled = item.trimEnabled;
    state.startTime = item.startTime;
    state.endTime = item.endTime;

    // Actualizar UI de audio/video
    if (item.audioOnly) {
        elements.audioToggle.classList.add('active');
        elements.videoToggle.classList.remove('active');
        elements.qualityCard.style.display = 'none';
    } else {
        elements.videoToggle.classList.add('active');
        elements.audioToggle.classList.remove('active');
        elements.qualityCard.style.display = 'block';
    }

    // Actualizar UI de recorte
    elements.trimEnabled.checked = item.trimEnabled;
    elements.timelineContainer.classList.toggle('disabled', !item.trimEnabled);
    updateHandlePositions();

    // Mostrar preview del video
    elements.videoPreview.classList.remove('hidden');
    elements.thumbnail.src = item.thumbnail;
    elements.videoTitle.textContent = item.title;
    elements.videoDuration.textContent = formatDuration(item.duration);

    // Cambiar texto del botón de agregar a "Guardar cambios"
    elements.addToQueueBtn.innerHTML = '<span>💾 Guardar cambios</span>';
    elements.addToQueueBtn.classList.add('editing');

    // Scroll hacia arriba para ver el editor
    window.scrollTo({ top: 0, behavior: 'smooth' });

    showDownloadToast('Editando video', 'Modifica los parámetros y presiona "Guardar cambios"');
}

// Función para actualizar posiciones de handles
function updateHandlePositions() {
    if (!state.duration) return;
    const startPercent = (state.startTime / state.duration) * 100;
    const endPercent = (state.endTime / state.duration) * 100;

    const startHandle = document.getElementById('startHandle');
    const endHandle = document.getElementById('endHandle');
    const selection = document.getElementById('selection');

    if (startHandle) startHandle.style.left = startPercent + '%';
    if (endHandle) endHandle.style.left = endPercent + '%';
    if (selection) {
        selection.style.left = startPercent + '%';
        selection.style.width = (endPercent - startPercent) + '%';
    }

    // Actualizar etiquetas de tiempo
    if (elements.startTimeLabel) elements.startTimeLabel.textContent = formatDuration(state.startTime);
    if (elements.endTimeLabel) elements.endTimeLabel.textContent = formatDuration(state.endTime);
}

function clearQueue() {
    state.queue = [];
    updateQueueUI();
    hideQueueSection();
}

function showQueueSection() {
    elements.queueSection.classList.remove('hidden');
}

function hideQueueSection() {
    elements.queueSection.classList.add('hidden');
}

function updateQueueUI() {
    elements.queueCount.textContent = state.queue.length;
    elements.queueList.innerHTML = '';

    state.queue.forEach(item => {
        const div = document.createElement('div');
        div.className = `queue-item ${item.status}`;

        // Mostrar info de recorte si está habilitado
        const trimInfo = item.trimEnabled
            ? ` • ✂️ ${formatDuration(item.startTime)}-${formatDuration(item.endTime)}`
            : '';

        div.innerHTML = `
            <img class="queue-item-thumb" src="${item.thumbnail}" alt="">
            <div class="queue-item-info">
                <div class="queue-item-title">${item.title}</div>
                <div class="queue-item-meta">
                    ${item.audioOnly ? 'Audio MP3' : item.quality + 'p MP4'}${trimInfo}
                </div>
            </div>
            ${item.status === 'downloading' ? `
                <div class="queue-item-status">
                    <div class="loader-ring" style="width:14px;height:14px;border-width:2px;"></div>
                    Descargando...
                </div>
            ` : item.status === 'completed' ? `
                <div class="queue-item-status">✓ Completado</div>
            ` : `
                <div class="queue-item-actions">
                    <button class="queue-item-edit" data-id="${item.id}" title="Editar">
                        <svg viewBox="0 0 24 24" fill="none">
                            <path d="M11 4H4C3.44772 4 3 4.44772 3 5V20C3 20.5523 3.44772 21 4 21H19C19.5523 21 20 20.5523 20 20V13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                            <path d="M18.5 2.5L21.5 5.5L12 15H9V12L18.5 2.5Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </button>
                    <button class="queue-item-remove" data-id="${item.id}" title="Eliminar">
                        <svg viewBox="0 0 24 24" fill="none">
                            <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                        </svg>
                    </button>
                </div>
            `}
        `;
        elements.queueList.appendChild(div);
    });

    // Event listeners para eliminar items
    document.querySelectorAll('.queue-item-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = e.currentTarget.dataset.id;
            removeFromQueue(id);
        });
    });

    // Event listeners para editar items
    document.querySelectorAll('.queue-item-edit').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = e.currentTarget.dataset.id;
            editQueueItem(id);
        });
    });
}

async function processQueue() {
    if (state.isProcessingQueue || state.queue.length === 0) return;

    state.isProcessingQueue = true;

    for (let i = 0; i < state.queue.length; i++) {
        const item = state.queue[i];
        if (item.status !== 'pending') continue;

        item.status = 'downloading';
        updateQueueUI();

        try {
            const { downloadId } = await startDownload({
                url: item.url,
                audioOnly: item.audioOnly,
                quality: item.quality
            });

            // Esperar a que termine
            let completed = false;
            while (!completed) {
                await new Promise(r => setTimeout(r, 1000));
                const progress = await checkProgress(downloadId);

                if (progress.status === 'completed') {
                    completed = true;
                    item.status = 'completed';
                    updateQueueUI();

                    // Descargar archivo
                    const link = document.createElement('a');
                    link.href = `${API_BASE}/api/file/${downloadId}`;
                    link.download = progress.filename || 'video';
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                } else if (progress.status === 'error') {
                    item.status = 'error';
                    updateQueueUI();
                    completed = true;
                }
            }
        } catch (error) {
            item.status = 'error';
            updateQueueUI();
        }
    }

    state.isProcessingQueue = false;
}

// ═══════════════════════════════════════════════════════════
// MODAL FUNCTIONS
// ═══════════════════════════════════════════════════════════

function showPlaylistModal(videoCount) {
    elements.playlistInfo.innerHTML = `Se encontraron <strong>${videoCount}</strong> videos en esta playlist.`;
    elements.playlistModal.classList.remove('hidden');
}

function hidePlaylistModal() {
    elements.playlistModal.classList.add('hidden');
}

// ═══════════════════════════════════════════════════════════
// UI UPDATES
// ═══════════════════════════════════════════════════════════

function displayVideoInfo(info) {
    state.videoInfo = info;
    state.duration = info.duration;
    state.endTime = info.duration;
    state.startTime = 0;

    // Actualizar preview
    elements.thumbnail.src = info.thumbnail;
    elements.videoTitle.textContent = info.title;
    elements.videoUploader.textContent = info.uploader || 'Desconocido';
    elements.durationBadge.textContent = formatDuration(info.duration);

    // Actualizar badge de plataforma
    if (elements.platformBadge) {
        elements.platformBadge.textContent = info.platformIcon || '🎬';
        elements.platformBadge.title = info.platformName || 'Video';
        elements.platformBadge.className = 'platform-badge ' + (info.platform || '');
    }

    // Generar botones de calidad (solo si la plataforma lo soporta)
    if (info.supportsQuality !== false && info.videoQualities && info.videoQualities.length > 0) {
        renderQualityButtons(info.videoQualities);
        elements.qualityCard.style.display = 'block';
    } else {
        // Plataformas sin selección de calidad (TikTok, Instagram)
        elements.qualityCard.style.display = 'none';
        state.selectedQuality = null;
    }

    // Actualizar timeline
    updateTimelineDisplay();
    generateTimelineTicks();

    // Mostrar preview
    elements.videoPreview.classList.remove('hidden');
}

function renderQualityButtons(qualities) {
    elements.qualitySelector.innerHTML = '';

    const defaultQualities = qualities.length > 0 ? qualities : [1080, 720, 480, 360];

    defaultQualities.forEach((quality, index) => {
        const btn = document.createElement('button');
        btn.className = 'quality-btn' + (index === 0 ? ' active' : '');
        btn.textContent = `${quality}p`;
        btn.dataset.quality = quality;
        btn.addEventListener('click', () => selectQuality(quality));
        elements.qualitySelector.appendChild(btn);
    });

    state.selectedQuality = defaultQualities[0];
}

function selectQuality(quality) {
    state.selectedQuality = quality;
    document.querySelectorAll('.quality-btn').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.quality) === quality);
    });
}

function updateTimelineDisplay() {
    elements.startTimeDisplay.textContent = formatDuration(state.startTime);
    elements.endTimeDisplay.textContent = formatDuration(state.endTime);

    const startPercent = (state.startTime / state.duration) * 100;
    const endPercent = (state.endTime / state.duration) * 100;

    elements.handleStart.style.left = `${startPercent}%`;
    elements.handleEnd.style.left = `${endPercent}%`;
    elements.timelineRange.style.left = `${startPercent}%`;
    elements.timelineRange.style.right = `${100 - endPercent}%`;
}

function generateTimelineTicks() {
    elements.timelineTicks.innerHTML = '';
    const tickCount = 5;
    const interval = state.duration / (tickCount - 1);

    for (let i = 0; i < tickCount; i++) {
        const tick = document.createElement('span');
        tick.className = 'timeline-tick';
        tick.textContent = formatDuration(interval * i);
        elements.timelineTicks.appendChild(tick);
    }
}

function updateProgressUI(progress, status) {
    elements.progressFill.style.width = `${progress}%`;
    elements.progressText.textContent = `${Math.round(progress)}%`;

    if (status === 'downloading') {
        elements.statusText.textContent = 'Descargando...';
    } else if (status === 'completed') {
        elements.statusText.textContent = '¡Descarga completada!';
    } else if (status === 'error') {
        elements.statusText.textContent = 'Error en la descarga';
    } else {
        elements.statusText.textContent = 'Preparando...';
    }
}

function setDownloadingState(downloading) {
    state.isDownloading = downloading;
    elements.downloadBtn.disabled = downloading;

    const btnContent = elements.downloadBtn.querySelector('.btn-content');
    const btnLoader = elements.downloadBtn.querySelector('.btn-loader');

    btnContent.classList.toggle('hidden', downloading);
    btnLoader.classList.toggle('hidden', !downloading);
    elements.progressContainer.classList.toggle('hidden', !downloading);
}

// ═══════════════════════════════════════════════════════════
// EVENT HANDLERS
// ═══════════════════════════════════════════════════════════

// Fetch video info
elements.fetchBtn.addEventListener('click', async () => {
    const url = elements.urlInput.value.trim();

    if (!url) {
        showError('Por favor, ingresa una URL');
        return;
    }

    // Verificar si es una playlist de YouTube (no mix, solo playlist real)
    const isPlaylist = url.includes('list=') && url.includes('playlist');

    if (isPlaylist) {
        // Guardar URL y detectar videos en la playlist
        state.currentUrl = url;
        clearError();
        setLoading(elements.fetchBtn, true);

        try {
            const detection = await detectPlaylist(url);
            if (detection.isPlaylist && detection.videoCount > 0) {
                state.pendingPlaylistVideos = detection.videos;
                showPlaylistModal(detection.videoCount);
            } else {
                // No es playlist o está vacía, proceder normal
                const info = await fetchVideoInfo(url);
                displayVideoInfo(info);
            }
        } catch (error) {
            // Si falla la detección, proceder con video único
            try {
                const info = await fetchVideoInfo(url);
                displayVideoInfo(info);
            } catch (e) {
                showError(e.message);
            }
        } finally {
            setLoading(elements.fetchBtn, false);
        }
        return;
    }

    // Flujo normal para video único
    clearError();
    setLoading(elements.fetchBtn, true);
    elements.videoPreview.classList.add('hidden');

    try {
        state.currentUrl = url;
        const info = await fetchVideoInfo(url);
        displayVideoInfo(info);
    } catch (error) {
        showError(error.message);
    } finally {
        setLoading(elements.fetchBtn, false);
    }
});

// Enter key on input
elements.urlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        elements.fetchBtn.click();
    }
});

// Toggle video/audio
elements.videoToggle.addEventListener('click', () => {
    state.audioOnly = false;
    elements.videoToggle.classList.add('active');
    elements.audioToggle.classList.remove('active');
    elements.qualityCard.style.display = 'block';
});

elements.audioToggle.addEventListener('click', () => {
    state.audioOnly = true;
    elements.audioToggle.classList.add('active');
    elements.videoToggle.classList.remove('active');
    elements.qualityCard.style.display = 'none';
});

// Trim toggle
elements.trimEnabled.addEventListener('change', (e) => {
    state.trimEnabled = e.target.checked;
    elements.timelineContainer.classList.toggle('disabled', !e.target.checked);
});

// Timeline handles
let activeHandle = null;

function handleMouseDown(e) {
    e.preventDefault();
    activeHandle = e.target.dataset.handle;
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
}

function handleMouseMove(e) {
    if (!activeHandle) return;

    const rect = elements.timelineTrack.getBoundingClientRect();
    let percent = ((e.clientX - rect.left) / rect.width) * 100;
    percent = Math.max(0, Math.min(100, percent));

    const time = (percent / 100) * state.duration;

    if (activeHandle === 'start') {
        state.startTime = Math.min(time, state.endTime - 1);
    } else {
        state.endTime = Math.max(time, state.startTime + 1);
    }

    updateTimelineDisplay();
}

function handleMouseUp() {
    activeHandle = null;
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
}

elements.handleStart.addEventListener('mousedown', handleMouseDown);
elements.handleEnd.addEventListener('mousedown', handleMouseDown);

// Touch support for mobile
elements.handleStart.addEventListener('touchstart', (e) => {
    e.preventDefault();
    activeHandle = 'start';
});

elements.handleEnd.addEventListener('touchstart', (e) => {
    e.preventDefault();
    activeHandle = 'end';
});

document.addEventListener('touchmove', (e) => {
    if (!activeHandle) return;
    const touch = e.touches[0];
    handleMouseMove({ clientX: touch.clientX });
});

document.addEventListener('touchend', () => {
    activeHandle = null;
});

// Download button - El handler se agrega más abajo según el contexto (Electron o navegador)
// Ver la sección "DESCARGA CON SSE" para la lógica de descarga

// Función para mostrar toast de feedback (persistent=true hace que no desaparezca)
function showDownloadToast(title, subtitle, persistent = false) {
    // Remover toast anterior si existe
    const existing = document.querySelector('.download-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'download-toast';
    toast.innerHTML = `
        <div class="toast-icon">
            <svg viewBox="0 0 24 24" fill="none">
                <path d="M21 15V19C21 20.1046 20.1046 21 19 21H5C3.89543 21 3 20.1046 3 19V15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                <path d="M12 3V15M12 15L7 10M12 15L17 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        </div>
        <div class="toast-content">
            <div class="toast-title">${title}</div>
            <div class="toast-subtitle">${subtitle}</div>
        </div>
    `;
    document.body.appendChild(toast);

    // Animar entrada
    requestAnimationFrame(() => {
        toast.classList.add('show');
    });

    // Si no es persistente, remover después de 5 segundos
    if (!persistent) {
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 5000);
    }

    return toast;
}

// Ocultar toast persistente
function hideDownloadToast() {
    const toast = document.querySelector('.download-toast');
    if (toast) {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }
}

// ═══════════════════════════════════════════════════════════
// FILE SYSTEM ACCESS API (Selector de carpeta)
// ═══════════════════════════════════════════════════════════

// Verificar si el navegador soporta la API
const supportsFileSystemAccess = 'showDirectoryPicker' in window;

// Handler para seleccionar carpeta
if (elements.folderPickerBtn) {
    elements.folderPickerBtn.addEventListener('click', async () => {
        if (!supportsFileSystemAccess) {
            alert('Tu navegador no soporta esta función. Usa Chrome o Edge.');
            return;
        }

        try {
            const handle = await window.showDirectoryPicker({
                mode: 'readwrite'
            });

            state.downloadFolderHandle = handle;
            state.downloadFolderName = handle.name;

            // Actualizar UI
            elements.folderPath.textContent = `📁 ${handle.name}`;
            elements.folderPickerBtn.classList.add('active');

            // Guardar nombre en localStorage (no podemos guardar el handle)
            localStorage.setItem('downloadFolderName', handle.name);

        } catch (err) {
            // Usuario canceló la selección
            console.log('Selección de carpeta cancelada');
        }
    });
}

// ═══════════════════════════════════════════════════════════

// Focus input on load
elements.urlInput.focus();

// Add paste event for better UX
elements.urlInput.addEventListener('paste', async () => {
    setTimeout(async () => {
        const url = elements.urlInput.value.trim();
        if (url) {
            state.currentUrl = url;

            // Detectar si es playlist
            try {
                const detection = await detectPlaylist(url);
                if (detection.isPlaylist && detection.videoCount > 1) {
                    state.pendingPlaylistVideos = detection.videos;
                    showPlaylistModal(detection.videoCount);
                } else {
                    elements.fetchBtn.click();
                }
            } catch (error) {
                elements.fetchBtn.click();
            }
        }
    }, 100);
});

// ═══════════════════════════════════════════════════════════
// QUEUE EVENT HANDLERS
// ═══════════════════════════════════════════════════════════

// Agregar a cola (o guardar cambios si estamos editando)
elements.addToQueueBtn.addEventListener('click', () => {
    if (!state.videoInfo) return;

    const url = elements.urlInput.value.trim();

    // Si estamos editando un item existente
    if (state.editingQueueItemId) {
        const itemIndex = state.queue.findIndex(i => i.id === state.editingQueueItemId);
        if (itemIndex !== -1) {
            // Actualizar el item con los nuevos parámetros
            state.queue[itemIndex] = {
                ...state.queue[itemIndex],
                quality: state.audioOnly ? null : state.selectedQuality,
                audioOnly: state.audioOnly,
                trimEnabled: state.trimEnabled,
                startTime: state.trimEnabled ? state.startTime : 0,
                endTime: state.trimEnabled ? state.endTime : state.queue[itemIndex].duration
            };
            updateQueueUI();
            showDownloadToast('✓ Cambios guardados', state.queue[itemIndex].title);
        }

        // Limpiar estado de edición
        state.editingQueueItemId = null;
        elements.addToQueueBtn.innerHTML = '<span>+ Agregar a cola</span>';
        elements.addToQueueBtn.classList.remove('editing');
    } else {
        // Agregar nuevo item
        addToQueue(state.videoInfo, url);
    }

    // Limpiar para agregar otro
    elements.urlInput.value = '';
    elements.videoPreview.classList.add('hidden');
    state.videoInfo = null;
    elements.urlInput.focus();
});

// Limpiar cola
elements.clearQueueBtn.addEventListener('click', () => {
    clearQueue();
});

// Descargar todo
elements.downloadAllBtn.addEventListener('click', async () => {
    const pendingVideos = state.queue.filter(v => v.status === 'pending');
    if (pendingVideos.length === 0) return;

    // Si son 3 o más, descargar como ZIP
    if (pendingVideos.length >= 3) {
        // Toast PERSISTENTE - no desaparece hasta que termine
        showDownloadToast('Preparando ZIP...', `Descargando ${pendingVideos.length} videos y empaquetando`, true);

        try {
            const response = await fetch(`${API_BASE}/api/download-batch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    videos: pendingVideos.map(v => ({
                        url: v.url,
                        quality: v.quality,
                        audioOnly: v.audioOnly
                    }))
                })
            });

            if (!response.ok) throw new Error('Error en batch download');

            // Descargar el ZIP
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'DownloadFlow_Videos.zip';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);

            // Marcar todos como completados
            pendingVideos.forEach(v => v.status = 'completed');
            updateQueueUI();

            // Ocultar toast persistente
            hideDownloadToast();

        } catch (error) {
            console.error('Error en batch download:', error);
            hideDownloadToast();
            showDownloadToast('Error', 'No se pudo crear el ZIP');
        }
    } else {
        // Si son pocos, descargar individualmente
        processQueue();
    }
});

// ═══════════════════════════════════════════════════════════
// PLAYLIST MODAL EVENT HANDLERS
// ═══════════════════════════════════════════════════════════

// Cerrar modal
elements.closePlaylistModal.addEventListener('click', hidePlaylistModal);
elements.playlistModal.querySelector('.modal-backdrop').addEventListener('click', hidePlaylistModal);

// Solo este video
elements.singleVideoBtn.addEventListener('click', async () => {
    hidePlaylistModal();
    setLoading(elements.fetchBtn, true);

    try {
        const info = await fetchVideoInfo(state.currentUrl);
        displayVideoInfo(info);
    } catch (error) {
        showError(error.message);
    } finally {
        setLoading(elements.fetchBtn, false);
    }
});

// Agregar playlist a cola
elements.addPlaylistBtn.addEventListener('click', async () => {
    hidePlaylistModal();
    setLoading(elements.fetchBtn, true);

    // Agregar cada video de la playlist a la cola
    for (const video of state.pendingPlaylistVideos) {
        try {
            const videoUrl = video.url || `https://www.youtube.com/watch?v=${video.id}`;
            const info = await fetchVideoInfo(videoUrl);

            const queueItem = {
                id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
                url: videoUrl,
                title: info.title,
                thumbnail: info.thumbnail,
                duration: info.duration,
                quality: state.selectedQuality || 720,
                audioOnly: false,
                status: 'pending'
            };

            state.queue.push(queueItem);
            updateQueueUI();
            showQueueSection();
        } catch (error) {
            console.error('Error obteniendo info de video:', video.id, error);
        }
    }

    setLoading(elements.fetchBtn, false);
    state.pendingPlaylistVideos = [];
});

// ═══════════════════════════════════════════════════════════
// ELECTRON INTEGRATION & FOLDER PICKER
// ═══════════════════════════════════════════════════════════

const isElectron = typeof window.electronAPI !== 'undefined';

// Inicializar carpeta por defecto si estamos en Electron
if (isElectron) {
    // Mostrar botón de selección de carpeta
    if (elements.folderPickerBtn) {
        elements.folderPickerBtn.style.display = 'flex';
    }

    // Obtener carpeta de descargas por defecto
    window.electronAPI.getDefaultDownloadPath().then(path => {
        state.downloadPath = path;
        updateFolderDisplay();
    });

    // Handler para seleccionar carpeta
    if (elements.folderPickerBtn) {
        elements.folderPickerBtn.addEventListener('click', async () => {
            const result = await window.electronAPI.selectFolder();
            if (result.success) {
                state.downloadPath = result.path;
                state.downloadPathName = result.name;
                updateFolderDisplay();
            }
        });
    }

    // ═══════════════════════════════════════════════════════════
    // CLIPBOARD MONITORING - Recibir URLs detectadas
    // ═══════════════════════════════════════════════════════════

    window.electronAPI.onClipboardUrl(async (url) => {
        console.log('URL recibida del portapapeles:', url);

        // Poner la URL en el input
        elements.urlInput.value = url;
        state.currentUrl = url;

        // Analizar automáticamente
        clearError();
        setLoading(elements.fetchBtn, true);
        elements.videoPreview.classList.add('hidden');

        try {
            const info = await fetchVideoInfo(url);
            displayVideoInfo(info);

            // Mostrar toast de éxito
            showDownloadToast('🎬 Video detectado', info.title.substring(0, 50) + (info.title.length > 50 ? '...' : ''));
        } catch (error) {
            showError(error.message);
        } finally {
            setLoading(elements.fetchBtn, false);
        }
    });
}

function updateFolderDisplay() {
    if (elements.folderPath && state.downloadPath) {
        const name = state.downloadPathName || state.downloadPath.split(/[\\/]/).pop();
        elements.folderPath.textContent = `📁 ${name}`;
        elements.folderPickerBtn?.classList.add('active');
    }
}

// ═══════════════════════════════════════════════════════════
// DESCARGA CON SSE (Server-Sent Events)
// ═══════════════════════════════════════════════════════════

async function downloadWithProgress() {
    if (!state.videoInfo) return;

    const url = elements.urlInput.value.trim();

    // Construir URL de descarga
    const params = new URLSearchParams({
        url: url,
        audioOnly: state.audioOnly.toString()
    });

    if (!state.audioOnly && state.selectedQuality) {
        params.set('quality', state.selectedQuality.toString());
    }

    if (state.trimEnabled) {
        params.set('startTime', Math.floor(state.startTime).toString());
        params.set('endTime', Math.floor(state.endTime).toString());
    }

    // Agregar carpeta de destino si estamos en Electron
    if (isElectron && state.downloadPath) {
        params.set('outputDir', state.downloadPath);
    }

    const downloadUrl = `${API_BASE}/api/download-stream?${params.toString()}`;

    // Mostrar progreso
    setDownloadingState(true);
    elements.progressFill.style.width = '0%';
    elements.progressText.textContent = '0%';
    elements.statusText.textContent = 'Iniciando descarga...';
    elements.progressContainer.classList.remove('hidden');

    try {
        const eventSource = new EventSource(downloadUrl);

        eventSource.addEventListener('start', (e) => {
            const data = JSON.parse(e.data);
            elements.statusText.textContent = data.message || 'Iniciando descarga...';
        });

        eventSource.addEventListener('progress', (e) => {
            const data = JSON.parse(e.data);
            const percent = Math.round(data.percent);
            elements.progressFill.style.width = `${percent}%`;
            elements.progressText.textContent = `${percent}%`;
            elements.statusText.textContent = `Descargando... ${percent}%`;
        });

        eventSource.addEventListener('complete', (e) => {
            const data = JSON.parse(e.data);
            eventSource.close();
            setDownloadingState(false);

            // Guardar último archivo descargado
            state.lastDownload = {
                filePath: data.filePath,
                fileName: data.fileName,
                fileSize: data.fileSize,
                outputDir: data.outputDir,
                timestamp: Date.now()
            };

            // Agregar al historial
            addToHistory(state.lastDownload);

            // Mostrar modal de éxito
            showSuccessModal(data);
        });

        eventSource.addEventListener('error', (e) => {
            try {
                const data = JSON.parse(e.data);
                eventSource.close();
                setDownloadingState(false);
                showErrorModal(data.message || 'Error desconocido');
            } catch {
                eventSource.close();
                setDownloadingState(false);
                showErrorModal('Error de conexión con el servidor');
            }
        });

        eventSource.onerror = () => {
            eventSource.close();
            setDownloadingState(false);
            // Solo mostrar error si no fue un cierre normal
            if (elements.progressFill.style.width !== '100%') {
                showErrorModal('La conexión se perdió durante la descarga');
            }
        };

    } catch (error) {
        setDownloadingState(false);
        showErrorModal(error.message || 'Error al iniciar la descarga');
    }
}

// ═══════════════════════════════════════════════════════════
// AGREGAR HANDLER DE DESCARGA SEGÚN EL CONTEXTO
// ═══════════════════════════════════════════════════════════

// Función de descarga directa para navegador (sin Electron)
function downloadDirect() {
    if (!state.videoInfo) return;

    const url = elements.urlInput.value.trim();

    // Construir URL de descarga directa
    const params = new URLSearchParams({
        url: url,
        audioOnly: state.audioOnly.toString()
    });

    if (!state.audioOnly && state.selectedQuality) {
        params.set('quality', state.selectedQuality.toString());
    }

    if (state.trimEnabled) {
        params.set('startTime', Math.floor(state.startTime).toString());
        params.set('endTime', Math.floor(state.endTime).toString());
    }

    const downloadUrl = `${API_BASE}/api/download-direct?${params.toString()}`;

    // Mostrar feedback inmediato
    showDownloadToast('Preparando descarga...', 'Aparecerá en tu gestor de descargas (Ctrl+J)', true);

    // Iniciar descarga tradicional del navegador
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Agregar el handler correcto según el contexto
if (isElectron) {
    // En Electron: usar SSE con progreso y carpeta seleccionada
    elements.downloadBtn.addEventListener('click', downloadWithProgress);
} else {
    // En navegador web: usar descarga directa del navegador
    elements.downloadBtn.addEventListener('click', downloadDirect);
}

// ═══════════════════════════════════════════════════════════
// MODALES DE ÉXITO Y ERROR
// ═══════════════════════════════════════════════════════════

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function showSuccessModal(data) {
    if (!elements.successModal) return;

    elements.successFileName.textContent = data.fileName;
    elements.successFileSize.textContent = formatFileSize(data.fileSize);
    elements.successModal.classList.remove('hidden');

    // Ocultar toast si existe
    hideDownloadToast();
}

function hideSuccessModal() {
    if (elements.successModal) {
        elements.successModal.classList.add('hidden');
    }
}

function showErrorModal(message, details = '') {
    if (!elements.errorModal) return;

    elements.errorModalMessage.textContent = message;
    elements.errorDetails.textContent = details || message;
    elements.errorModal.classList.remove('hidden');
}

function hideErrorModal() {
    if (elements.errorModal) {
        elements.errorModal.classList.add('hidden');
    }
}

// Event listeners para modales
if (elements.closeSuccessModal) {
    elements.closeSuccessModal.addEventListener('click', hideSuccessModal);
}
if (elements.successModal) {
    elements.successModal.querySelector('.modal-backdrop')?.addEventListener('click', hideSuccessModal);
}

if (elements.closeErrorModal) {
    elements.closeErrorModal.addEventListener('click', hideErrorModal);
}
if (elements.errorModal) {
    elements.errorModal.querySelector('.modal-backdrop')?.addEventListener('click', hideErrorModal);
}

// Botones de abrir archivo/carpeta
if (elements.openFileBtn && isElectron) {
    elements.openFileBtn.addEventListener('click', () => {
        if (state.lastDownload?.filePath) {
            window.electronAPI.openPath(state.lastDownload.filePath);
            hideSuccessModal();
        }
    });
}

if (elements.openFolderBtn && isElectron) {
    elements.openFolderBtn.addEventListener('click', () => {
        if (state.lastDownload?.filePath) {
            window.electronAPI.showItemInFolder(state.lastDownload.filePath);
            hideSuccessModal();
        }
    });
}

// Reintentar descarga
if (elements.retryDownloadBtn) {
    elements.retryDownloadBtn.addEventListener('click', () => {
        hideErrorModal();
        if (isElectron) {
            downloadWithProgress();
        } else {
            elements.downloadBtn.click();
        }
    });
}

// ═══════════════════════════════════════════════════════════
// HISTORIAL DE DESCARGAS
// ═══════════════════════════════════════════════════════════

function addToHistory(download) {
    // Limitar historial a 50 items
    if (state.downloadHistory.length >= 50) {
        state.downloadHistory.pop();
    }

    state.downloadHistory.unshift({
        fileName: download.fileName,
        filePath: download.filePath,
        fileSize: download.fileSize,
        timestamp: download.timestamp
    });

    saveHistory();
    updateHistoryUI();
}

function saveHistory() {
    localStorage.setItem('downloadHistory', JSON.stringify(state.downloadHistory));
}

function clearHistory() {
    state.downloadHistory = [];
    saveHistory();
    updateHistoryUI();
}

function updateHistoryUI() {
    if (!elements.historySection || !elements.historyList) return;

    if (state.downloadHistory.length === 0) {
        elements.historySection.classList.add('hidden');
        return;
    }

    elements.historySection.classList.remove('hidden');
    elements.clearHistoryBtn?.classList.remove('hidden');

    elements.historyList.innerHTML = state.downloadHistory.map((item, index) => `
        <div class="history-item" data-index="${index}">
            <div class="history-item-icon">
                <svg viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
                    <path d="M8 12L11 15L16 9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            </div>
            <div class="history-item-info">
                <div class="history-item-name" title="${item.fileName}">${item.fileName}</div>
                <div class="history-item-meta">${formatFileSize(item.fileSize)} • ${formatTimeAgo(item.timestamp)}</div>
            </div>
            <div class="history-item-actions">
                ${isElectron ? `
                    <button class="history-item-btn" data-action="open" data-path="${item.filePath}" title="Abrir archivo">
                        <svg viewBox="0 0 24 24" fill="none">
                            <path d="M14 2H6C5.44772 2 5 2.44772 5 3V21C5 21.5523 5.44772 22 6 22H18C18.5523 22 19 21.5523 19 21V7L14 2Z" stroke="currentColor" stroke-width="2"/>
                        </svg>
                    </button>
                    <button class="history-item-btn" data-action="folder" data-path="${item.filePath}" title="Abrir carpeta">
                        <svg viewBox="0 0 24 24" fill="none">
                            <path d="M22 19C22 20.1046 21.1046 21 20 21H4C2.89543 21 2 20.1046 2 19V5C2 3.89543 2.89543 3 4 3H9L11 6H20C21.1046 6 22 6.89543 22 8V19Z" stroke="currentColor" stroke-width="2"/>
                        </svg>
                    </button>
                ` : ''}
            </div>
        </div>
    `).join('');

    // Event listeners para botones del historial
    elements.historyList.querySelectorAll('.history-item-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const action = btn.dataset.action;
            const path = btn.dataset.path;

            if (action === 'open' && isElectron) {
                window.electronAPI.openPath(path);
            } else if (action === 'folder' && isElectron) {
                window.electronAPI.showItemInFolder(path);
            }
        });
    });
}

function formatTimeAgo(timestamp) {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Ahora';
    if (minutes < 60) return `Hace ${minutes}m`;
    if (hours < 24) return `Hace ${hours}h`;
    return `Hace ${days}d`;
}

// Event listeners para historial
if (elements.toggleHistoryBtn) {
    elements.toggleHistoryBtn.addEventListener('click', () => {
        elements.historySection.classList.toggle('collapsed');
    });
}

if (elements.clearHistoryBtn) {
    elements.clearHistoryBtn.addEventListener('click', clearHistory);
}

// Inicializar UI del historial
updateHistoryUI();
