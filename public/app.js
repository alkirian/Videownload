// ═══════════════════════════════════════════════════════════
// Video Downloader - Frontend Logic
// ═══════════════════════════════════════════════════════════

// Detectar base URL del API - funciona tanto servido por Express como abierto directamente
const API_BASE = (function () {
    // Si estamos siendo servidos por localhost (Express), usar origen vacío (relativo)
    if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
        return '';
    }
    // Si estamos en file:// (Electron o directo), usar localhost:3000 por defecto
    return 'http://localhost:3000';
})();

console.log('API_BASE configurado a:', API_BASE || '(relativo al origen)');

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
    lastDownload: null,
    // Selección de items en la cola
    selectedQueueItems: new Set()
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
    addToQueueBtn: document.getElementById('addToQueueBtn'), // Sidebar button
    progressContainer: document.getElementById('progressContainer'),
    progressFill: document.getElementById('progressFill'),
    progressText: document.getElementById('progressText'),
    statusText: document.getElementById('statusText'),
    // Cola
    queueSection: document.querySelector('.queue-panel-primary'), // Updated selector
    queueCount: document.getElementById('queueCount'),
    queueList: document.getElementById('queueList'),
    clearQueueBtn: document.getElementById('clearQueueBtn'),
    moveFolderBtn: document.getElementById('moveFolderBtn'),
    downloadAllBtn: document.getElementById('downloadAllBtn'),
    // Modal Playlist
    playlistModal: document.getElementById('playlistModal'),
    playlistInfo: document.getElementById('playlistInfo'),
    singleVideoBtn: document.getElementById('singleVideoBtn'),
    addPlaylistBtn: document.getElementById('addPlaylistBtn'),
    closePlaylistModal: document.getElementById('closePlaylistModal'),
    // Folder picker
    folderPickerSection: document.getElementById('folderPickerSection'),
    folderPickerBtn: document.getElementById('folderPickerBtn'),
    folderStatusValue: document.getElementById('folderStatusValue'),
    folderBtnText: document.getElementById('folderBtnText'),
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
    openHistoryBtn: document.getElementById('openHistoryBtn'),
    historyModal: document.getElementById('historyModal'),
    historyList: document.getElementById('historyList'),
    historyEmptyState: document.getElementById('historyEmptyState'),
    clearHistoryBtn: document.getElementById('clearHistoryBtn'),
    closeHistoryModal: document.getElementById('closeHistoryModal'),
    // Empty State y Sidebar
    emptyState: document.getElementById('emptyState'),
    noSelectionState: document.getElementById('noSelectionState'), // New state
    // Removed Advanced Options references as they are now always visible in sidebar
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
        const span = button.querySelector('span');
        if (span) {
            span.textContent = loading ? 'Analizando...' : 'Analizar';
        }
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
    // Debug: Log what we receive
    console.log('addToQueue called with:', {
        title: videoInfo?.title,
        thumbnail: videoInfo?.thumbnail,
        url: url
    });

    // Verificar si el link ya está en la cola
    const isDuplicate = state.queue.some(item => item.url === url);
    if (isDuplicate) {
        showDownloadToast('⚠️ Video duplicado', 'Este video ya está en la cola');
        return false;
    }

    const queueItem = {
        id: Date.now().toString(),
        url: url,
        title: videoInfo?.title || 'Video sin título',
        thumbnail: videoInfo?.thumbnail || null,
        duration: videoInfo?.duration || 0,
        platformIcon: videoInfo?.platformIcon || '🎬',
        quality: state.audioOnly ? null : (state.selectedQuality || 1080),
        audioOnly: state.audioOnly || false,
        // Guardar recorte
        trimEnabled: state.trimEnabled || false,
        startTime: state.trimEnabled ? state.startTime : 0,
        endTime: state.trimEnabled ? state.endTime : (videoInfo?.duration || 0),
        status: 'pending'
    };

    console.log('Queue item created:', queueItem);

    state.queue.push(queueItem);
    updateQueueUI();
    showQueueSection();
    return true;
}

function removeFromQueue(id) {
    state.queue = state.queue.filter(item => item.id !== id);
    state.selectedQueueItems.delete(id);
    updateQueueUI();
    if (state.queue.length === 0) {
        hideQueueSection();
    }
}

