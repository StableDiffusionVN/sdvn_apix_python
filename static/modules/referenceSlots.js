import { dataUrlToBlob, withCacheBuster } from './utils.js';

export function createReferenceSlotManager(imageInputGrid, options = {}) {
    const MAX_IMAGE_SLOTS = 16;
    const INITIAL_IMAGE_SLOTS = 4;
    const onChange = options.onChange;
    const imageSlotState = [];
    let cachedReferenceImages = [];

    function initialize(initialCached = []) {
        cachedReferenceImages = Array.isArray(initialCached) ? initialCached : [];
        const requiredSlots = Math.min(
            MAX_IMAGE_SLOTS,
            Math.max(INITIAL_IMAGE_SLOTS, cachedReferenceImages.length + 1)
        );

        for (let i = 0; i < requiredSlots; i++) {
            addImageSlot();
        }

        cachedReferenceImages.forEach((cached, index) => applyCachedImageToSlot(index, cached));
        maybeAddSlot();
    }

    function getReferenceFiles() {
        return imageSlotState
            .filter(record => record.data && !record.data.sourceUrl) // Only return files if no sourceUrl
            .map(record => getSlotFile(record))
            .filter(Boolean);
    }

    function getReferencePaths() {
        return imageSlotState.map(record => {
            if (!record.data) return null;
            return record.data.sourceUrl || record.data.file?.name || null;
        });
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
                    sourceUrl: record.data.sourceUrl,
                };
            })
            .filter(Boolean);
    }

    function addImageSlot() {
        if (!imageInputGrid || imageSlotState.length >= MAX_IMAGE_SLOTS) return;
        const index = imageSlotState.length;
        const slotElement = createImageSlotElement(index);
        imageSlotState.push({ slot: slotElement, data: null });
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

        slot.addEventListener('drop', async event => {
            event.preventDefault();
            slot.classList.remove('drag-over');
            const file = event.dataTransfer?.files?.[0];
            if (file) {
                handleSlotFile(index, file);
                return;
            }

            const imageUrl = event.dataTransfer?.getData('text/uri-list')
                || event.dataTransfer?.getData('text/plain');
            if (imageUrl) {
                await handleSlotDropFromHistory(index, imageUrl);
            }
        });

        removeBtn.addEventListener('click', event => {
            event.stopPropagation();
            clearSlot(index);
        });

        return slot;
    }

    function handleSlotFile(index, file, sourceUrl = null) {
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
                sourceUrl: sourceUrl,
            };
            updateSlotVisual(index);
            onChange?.();
            maybeAddSlot();
        };
        reader.readAsDataURL(file);
    }

    async function handleSlotDropFromHistory(index, imageUrl) {
        try {
            const response = await fetch(withCacheBuster(imageUrl));
            if (!response.ok) {
                console.warn('Failed to fetch history image', response.statusText);
                return;
            }

            const blob = await response.blob();
            const name = imageUrl.split('/').pop()?.split('?')[0] || `history-${index + 1}.png`;
            const type = blob.type || 'image/png';
            const file = new File([blob], name, { type });
            
            // Extract relative path if possible, or use full URL
            // Assuming imageUrl is like http://localhost:8888/static/generated/uuid.png
            // We want /static/generated/uuid.png or just generated/uuid.png if that's how we store it.
            // The app.py stores 'generated/filename.png' in metadata if we send it.
            // But wait, app.py constructs image_url using url_for('static', filename=rel_path).
            // Let's just store the full URL or relative path.
            // If we store the full URL, we can fetch it back.
            
            let sourceUrl = imageUrl;
            try {
                const urlObj = new URL(imageUrl, window.location.origin);
                if (urlObj.origin === window.location.origin) {
                    sourceUrl = urlObj.pathname; 
                }
            } catch (e) {
                // ignore
            }

            handleSlotFile(index, file, sourceUrl);
        } catch (error) {
            console.error('Unable to import history image', error);
        }
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
        onChange?.();
    }

    function maybeAddSlot() {
        const hasEmpty = imageSlotState.some(record => !record.data);
        if (!hasEmpty && imageSlotState.length < MAX_IMAGE_SLOTS) {
            addImageSlot();
        }
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
            sourceUrl: cached.sourceUrl || null,
        };
        updateSlotVisual(index);
    }

    async function setReferenceImages(paths) {
        if (!Array.isArray(paths)) return;
        
        // Clear existing slots first? Or overwrite?
        // Let's overwrite from the beginning.
        
        // Ensure we have enough slots
        while (imageSlotState.length < paths.length && imageSlotState.length < MAX_IMAGE_SLOTS) {
            addImageSlot();
        }

        for (let i = 0; i < paths.length; i++) {
            const path = paths[i];
            if (!path) {
                clearSlot(i);
                continue;
            }

            // Check if it looks like a path we can fetch
            if (path.startsWith('/') || path.startsWith('http')) {
                await handleSlotDropFromHistory(i, path);
            } else {
                // It's likely just a filename of a local file we can't restore
                // So we clear the slot
                clearSlot(i);
            }
        }
        
        // Clear remaining slots
        for (let i = paths.length; i < imageSlotState.length; i++) {
            clearSlot(i);
        }
        
        maybeAddSlot();
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

    return {
        initialize,
        getReferenceFiles,
        getReferencePaths,
        serializeReferenceImages,
        setReferenceImages,
    };
}
