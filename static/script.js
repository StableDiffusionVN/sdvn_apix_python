import { withCacheBuster, clamp } from './modules/utils.js';
import { createGallery } from './modules/gallery.js';
import { createReferenceSlotManager } from './modules/referenceSlots.js';
import { setupHelpPopups } from './modules/popup.js';
import { extractMetadataFromBlob } from './modules/metadata.js';

const SETTINGS_STORAGE_KEY = 'gemini-image-app-settings';
const ZOOM_STEP = 0.1;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 4;
const SIDEBAR_MIN_WIDTH = 260;
const SIDEBAR_MAX_WIDTH = 520;

const infoContent = {
    title: 'Thông tin',
    sections: [
        {
            heading: 'Liên hệ',
            items: [
                'Người tạo: Phạm Hưng',
                'Group: <a href="https://www.facebook.com/groups/stablediffusion.vn/" target="_blank" rel="noreferrer">SDVN - Cộng đồng AI Art</a>',
                'Website: <a href="https://sdvn.vn" target="_blank" rel="noreferrer">sdvn.vn</a>',
            ],
        },
    ],
};

const docsContent = {
    title: 'Phím tắt và mẹo',
    sections: [
        {
            heading: 'Phím tắt',
            items: [
                'Ctrl/Cmd + Enter → tạo ảnh mới',
                'D → tải ảnh hiện tại',
                'D → tải ảnh hiện tại',
                'Space → reset zoom/pan vùng hiển thị ảnh',
                'Esc → đóng popup thông tin/docs',
            ],
        },
        {
            heading: 'Thao tác nhanh',
            items: [
                'Kéo ảnh từ lịch sử vào ô tham chiếu để tái sử dụng',
                'Tùy chỉnh tỉ lệ và độ phân giải trước khi nhấn Generate',
                'API key và prompt được lưu để lần sau không phải nhập lại',
            ],
        },
    ],
};

const helpContent = {
    title: 'Thông tin & Hướng dẫn',
    sections: [...infoContent.sections, ...docsContent.sections],
};

const POPUP_CONTENT = {
    help: helpContent,
};