// Descargar un item individual de la cola
async function downloadSingleItem(id) {
    const item = state.queue.find(i => i.id === id);
    if (!item || item.status !== 'pending') return;

    // Marcar solo este item para descarga
    state.selectedQueueItems.clear();
    state.selectedQueueItems.add(id);
    updateQueueUI();

    // Iniciar descarga de este item
    await downloadQueue();
}

function toggleQueueItemSelection(id, selected) {
    if (selected) {
        state.selectedQueueItems.add(id);
    } else {
        state.selectedQueueItems.delete(id);
    }
    // Solo actualizar UI visualmente para no redibujar todo
    updateQueueUI();
}

async function moveSelectedItemsToFolder() {
    if (state.selectedQueueItems.size === 0) return;

    if (!isElectron) {
        showDownloadToast('⚠️ Función limitada', 'Solo disponible en la versión de escritorio');
        return;
    }

    constresult = await window.electronAPI.selectFolder();
    if (result.success) {
        // Actualizar items seleccionados
        state.queue.forEach(item => {
            if (state.selectedQueueItems.has(item.id)) {
                item.downloadPath = result.path;
                item.downloadPathName = result.name;
            }
        });

        // Limpiar selección y actualizar UI
        state.selectedQueueItems.clear();
        updateQueueUI();

        showDownloadToast('📂 Carpeta actualizada', `Videos movidos a ${result.name}`);
    }
}

// Guardar cambios del item actualmente en edición
function saveCurrentEdit() {
    if (!state.editingQueueItemId) return;

    const item = state.queue.find(i => i.id === state.editingQueueItemId);
    if (!item) return;

    // Actualizar el item con los valores actuales del estado
    item.audioOnly = state.audioOnly;
    item.quality = state.selectedQuality;
    item.trimEnabled = state.trimEnabled;
    item.startTime = state.startTime;
    item.endTime = state.endTime;

    // Actualizar UI de la cola
    updateQueueUI();
}

