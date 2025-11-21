document.addEventListener('DOMContentLoaded', () => {
    const generateBtn = document.getElementById('generate-btn');
    const promptInput = document.getElementById('prompt');
    const aspectRatioInput = document.getElementById('aspect-ratio');
    const resolutionInput = document.getElementById('resolution');
    const apiKeyInput = document.getElementById('api-key');
    
    // States
    const placeholderState = document.getElementById('placeholder-state');
    const loadingState = document.getElementById('loading-state');
    const errorState = document.getElementById('error-state');
    const resultState = document.getElementById('result-state');
    
    const errorText = document.getElementById('error-text');
    const generatedImage = document.getElementById('generated-image');
    const downloadLink = document.getElementById('download-link');
    const galleryGrid = document.getElementById('gallery-grid');
    const imageInputGrid = document.getElementById('image-input-grid');
    const SETTINGS_STORAGE_KEY = 'gemini-image-app-settings';
    const MAX_IMAGE_SLOTS = 16;
    const INITIAL_IMAGE_SLOTS = 4;
    const imageSlotState = [];
    let cachedReferenceImages = [];
    const imageDisplayArea = document.querySelector('.image-display-area');
    const canvasToolbar = document.querySelector('.canvas-toolbar');
    const ZOOM_STEP = 0.1;
    const MIN_ZOOM = 0.4;
    const MAX_ZOOM = 4;
    let zoomLevel = 1;
    let panOffset = { x: 0, y: 0 };
    let isPanning = false;
    let lastPointer = { x: 0, y: 0 };

    // Load gallery on start
    loadSettings();
    initializeImageInputs();
    loadGallery();

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

        // Set UI to loading
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
                // Refresh gallery to show new image
                loadGallery();
            } else {
                throw new Error('No image data received');
            }

        } catch (error) {
            showError(error.message);
        } finally {
            generateBtn.disabled = false;
        }
    });

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

    document.addEventListener('keydown', handleGenerateShortcut);
    document.addEventListener('keydown', handleResetShortcut);
    document.addEventListener('keydown', handleDownloadShortcut);

    function handleGenerateShortcut(event) {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault();
            if (generateBtn && !generateBtn.disabled) {
                generateBtn.click();
            }
        }
    }

    if (imageDisplayArea) {
        imageDisplayArea.addEventListener('wheel', handleCanvasWheel, { passive: false });
        imageDisplayArea.addEventListener('pointerdown', handleCanvasPointerDown);
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

    function showError(message) {
        errorText.textContent = message;
        setViewState('error');
    }

    function displayImage(imageUrl, imageData) {
        const cacheBustedUrl = withCacheBuster(imageUrl);

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

    async function loadGallery() {
        try {
            const response = await fetch(`/gallery?t=${new Date().getTime()}`);
            const data = await response.json();
            
            galleryGrid.innerHTML = '';
            
            data.images.forEach(imageUrl => {
                const div = document.createElement('div');
                div.className = 'gallery-item';
                div.onclick = () => {
                    displayImage(imageUrl);
                    // Update active state
                    document.querySelectorAll('.gallery-item').forEach(el => el.classList.remove('active'));
                    div.classList.add('active');
                };
                
                const img = document.createElement('img');
                img.src = withCacheBuster(imageUrl);
                img.loading = 'lazy';
                
                div.appendChild(img);
                galleryGrid.appendChild(div);
            });
        } catch (error) {
            console.error('Failed to load gallery:', error);
        }
    }

    function withCacheBuster(url) {
        const separator = url.includes('?') ? '&' : '?';
        return `${url}${separator}t=${new Date().getTime()}`;
    }

    function buildGenerateFormData(fields) {
        const formData = new FormData();

        Object.entries(fields).forEach(([key, value]) => {
            if (value !== undefined && value !== null) {
                formData.append(key, value);
            }
        });

        imageSlotState.forEach(record => {
            const slotFile = getSlotFile(record);
            if (slotFile) {
                formData.append('reference_images', slotFile, slotFile.name);
            }
        });

        return formData;
    }

    function loadSettings() {
        if (typeof localStorage === 'undefined') return;
        try {
            const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
            if (!saved) return;

            const { apiKey, aspectRatio, resolution, prompt, referenceImages } = JSON.parse(saved);
            if (apiKey) apiKeyInput.value = apiKey;
            if (aspectRatio) aspectRatioInput.value = aspectRatio;
            if (resolution) resolutionInput.value = resolution;
            if (prompt) promptInput.value = prompt;
            cachedReferenceImages = Array.isArray(referenceImages) ? referenceImages : [];
        } catch (error) {
            console.warn('Unable to load cached settings', error);
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
                referenceImages: serializeReferenceImages(),
            };
            localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
        } catch (error) {
            console.warn('Unable to persist settings', error);
        }
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

    function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    function handleResetShortcut(event) {
        if (event.key !== 'r') return;
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

    function initializeImageInputs() {
        if (!imageInputGrid) return;
        const requiredSlots = Math.min(
            MAX_IMAGE_SLOTS,
            Math.max(INITIAL_IMAGE_SLOTS, cachedReferenceImages.length + 1)
        );
        for (let i = 0; i < requiredSlots; i++) {
            addImageSlot();
        }
        cachedReferenceImages.forEach((cached, index) => {
            applyCachedImageToSlot(index, cached);
        });
        maybeAddSlot();
    }

    function applyCachedImageToSlot(index, cached) {
        if (!cached || !cached.dataUrl) return;
        const slotRecord = imageSlotState[index];
        if (!slotRecord) return;
        slotRecord.data = {
            file: null,
            preview: cached.dataUrl,
            cached: {
                name: cached.name,
                type: cached.type,
                dataUrl: cached.dataUrl,
            },
        };
        updateSlotVisual(index);
    }

    function addImageSlot() {
        if (!imageInputGrid || imageSlotState.length >= MAX_IMAGE_SLOTS) return;
        const index = imageSlotState.length;
        const slotElement = createImageSlotElement(index);
        imageSlotState.push({
            slot: slotElement,
            data: null,
        });
        imageInputGrid.appendChild(slotElement);
    }

    function createImageSlotElement(index) {
        const slot = document.createElement('div');
        slot.className = 'image-slot empty';
        slot.dataset.index = index;

        const placeholder = document.createElement('div');
        placeholder.className = 'slot-placeholder';
        placeholder.innerHTML = '<span class="slot-icon">+</span>';
        slot.appendChild(placeholder);

        const preview = document.createElement('img');
        preview.className = 'slot-preview hidden';
        preview.alt = 'Uploaded reference';
        slot.appendChild(preview);

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'slot-remove hidden';
        removeBtn.setAttribute('aria-label', 'Remove image');
        removeBtn.textContent = '×';
        slot.appendChild(removeBtn);

        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.className = 'slot-input';
        slot.appendChild(input);

        slot.addEventListener('click', event => {
            if (event.target === removeBtn) return;
            input.click();
        });

        input.addEventListener('change', () => {
            if (input.files && input.files.length) {
                handleSlotFile(index, input.files[0]);
            }
        });

        slot.addEventListener('dragenter', event => {
            event.preventDefault();
            slot.classList.add('drag-over');
        });

        slot.addEventListener('dragover', event => {
            event.preventDefault();
            slot.classList.add('drag-over');
        });

        slot.addEventListener('dragleave', () => {
            slot.classList.remove('drag-over');
        });

        slot.addEventListener('drop', event => {
            event.preventDefault();
            slot.classList.remove('drag-over');
            const file = event.dataTransfer?.files?.[0];
            if (file) {
                handleSlotFile(index, file);
            }
        });

        removeBtn.addEventListener('click', event => {
            event.stopPropagation();
            clearSlot(index);
        });

        return slot;
    }

    function handleSlotFile(index, file) {
        if (!file || !file.type.startsWith('image/')) return;
        const reader = new FileReader();
        reader.onload = () => {
            const previewUrl = reader.result;
            if (typeof previewUrl !== 'string') return;
            const slotRecord = imageSlotState[index];
            if (!slotRecord) return;
            slotRecord.data = {
                file,
                preview: previewUrl,
                cached: null,
            };
            updateSlotVisual(index);
            persistSettings();
            maybeAddSlot();
        };
        reader.readAsDataURL(file);
    }

    function updateSlotVisual(index) {
        const slotRecord = imageSlotState[index];
        if (!slotRecord) return;
        const slot = slotRecord.slot;
        const placeholder = slot.querySelector('.slot-placeholder');
        const preview = slot.querySelector('.slot-preview');
        const removeBtn = slot.querySelector('.slot-remove');

        if (slotRecord.data && slotRecord.data.preview) {
            preview.src = slotRecord.data.preview;
            preview.classList.remove('hidden');
            placeholder.classList.add('hidden');
            removeBtn.classList.remove('hidden');
            slot.classList.add('filled');
            slot.classList.remove('empty');
        } else {
            preview.src = '';
            preview.classList.add('hidden');
            placeholder.classList.remove('hidden');
            removeBtn.classList.add('hidden');
            slot.classList.add('empty');
            slot.classList.remove('filled');
        }
    }

    function clearSlot(index) {
        const slotRecord = imageSlotState[index];
        if (!slotRecord) return;
        slotRecord.data = null;
        const input = slotRecord.slot.querySelector('.slot-input');
        if (input) input.value = '';
        updateSlotVisual(index);
        persistSettings();
    }

    function maybeAddSlot() {
        const hasEmpty = imageSlotState.some(record => !record.data);
        if (!hasEmpty && imageSlotState.length < MAX_IMAGE_SLOTS) {
            addImageSlot();
        }
    }

    function serializeReferenceImages() {
        return imageSlotState
            .map((record, index) => {
                if (!record.data || !record.data.preview) return null;
                const name = record.data.cached?.name || record.data.file?.name || `reference-${index + 1}.png`;
                const type = record.data.cached?.type || record.data.file?.type || 'image/png';
                return {
                    name,
                    type,
                    dataUrl: record.data.preview,
                };
            })
            .filter(Boolean);
    }

    function getSlotFile(record) {
        if (!record.data) return null;
        if (record.data.file) return record.data.file;
        if (record.data.cached && record.data.cached.dataUrl) {
            const blob = dataUrlToBlob(record.data.cached.dataUrl);
            if (!blob) return null;
            const fileName = record.data.cached.name || `reference.png`;
            const fileType = record.data.cached.type || 'image/png';
            return new File([blob], fileName, { type: fileType });
        }
        return null;
    }

    function dataUrlToBlob(dataUrl) {
        try {
            const [prefix, base64] = dataUrl.split(',');
            const mimeMatch = prefix.match(/:(.*?);/);
            const mime = mimeMatch ? mimeMatch[1] : 'image/png';
            const binary = atob(base64);
            const len = binary.length;
            const buffer = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                buffer[i] = binary.charCodeAt(i);
            }
            return new Blob([buffer], { type: mime });
        } catch (error) {
            console.warn('Unable to convert cached image to blob', error);
            return null;
        }
    }
});