document.addEventListener('DOMContentLoaded', () => {
    const generateBtn = document.getElementById('generate-btn');
    const promptInput = document.getElementById('prompt');
    const aspectRatioInput = document.getElementById('aspect-ratio');
    const resolutionInput = document.getElementById('resolution');
    const apiKeyInput = document.getElementById('api-key');

    const placeholderState = document.getElementById('placeholder-state');
    const loadingState = document.getElementById('loading-state');
    const errorState = document.getElementById('error-state');
    const resultState = document.getElementById('result-state');
    const errorText = document.getElementById('error-text');
    const generatedImage = document.getElementById('generated-image');
    const downloadLink = document.getElementById('download-link');
    const galleryGrid = document.getElementById('gallery-grid');
    const imageInputGrid = document.getElementById('image-input-grid');
    const imageDisplayArea = document.querySelector('.image-display-area');
    const canvasToolbar = document.querySelector('.canvas-toolbar');
    const sidebar = document.querySelector('.sidebar');
    const resizeHandle = document.querySelector('.sidebar-resize-handle');

    let zoomLevel = 1;
    let panOffset = { x: 0, y: 0 };
    let isPanning = false;
    let lastPointer = { x: 0, y: 0 };

    const slotManager = createReferenceSlotManager(imageInputGrid, {
        onChange: persistSettings,
    });

    const gallery = createGallery({
        galleryGrid,
        onSelect: async ({ imageUrl, metadata }) => {
            displayImage(imageUrl);
            if (metadata) {
                applyMetadata(metadata);
            }
        },
    });

    setupHelpPopups({
        buttonsSelector: '[data-popup-target]',
        overlayId: 'popup-overlay',
        titleId: 'popup-title',
        bodyId: 'popup-body',
        closeBtnId: 'popup-close',
        content: POPUP_CONTENT,
    });

    const savedSettings = loadSettings();
    slotManager.initialize(savedSettings.referenceImages || []);

    apiKeyInput.addEventListener('input', persistSettings);
    promptInput.addEventListener('input', persistSettings);
    aspectRatioInput.addEventListener('change', persistSettings);
    resolutionInput.addEventListener('change', persistSettings);

    generateBtn.addEventListener('click', async () => {
        const prompt = promptInput.value.trim();
        const aspectRatio = aspectRatioInput.value;
        const resolution = resolutionInput.value;
        const apiKey = apiKeyInput.value.trim();

        if (!prompt) {
            showError('Please enter a prompt.');
            return;
        }

        setViewState('loading');
        generateBtn.disabled = true;

        try {
            const formData = buildGenerateFormData({
                prompt,
                aspect_ratio: aspectRatio,
                resolution,
                api_key: apiKey,
            });

            const response = await fetch('/generate', {
                method: 'POST',
                body: formData,
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to generate image');
            }

            if (data.image) {
                displayImage(data.image, data.image_data);
                gallery.load();
            } else {
                throw new Error('No image data received');
            }
        } catch (error) {
            showError(error.message);
        } finally {
            generateBtn.disabled = false;
        }
    });

    document.addEventListener('keydown', handleGenerateShortcut);
    document.addEventListener('keydown', handleResetShortcut);
    document.addEventListener('keydown', handleDownloadShortcut);

    if (imageDisplayArea) {
        imageDisplayArea.addEventListener('wheel', handleCanvasWheel, { passive: false });
        imageDisplayArea.addEventListener('pointerdown', handleCanvasPointerDown);
        
        // Drag and drop support
        imageDisplayArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            imageDisplayArea.classList.add('drag-over');
        });

        imageDisplayArea.addEventListener('dragleave', (e) => {
            e.preventDefault();
            imageDisplayArea.classList.remove('drag-over');
        });

        imageDisplayArea.addEventListener('drop', async (e) => {
            e.preventDefault();
            imageDisplayArea.classList.remove('drag-over');
            
            const files = e.dataTransfer?.files;
            if (files && files.length > 0) {
                const file = files[0];
                if (file.type.startsWith('image/')) {
                    try {
                        // Display image immediately
                        const objectUrl = URL.createObjectURL(file);
                        displayImage(objectUrl);
                        
                        // Extract and apply metadata
                        const metadata = await extractMetadataFromBlob(file);
                        if (metadata) {
                            applyMetadata(metadata);
                        }
                    } catch (error) {
                        console.error('Error handling dropped image:', error);
                    }
                }
            }
            else {
                const imageUrl = e.dataTransfer?.getData('text/uri-list')
                    || e.dataTransfer?.getData('text/plain');
                if (imageUrl) {
                    await handleCanvasDropUrl(imageUrl.trim());
                }
            }
        });
    }

    if (canvasToolbar) {
        canvasToolbar.addEventListener('click', handleCanvasToolbarClick);
    }

    document.addEventListener('pointermove', handleCanvasPointerMove);
    document.addEventListener('pointerup', () => {
        if (isPanning && imageDisplayArea) {
            imageDisplayArea.style.cursor = 'grab';
        }
        isPanning = false;
    });
    document.addEventListener('pointerleave', () => {
        if (isPanning && imageDisplayArea) {
            imageDisplayArea.style.cursor = 'grab';
        }
        isPanning = false;
    });

    loadGallery();
    setupSidebarResizer(sidebar, resizeHandle);

    function setViewState(state) {
        placeholderState.classList.add('hidden');
        loadingState.classList.add('hidden');
        errorState.classList.add('hidden');
        resultState.classList.add('hidden');

        switch (state) {
            case 'placeholder':
                placeholderState.classList.remove('hidden');
                break;
            case 'loading':
                loadingState.classList.remove('hidden');
                break;
            case 'error':
                errorState.classList.remove('hidden');
                break;
            case 'result':
                resultState.classList.remove('hidden');
                break;
        }
    }

    function showError(message) {
        errorText.textContent = message;
        setViewState('error');
    }

    function displayImage(imageUrl, imageData) {
        let cacheBustedUrl = imageUrl;
        if (!imageUrl.startsWith('blob:') && !imageUrl.startsWith('data:')) {
            cacheBustedUrl = withCacheBuster(imageUrl);
        }

        if (imageData) {
            generatedImage.src = `data:image/png;base64,${imageData}`;
        } else {
            generatedImage.src = cacheBustedUrl;
        }

        downloadLink.href = imageData ? generatedImage.src : cacheBustedUrl;
        const filename = imageUrl.split('/').pop().split('?')[0];
        downloadLink.setAttribute('download', filename);

        generatedImage.onload = () => {
            resetView();
        };

        setViewState('result');
    }

    async function handleCanvasDropUrl(imageUrl) {
        const cleanedUrl = imageUrl;
        displayImage(cleanedUrl);
        try {
            const response = await fetch(withCacheBuster(cleanedUrl));
            if (!response.ok) return;
            const metadata = await extractMetadataFromBlob(await response.blob());
            if (metadata) {
                applyMetadata(metadata);
            }
        } catch (error) {
            console.warn('Unable to read metadata from dropped image', error);
        }
    }

    function applyMetadata(metadata) {
        if (!metadata) return;
        if (metadata.prompt) promptInput.value = metadata.prompt;
        if (metadata.aspect_ratio) aspectRatioInput.value = metadata.aspect_ratio;
        if (metadata.resolution) resolutionInput.value = metadata.resolution;
        
        if (metadata.reference_images && Array.isArray(metadata.reference_images)) {
            slotManager.setReferenceImages(metadata.reference_images);
        }
        
        persistSettings();
    }

    async function loadGallery() {
        try {
            await gallery.load();
        } catch (error) {
            console.error('Unable to populate gallery', error);
        }
    }

    function buildGenerateFormData(fields) {
        const formData = new FormData();

        Object.entries(fields).forEach(([key, value]) => {
            if (value !== undefined && value !== null) {
                formData.append(key, value);
            }
        });

        slotManager.getReferenceFiles().forEach(file => {
            formData.append('reference_images', file, file.name);
        });
        
        const referencePaths = slotManager.getReferencePaths();
        if (referencePaths && referencePaths.length > 0) {
            formData.append('reference_image_paths', JSON.stringify(referencePaths));
        }

        return formData;
    }

    function loadSettings() {
        if (typeof localStorage === 'undefined') return {};
        try {
            const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
            if (!saved) return {};

            const { apiKey, aspectRatio, resolution, prompt, referenceImages } = JSON.parse(saved);
            if (apiKey) apiKeyInput.value = apiKey;
            if (aspectRatio) aspectRatioInput.value = aspectRatio;
            if (resolution) resolutionInput.value = resolution;
            if (prompt) promptInput.value = prompt;
            return { apiKey, aspectRatio, resolution, prompt, referenceImages };
        } catch (error) {
            console.warn('Unable to load cached settings', error);
            return {};
        }
    }

    function persistSettings() {
        if (typeof localStorage === 'undefined') return;
        try {
            const settings = {
                apiKey: apiKeyInput.value.trim(),
                aspectRatio: aspectRatioInput.value,
                resolution: resolutionInput.value,
                prompt: promptInput.value.trim(),
                referenceImages: slotManager.serializeReferenceImages(),
            };
            localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
        } catch (error) {
            console.warn('Unable to persist settings', error);
        }
    }

    function handleGenerateShortcut(event) {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault();
            if (generateBtn && !generateBtn.disabled) {
                generateBtn.click();
            }
        }
    }

    function handleResetShortcut(event) {
        if (event.code !== 'Space' && event.key !== ' ') return;
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        const targetTag = event.target?.tagName;
        if (targetTag && ['INPUT', 'TEXTAREA', 'SELECT'].includes(targetTag)) return;
        if (event.target?.isContentEditable) return;
        if (resultState.classList.contains('hidden')) return;
        event.preventDefault();
        resetView();
    }

    function handleDownloadShortcut(event) {
        if (event.key !== 'd') return;
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        const targetTag = event.target?.tagName;
        if (targetTag && ['INPUT', 'TEXTAREA', 'SELECT'].includes(targetTag)) return;
        if (event.target?.isContentEditable) return;
        if (resultState.classList.contains('hidden')) return;
        event.preventDefault();
        downloadLink.click();
    }

    function handleCanvasWheel(event) {
        if (resultState.classList.contains('hidden')) return;
        event.preventDefault();
        const delta = event.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
        adjustZoom(delta);
    }

    function handleCanvasPointerDown(event) {
        const result = document.getElementById('result-state');
        if (result.classList.contains('hidden')) return;
        isPanning = true;
        lastPointer = { x: event.clientX, y: event.clientY };
        imageDisplayArea.style.cursor = 'grabbing';
    }

    function handleCanvasPointerMove(event) {
        if (!isPanning) return;
        const dx = event.clientX - lastPointer.x;
        const dy = event.clientY - lastPointer.y;
        panOffset.x += dx;
        panOffset.y += dy;
        lastPointer = { x: event.clientX, y: event.clientY };
        setImageTransform();
    }

    function handleCanvasToolbarClick(event) {
        const action = event.target.closest('.canvas-btn')?.dataset.action;
        if (!action) return;
        switch (action) {
            case 'zoom-in':
                adjustZoom(ZOOM_STEP);
                break;
            case 'zoom-out':
                adjustZoom(-ZOOM_STEP);
                break;
            case 'zoom-fit':
                zoomLevel = getFitZoom();
                panOffset = { x: 0, y: 0 };
                setImageTransform();
                break;
            case 'zoom-reset':
                resetView();
                break;
        }
    }

    function adjustZoom(delta) {
        const prevZoom = zoomLevel;
        zoomLevel = clamp(zoomLevel + delta, MIN_ZOOM, MAX_ZOOM);
        const scale = zoomLevel / prevZoom;
        panOffset.x *= scale;
        panOffset.y *= scale;
        setImageTransform();
    }

    function setImageTransform() {
        generatedImage.style.transform = `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomLevel})`;
    }

    function getFitZoom() {
        if (!generatedImage.naturalWidth || !generatedImage.naturalHeight || !imageDisplayArea) {
            return 1;
        }
        const rect = imageDisplayArea.getBoundingClientRect();
        const scaleX = rect.width / generatedImage.naturalWidth;
        const scaleY = rect.height / generatedImage.naturalHeight;
        const fitZoom = Math.max(scaleX, scaleY);
        return Math.max(fitZoom, MIN_ZOOM);
    }

    function resetView() {
        zoomLevel = 1;
        panOffset = { x: 0, y: 0 };
        setImageTransform();
    }

    function setupSidebarResizer(sidebar, handle) {
        if (!sidebar || !handle) return;
        let isResizing = false;
        let activePointerId = null;

        const updateWidth = (clientX) => {
            const sidebarRect = sidebar.getBoundingClientRect();
            let newWidth = clientX - sidebarRect.left;
            newWidth = clamp(newWidth, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH);
            sidebar.style.width = `${newWidth}px`;
        };

        const stopResize = () => {
            if (!isResizing) return;
            isResizing = false;
            if (activePointerId !== null) {
                try {
                    handle.releasePointerCapture(activePointerId);
                } catch (error) {
                    console.warn('Unable to release pointer capture', error);
                }
                activePointerId = null;
            }
            document.body.style.cursor = '';
        };

        handle.addEventListener('pointerdown', (event) => {
            isResizing = true;
            activePointerId = event.pointerId;
            handle.setPointerCapture(activePointerId);
            document.body.style.cursor = 'ew-resize';
            event.preventDefault();
        });

        document.addEventListener('pointermove', (event) => {
            if (!isResizing) return;
            updateWidth(event.clientX);
        });

        document.addEventListener('pointerup', stopResize);
        document.addEventListener('pointercancel', stopResize);
    }

});