// Editar item de la cola - carga el video para modificar parámetros
function editQueueItem(id) {
    // Primero guardar cambios del item que estábamos editando
    if (state.editingQueueItemId && state.editingQueueItemId !== id) {
        saveCurrentEdit();
    }

    const item = state.queue.find(i => i.id === id);
    if (!item) return;

    // Guardar referencia al item que estamos editando
    state.editingQueueItemId = id;

    // Cargar URL en el input (opcional, para referencia)
    elements.urlInput.value = item.url;

    // Simular la info del video para el sidebar
    state.videoInfo = {
        title: item.title,
        thumbnail: item.thumbnail,
        duration: item.duration,
        platformIcon: item.platformIcon // Ensure we keep platform info
    };
    state.currentUrl = item.url; // Update current context
    state.duration = item.duration;

    // Restaurar parámetros del item
    state.audioOnly = item.audioOnly;
    state.selectedQuality = item.quality;
    state.trimEnabled = item.trimEnabled;
    state.startTime = item.startTime;
    state.endTime = item.endTime;

    // Actualizar UI de audio (checkbox)
    if (elements.audioToggle) {
        elements.audioToggle.checked = item.audioOnly;
        // Trigger change to update quality card visibility
        elements.audioToggle.dispatchEvent(new Event('change'));
    }

    // Renderizar calidades disponibles si es necesario
    if (!item.audioOnly && elements.qualitySelector) {
        // Si no hay botones generados, generar defaults o usar los guardados
        // Idealmente deberíamos tener las calidades originales guardadas en el item, 
        // pero por ahora usaremos defaults si no hay info
        if (state.videoInfo && state.videoInfo.videoQualities) {
            renderQualityButtons(state.videoInfo.videoQualities);
        } else if (elements.qualitySelector.children.length === 0) {
            renderQualityButtons([1080, 720, 480, 360]);
        }

        // Marcar calidad activa
        if (item.quality) {
            selectQuality(item.quality);
        }
    }

    // Actualizar UI de recorte
    if (elements.trimEnabled) {
        elements.trimEnabled.checked = item.trimEnabled;
        elements.trimEnabled.dispatchEvent(new Event('change'));
    }
    updateHandlePositions();

    // Mostrar preview del video y ocultar estado "sin selección"
    if (elements.noSelectionState) elements.noSelectionState.classList.add('hidden');
    if (elements.videoPreview) elements.videoPreview.classList.remove('hidden');

    if (elements.thumbnail) elements.thumbnail.src = item.thumbnail || 'assets/placeholder.svg';
    if (elements.videoTitle) elements.videoTitle.textContent = item.title || 'Video sin título';
    if (elements.durationBadge) elements.durationBadge.textContent = formatDuration(item.duration);

    // Marcar visualmente el item que estamos editando
    document.querySelectorAll('.queue-item').forEach(el => {
        el.classList.toggle('editing', el.dataset.id === id);
    });

    // En móviles, hacer scroll al sidebar (arriba)
    if (window.innerWidth < 900) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

// Función para actualizar posiciones de handles
function updateHandlePositions() {
    if (!state.duration) return;
    const startPercent = (state.startTime / state.duration) * 100;
    const endPercent = (state.endTime / state.duration) * 100;

    // Usar elementos cacheados o buscarlos si es necesario
    // Nota: handleStart y handleEnd ya están en elements

    if (elements.handleStart) elements.handleStart.style.left = startPercent + '%';
    if (elements.handleEnd) elements.handleEnd.style.left = endPercent + '%';
    if (elements.timelineRange) {
        elements.timelineRange.style.left = startPercent + '%';
        elements.timelineRange.style.right = (100 - endPercent) + '%';
    }

    // Actualizar etiquetas de tiempo
    if (elements.startTimeDisplay) elements.startTimeDisplay.textContent = formatDuration(state.startTime);
    if (elements.endTimeDisplay) elements.endTimeDisplay.textContent = formatDuration(state.endTime);
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

    // Actualizar visibilidad del botón de mover a carpeta
    if (elements.moveFolderBtn) {
        if (state.selectedQueueItems.size > 0) {
            elements.moveFolderBtn.classList.remove('hidden');
            const count = state.selectedQueueItems.size;
            elements.moveFolderBtn.title = `Mover ${count} video${count > 1 ? 's' : ''} a carpeta`;
        } else {
            elements.moveFolderBtn.classList.add('hidden');
        }
    }

    state.queue.forEach(item => {
        const div = document.createElement('div');
        div.className = `queue-item ${item.status}`;
        div.dataset.id = item.id;

        // Si el item está seleccionado
        if (state.selectedQueueItems.has(item.id)) {
            div.classList.add('selected');
        }

        // Badges de configuración
        const qualityBadge = item.audioOnly
            ? '<span class="queue-badge audio">MP3</span>'
            : `<span class="queue-badge quality">${item.quality || 1080}p</span>`;

        const trimBadge = item.trimEnabled
            ? `<span class="queue-badge trim">✂️ ${formatDuration(item.startTime)}-${formatDuration(item.endTime)}</span>`
            : '';

        // Badge de carpeta personalizada
        const folderBadge = item.downloadPathName
            ? `<span class="queue-badge folder" title="${item.downloadPath}">📂 ${item.downloadPathName}</span>`
            : '';

        // Placeholder para thumbnails rotos o vacíos
        const placeholderThumb = `data:image/svg+xml,${encodeURIComponent(`
            <svg xmlns="http://www.w3.org/2000/svg" width="80" height="60" viewBox="0 0 80 60">
                <defs>
                    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" style="stop-color:#1a1a2e"/>
                        <stop offset="100%" style="stop-color:#16213e"/>
                    </linearGradient>
                </defs>
                <rect width="80" height="60" fill="url(#grad)"/>
                <text x="40" y="35" text-anchor="middle" dominant-baseline="middle" font-size="24">${item.platformIcon || '🎬'}</text>
            </svg>
        `)}`;

        const thumbnailSrc = item.thumbnail || placeholderThumb;

        div.innerHTML = `
            <div class="queue-item-select" onclick="event.stopPropagation()">
                <input type="checkbox" class="queue-checkbox" 
                    ${state.selectedQueueItems.has(item.id) ? 'checked' : ''} 
                    ${item.status !== 'pending' ? 'disabled' : ''}>
            </div>
            <img class="queue-item-thumb" src="${thumbnailSrc}" alt="" onerror="this.src='${placeholderThumb}'">
            <div class="queue-item-info">
                <div class="queue-item-title">${item.title || 'Video sin título'}</div>
                <div class="queue-item-badges">
                    ${qualityBadge}${trimBadge}${folderBadge}
                </div>
            </div>
            ${item.status === 'downloading' ? `
                <div class="queue-item-status downloading">
                    <div class="loader-ring" style="width:14px;height:14px;border-width:2px;"></div>
                </div>
            ` : item.status === 'completed' ? `
                <div class="queue-item-status completed">✓</div>
            ` : item.status === 'error' ? `
                <div class="queue-item-status error">✗</div>
            ` : `
                <div class="queue-item-actions">
                    <button class="queue-item-download" data-id="${item.id}" title="Descargar este video">
                        <svg viewBox="0 0 24 24" fill="none">
                            <path d="M21 15V19C21 20.1046 20.1046 21 19 21H5C3.89543 21 3 20.1046 3 19V15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                            <path d="M12 3V15M12 15L7 10M12 15L17 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
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

        // Listener para el checkbox
        const checkbox = div.querySelector('.queue-checkbox');
        if (checkbox) {
            checkbox.addEventListener('change', (e) => {
                toggleQueueItemSelection(item.id, e.target.checked);
            });
        }
    });

    // Event listeners para eliminar items
    document.querySelectorAll('.queue-item-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = e.currentTarget.dataset.id;
            removeFromQueue(id);
        });
    });

    // Event listeners para descargar items individuales
    document.querySelectorAll('.queue-item-download').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = e.currentTarget.dataset.id;
            downloadSingleItem(id);
        });
    });

    // Click en cualquier parte del item para editar (excepto si está procesando)
    document.querySelectorAll('.queue-item.pending').forEach(item => {
        item.addEventListener('click', (e) => {
            // No activar si clickeó en botón de eliminar, descarga o checkbox
            if (e.target.closest('.queue-item-remove') ||
                e.target.closest('.queue-item-download') ||
                e.target.closest('.queue-item-select')) return;
            const id = item.dataset.id;
            editQueueItem(id);
        });
        item.style.cursor = 'pointer';
    });

    // Mostrar mensaje vacío si no hay items
    if (state.queue.length === 0) {
        elements.queueList.innerHTML = `
            <div class="queue-empty">
                <p>Sin videos en cola</p>
                <span>Agrega videos para descargar</span>
            </div>
        `;
    }
}

async function processQueue() {
    if (state.isProcessingQueue || state.queue.length === 0) return;

    // Si no hay carpeta configurada en Electron, pedir que seleccione una
    if (isElectron && !state.downloadPath) {
        const result = await window.electronAPI.selectFolder();
        if (!result.success) {
            showDownloadToast('⚠️ Selecciona una carpeta', 'Debes elegir dónde guardar los videos');
            return;
        }
        state.downloadPath = result.path;
        state.downloadPathName = result.name;
        updateFolderDisplay();
    }

    state.isProcessingQueue = true;

    for (let i = 0; i < state.queue.length; i++) {
        const item = state.queue[i];
        if (item.status !== 'pending') continue;

        item.status = 'downloading';
        updateQueueUI();

        try {
            // Usar download-stream con la carpeta configurada
            const params = new URLSearchParams({
                url: item.url,
                audioOnly: (item.audioOnly || false).toString()
            });

            if (!item.audioOnly && item.quality) {
                params.set('quality', item.quality.toString());
            }

            // Agregar trim si está configurado
            if (item.trimEnabled && item.startTime !== undefined && item.endTime !== undefined) {
                params.set('startTime', Math.floor(item.startTime).toString());
                params.set('endTime', Math.floor(item.endTime).toString());
            }

            // Agregar carpeta de destino
            if (item.downloadPath) {
                params.set('outputDir', item.downloadPath);
            } else if (state.downloadPath) {
                params.set('outputDir', state.downloadPath);
            }

            const downloadUrl = `${API_BASE}/api/download-stream?${params.toString()}`;

            // Descargar con SSE
            await new Promise((resolve, reject) => {
                const eventSource = new EventSource(downloadUrl);

                eventSource.addEventListener('complete', (e) => {
                    const data = JSON.parse(e.data);
                    eventSource.close();
                    item.status = 'completed';
                    updateQueueUI();

                    // Agregar al historial
                    addToHistory({
                        filePath: data.filePath,
                        fileName: data.fileName,
                        fileSize: data.fileSize,
                        outputDir: data.outputDir,
                        timestamp: Date.now()
                    });

                    resolve();
                });

                eventSource.addEventListener('error', (e) => {
                    eventSource.close();
                    item.status = 'error';
                    updateQueueUI();
                    resolve(); // Continuar con el siguiente
                });

                eventSource.onerror = () => {
                    eventSource.close();
                    item.status = 'error';
                    updateQueueUI();
                    resolve();
                };
            });

        } catch (error) {
            item.status = 'error';
            updateQueueUI();
        }
    }

    state.isProcessingQueue = false;
    showDownloadToast('✓ Cola completada', 'Todos los videos han sido descargados');
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

    // Actualizar preview con fallback para thumbnails vacíos o que fallan al cargar
    const placeholderSvg = 'data:image/svg+xml,' + encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
            <defs>
                <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" style="stop-color:#1a1a2e"/>
                    <stop offset="100%" style="stop-color:#16213e"/>
                </linearGradient>
            </defs>
            <rect width="320" height="180" fill="url(#grad)"/>
            <text x="160" y="90" text-anchor="middle" dominant-baseline="middle" font-size="48">${info.platformIcon || '🎬'}</text>
        </svg>
    `);

    // Handler para cuando la imagen no carga (URLs expiradas de Instagram, etc.)
    elements.thumbnail.onerror = () => {
        elements.thumbnail.src = placeholderSvg;
    };

    if (info.thumbnail) {
        elements.thumbnail.src = info.thumbnail;
    } else {
        elements.thumbnail.src = placeholderSvg;
    }
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

    // Ocultar empty state y mostrar preview
    if (elements.emptyState) {
        elements.emptyState.classList.add('hidden');
    }
    // Hide "no selection" state and show video preview
    if (elements.noSelectionState) {
        elements.noSelectionState.classList.add('hidden');
    }
    if (elements.videoPreview) {
        elements.videoPreview.classList.remove('hidden');
    }

    // Actualizar resumen de opciones
    updateOptionsSummary();
}

function renderQualityButtons(qualities) {
    // Check if qualitySelector exists
    if (!elements.qualitySelector) {
        console.warn('qualitySelector element not found');
        return;
    }

    elements.qualitySelector.innerHTML = '';

    const defaultQualities = qualities.length > 0 ? qualities : [1080, 720, 480, 360];

    // Encontrar la calidad por defecto: 1080p o la más alta disponible que sea <= 1080
    let defaultQuality = defaultQualities.find(q => q === 1080);
    if (!defaultQuality) {
        // Si no hay 1080, buscar la más alta que sea <= 1080
        const qualitiesUnder1080 = defaultQualities.filter(q => q <= 1080);
        defaultQuality = qualitiesUnder1080.length > 0
            ? qualitiesUnder1080[0]  // La primera (más alta) que sea <= 1080
            : defaultQualities[defaultQualities.length - 1]; // Si todas son > 1080, la más baja
    }

    defaultQualities.forEach((quality) => {
        const btn = document.createElement('button');
        btn.className = 'quality-btn' + (quality === defaultQuality ? ' active' : '');
        btn.textContent = `${quality}p`;
        btn.dataset.quality = quality;
        btn.addEventListener('click', () => selectQuality(quality));
        elements.qualitySelector.appendChild(btn);
    });

    state.selectedQuality = defaultQuality;
}

function selectQuality(quality) {
    state.selectedQuality = quality;
    document.querySelectorAll('.quality-btn').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.quality) === quality);
    });
    saveCurrentEdit(); // Auto-guardar cambios
    updateOptionsSummary();
}

function updateTimelineDisplay() {
    // Check if all required timeline elements exist
    if (!elements.startTimeDisplay || !elements.endTimeDisplay ||
        !elements.handleStart || !elements.handleEnd || !elements.timelineRange) {
        return; // Silently return if elements don't exist yet
    }

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
    // Check if timelineTicks element exists
    if (!elements.timelineTicks) {
        console.warn('timelineTicks element not found');
        return;
    }

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

// Actualiza el resumen de opciones mostrado en el header colapsable
function updateOptionsSummary() {
    if (!elements.optionsSummary) return;

    const format = state.audioOnly ? 'Audio' : 'Video';
    const quality = state.audioOnly ? 'MP3' : (state.selectedQuality ? `${state.selectedQuality}p` : 'Auto');
    const trim = state.trimEnabled ? ` · ✂️` : '';

    elements.optionsSummary.textContent = `${format} · ${quality}${trim}`;
}

// Toggle de opciones avanzadas
if (elements.advancedOptionsToggle) {
    elements.advancedOptionsToggle.addEventListener('click', () => {
        elements.advancedOptions.classList.toggle('expanded');
    });
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

// Toggle Audio (Checkbox)
if (elements.audioToggle) {
    elements.audioToggle.addEventListener('change', (e) => {
        state.audioOnly = e.target.checked;
        if (elements.qualityCard) {
            elements.qualityCard.style.display = state.audioOnly ? 'none' : 'block';
        }
        saveCurrentEdit();
        // updateQualityOptions(); // Function might not exist, checking dependencies...
        if (typeof renderQualityButtons === 'function' && state.videoInfo) {
            // Re-render might not be needed if we just hide the card
        }
    });
}

// Botón "Actualizar Opciones" / "Agregar a Cola"
if (elements.addToQueueBtn) {
    elements.addToQueueBtn.addEventListener('click', () => {
        // 1. Si hay un item seleccionado en la cola, actualizarlo
        if (state.selectedQueueItems.size === 1) {
            const id = Array.from(state.selectedQueueItems)[0];
            const item = state.queue.find(i => i.id === id);
            if (item) {
                item.audioOnly = state.audioOnly;
                item.quality = state.selectedQuality;
                item.trimEnabled = state.trimEnabled;
                item.startTime = state.startTime;
                item.endTime = state.endTime;

                updateQueueUI();
                showDownloadToast('Opciones actualizadas', 'Se guardó la configuración');
                return;
            }
        }

        // 2. Si no, y hay un video analizado pero no agregado (el "currentUrl"), agregarlo
        if (state.videoInfo && state.currentUrl) {
            addToQueue(state.videoInfo, state.currentUrl);
            // Limpiar UI
            elements.urlInput.value = '';
            elements.videoPreview.classList.add('hidden');
            // Resetear estado
            state.videoInfo = null;
        }
    });
}

// Trim toggle
elements.trimEnabled.addEventListener('change', (e) => {
    state.trimEnabled = e.target.checked;
    elements.timelineContainer.classList.toggle('disabled', !e.target.checked);

    // Mostrar/ocultar advertencia de tiempo extra
    const trimWarning = document.getElementById('trimWarning');
    if (trimWarning) {
        trimWarning.classList.toggle('hidden', !e.target.checked);
    }

    saveCurrentEdit(); // Auto-guardar cambios
    updateOptionsSummary();
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
    saveCurrentEdit(); // Auto-guardar cambios de recorte
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

// Handler para seleccionar carpeta - usa API de Electron si está disponible
if (elements.folderPickerBtn) {
    elements.folderPickerBtn.addEventListener('click', async () => {
        // En Electron, usar la API nativa
        if (window.electronAPI && window.electronAPI.selectFolder) {
            try {
                const result = await window.electronAPI.selectFolder();
                if (result && result.success) {
                    state.downloadPath = result.path;
                    state.downloadPathName = result.name;
                    // Exponer ruta para otros scripts
                    window.currentDownloadPath = result.path;
                    // Actualizar display
                    const folderStatusValue = document.getElementById('folderStatusValue');
                    if (folderStatusValue) {
                        folderStatusValue.textContent = result.name || 'Downloads';
                    }
                    console.log('Carpeta seleccionada:', result.path);
                }
            } catch (err) {
                console.error('Error seleccionando carpeta:', err);
            }
        } else {
            // Fallback para navegador web
            if ('showDirectoryPicker' in window) {
                try {
                    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
                    state.downloadFolderHandle = handle;
                    state.downloadFolderName = handle.name;
                    if (elements.folderPath) {
                        elements.folderPath.textContent = `📁 ${handle.name}`;
                    }
                    elements.folderPickerBtn.classList.add('active');
                    localStorage.setItem('downloadFolderName', handle.name);
                } catch (err) {
                    console.log('Selección de carpeta cancelada');
                }
            } else {
                alert('Tu navegador no soporta esta función.');
            }
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

// Descargar todo - siempre descarga individualmente (sin ZIP)
elements.downloadAllBtn.addEventListener('click', async () => {
    const pendingVideos = state.queue.filter(v => v.status === 'pending');
    if (pendingVideos.length === 0) return;

    // Descargar todos los videos individualmente
    processQueue();
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
    // Mostrar sección de selección de carpeta
    if (elements.folderPickerSection) {
        elements.folderPickerSection.style.display = 'flex';
        elements.folderPickerSection.classList.add('not-configured');
    }

    // Obtener carpeta de descargas por defecto (null = preguntará cada vez)
    window.electronAPI.getDefaultDownloadPath().then(path => {
        state.downloadPath = path;
        updateFolderDisplay();
    });

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

    // Handler para descarga directa desde notificación
    window.electronAPI.onClipboardUrlDownload(async (url) => {
        console.log('URL para descarga directa:', url);

        // Poner la URL en el input
        elements.urlInput.value = url;
        state.currentUrl = url;

        // Analizar y descargar automáticamente
        clearError();
        setLoading(elements.fetchBtn, true);
        elements.videoPreview.classList.add('hidden');

        try {
            const info = await fetchVideoInfo(url);
            displayVideoInfo(info);

            // Iniciar descarga automáticamente
            setTimeout(() => {
                downloadWithProgress();
            }, 500);

        } catch (error) {
            showError(error.message);
            setLoading(elements.fetchBtn, false);
        }
    });
    // ═══════════════════════════════════════════════════════════
    // AUTO-ADD A COLA (Videos copiados del portapapeles)
    // ═══════════════════════════════════════════════════════════

    // Escuchar videos analizados desde el portapapeles
    window.electronAPI.onAddToQueue((videoData) => {
        console.log('Video auto-añadido a cola:', videoData.title);

        // Agregar a la cola usando la función existente
        addToQueue(videoData, videoData.url);

        // Mostrar toast de confirmación
        showDownloadToast('📋 Agregado a cola', videoData.title?.substring(0, 40) || 'Video');
    });
}

function updateFolderDisplay() {
    if (!elements.folderPickerSection) return;

    if (state.downloadPath) {
        // Carpeta configurada
        const name = state.downloadPathName || state.downloadPath.split(/[\\/]/).pop();
        elements.folderPickerSection.classList.remove('not-configured');
        elements.folderPickerSection.classList.add('configured');
        if (elements.folderStatusValue) elements.folderStatusValue.textContent = name;
        if (elements.folderBtnText) elements.folderBtnText.textContent = 'Cambiar';
    } else {
        // Sin carpeta - preguntará cada vez
        elements.folderPickerSection.classList.remove('configured');
        elements.folderPickerSection.classList.add('not-configured');
        if (elements.folderStatusValue) elements.folderStatusValue.textContent = 'Preguntará cada descarga';
        if (elements.folderBtnText) elements.folderBtnText.textContent = 'Elegir';
    }
}

// ═══════════════════════════════════════════════════════════
// DESCARGA CON SSE (Server-Sent Events)
// ═══════════════════════════════════════════════════════════

async function downloadWithProgress() {
    if (!state.videoInfo) return;

    // Si no hay carpeta configurada en Electron, pedir que seleccione una
    if (isElectron && !state.downloadPath) {
        const result = await window.electronAPI.selectFolder();
        if (!result.success) {
            showDownloadToast('⚠️ Selecciona una carpeta', 'Debes elegir dónde guardar el video');
            return;
        }
        state.downloadPath = result.path;
        state.downloadPathName = result.name;
        updateFolderDisplay();
    }

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

    // Agregar carpeta de destino
    if (state.downloadPath) {
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

// Mover a carpeta (multi-selección)
if (elements.moveFolderBtn) {
    elements.moveFolderBtn.addEventListener('click', moveSelectedItemsToFolder);
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
    if (!elements.historyList) return;

    // Manejar estado vacío
    if (state.downloadHistory.length === 0) {
        elements.historyList.innerHTML = '';
        elements.historyEmptyState?.classList.remove('hidden');
        elements.clearHistoryBtn?.classList.add('hidden');
        return;
    }

    elements.historyEmptyState?.classList.add('hidden');
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

// Event listeners para historial modal
function showHistoryModal() {
    if (elements.historyModal) {
        updateHistoryUI(); // Actualizar al abrir
        elements.historyModal.classList.remove('hidden');
    }
}

function hideHistoryModal() {
    if (elements.historyModal) {
        elements.historyModal.classList.add('hidden');
    }
}

if (elements.openHistoryBtn) {
    elements.openHistoryBtn.addEventListener('click', showHistoryModal);
}

if (elements.closeHistoryModal) {
    elements.closeHistoryModal.addEventListener('click', hideHistoryModal);
}

if (elements.historyModal) {
    // Cerrar al hacer clic fuera
    elements.historyModal.querySelector('.modal-backdrop')?.addEventListener('click', hideHistoryModal);
}

if (elements.clearHistoryBtn) {
    elements.clearHistoryBtn.addEventListener('click', clearHistory);
}

// Inicializar UI del historial
updateHistoryUI();
