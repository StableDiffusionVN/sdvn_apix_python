import { withCacheBuster, clamp } from './modules/utils.js';
import { createGallery } from './modules/gallery.js';
import { createReferenceSlotManager } from './modules/referenceSlots.js';
import { setupHelpPopups } from './modules/popup.js';
import { extractMetadataFromBlob } from './modules/metadata.js';
import { createTemplateGallery } from './modules/templateGallery.js';
import { i18n } from './modules/i18n.js';

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
                'Ctrl/Cmd + Enter → Tạo ảnh mới',
                'D → Tải ảnh hiện tại',
                'T → Mở bảng template',
                'Space → Reset zoom/pan vùng hiển thị ảnh',
                'Esc → Đóng popup thông tin/docs',
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
        {
            heading: 'Cú pháp đặc biệt',
            items: [
                'Placeholder: Dùng {text} hoặc [text] trong prompt (VD: A photo of a {animal})',
                'Note đơn: Nội dung Note sẽ thay thế cho placeholder',
                'Note hàng đợi: Dùng dấu | để tạo nhiều ảnh (VD: cat|dog|bird)',
                'Note nhiều dòng: Mỗi dòng tương ứng một lần tạo ảnh',
                'Mặc định: Nếu Note trống, dùng giá trị trong ngoặc (VD: {cat|dog} tạo 2 ảnh)',
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
    const promptNoteInput = document.getElementById('prompt-note');
    const promptHighlight = document.getElementById('prompt-highlight');
    const noteHighlight = document.getElementById('note-highlight');
    const themeOptionsContainer = document.getElementById('theme-options');
    const promptPlaceholderText = promptInput?.getAttribute('placeholder') || '';
    const promptNotePlaceholderText = promptNoteInput?.getAttribute('placeholder') || '';
    const aspectRatioInput = document.getElementById('aspect-ratio');
    const resolutionInput = document.getElementById('resolution');
    const apiKeyInput = document.getElementById('api-key');
    const openApiSettingsBtn = document.getElementById('open-api-settings-btn');
    const apiSettingsOverlay = document.getElementById('api-settings-overlay');
    const apiSettingsCloseBtn = document.getElementById('api-settings-close');
    const saveApiSettingsBtn = document.getElementById('save-api-settings-btn');
    const apiKeyToggleBtn = document.getElementById('toggle-api-key-visibility');
    const apiKeyEyeIcon = apiKeyToggleBtn?.querySelector('.icon-eye');
    const apiKeyEyeOffIcon = apiKeyToggleBtn?.querySelector('.icon-eye-off');
    const bodyFontSelect = document.getElementById('body-font');

    const placeholderState = document.getElementById('placeholder-state');
    const loadingState = document.getElementById('loading-state');
    const errorState = document.getElementById('error-state');
    const templateGalleryState = document.getElementById('template-gallery-state');
    const templateGalleryContainer = document.getElementById('template-gallery-container');
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

    // Refine Prompt Elements
    const refinePromptBtn = document.getElementById('refine-prompt-btn');
    const refineModal = document.getElementById('refine-modal');
    const closeRefineModalBtn = document.getElementById('close-refine-modal');
    const refineInstructionInput = document.getElementById('refine-instruction');
    const confirmRefineBtn = document.getElementById('confirm-refine-btn');

    // --- Helper Functions (Moved to top to avoid hoisting issues) ---

    // Model Selection Logic
    const apiModelSelect = document.getElementById('api-model');
    const resolutionGroup = resolutionInput.closest('.input-group');

    function toggleResolutionVisibility() {
        if (apiModelSelect && apiModelSelect.value === 'gemini-2.5-flash-image') {
            resolutionGroup.classList.add('hidden');
        } else {
            resolutionGroup.classList.remove('hidden');
        }
    }

    if (apiModelSelect) {
        apiModelSelect.addEventListener('change', () => {
            toggleResolutionVisibility();
            persistSettings();
        });
    }

    // Load Settings
    function loadSettings() {
        try {
            const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
            if (saved) {
                const settings = JSON.parse(saved);
                if (settings.apiKey) apiKeyInput.value = settings.apiKey;
                if (settings.prompt) promptInput.value = settings.prompt;
                if (settings.note) promptNoteInput.value = settings.note;
                if (settings.aspectRatio) aspectRatioInput.value = settings.aspectRatio;
                if (settings.resolution) resolutionInput.value = settings.resolution;
                if (apiModelSelect) {
                    apiModelSelect.value = settings.model || apiModelSelect.value || 'gemini-3-pro-image-preview';
                    toggleResolutionVisibility();
                }
                currentTheme = settings.theme || DEFAULT_THEME;
                applyBodyFont(settings.bodyFont || DEFAULT_BODY_FONT);
                if (bodyFontSelect && settings.bodyFont) {
                    bodyFontSelect.value = settings.bodyFont;
                }
                return settings;
            }
        } catch (e) {
            console.warn('Failed to load settings', e);
        }
        return {};
    }

    function persistSettings() {
        // Safely collect cached reference images for restoration
        const referenceImages = (typeof slotManager !== 'undefined' && typeof slotManager.serializeReferenceImages === 'function')
            ? slotManager.serializeReferenceImages()
            : [];
        
        const settings = {
            apiKey: apiKeyInput.value,
            prompt: promptInput.value,
            note: promptNoteInput.value,
            aspectRatio: aspectRatioInput.value,
            resolution: resolutionInput.value,
            model: apiModelSelect ? apiModelSelect.value : 'gemini-3-pro-image-preview',
            referenceImages,
            theme: currentTheme || DEFAULT_THEME,
            bodyFont: bodyFontSelect ? bodyFontSelect.value : DEFAULT_BODY_FONT,
        };
        try {
            localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
        } catch (e) {
            console.warn('Failed to save settings', e);
        }
    }

    // Helper to build form data for generation
    function buildGenerateFormData({ prompt, note, aspect_ratio, resolution, api_key, model }) {
        const formData = new FormData();
        formData.append('prompt', prompt);
        formData.append('note', note);
        formData.append('aspect_ratio', aspect_ratio);
        formData.append('resolution', resolution);
        formData.append('api_key', api_key);
        const selectedModel = model || (apiModelSelect ? apiModelSelect.value : 'gemini-3-pro-image-preview');
        formData.append('model', selectedModel);

        // Add reference images using correct slotManager methods
        const referenceFiles = slotManager.getReferenceFiles();
        referenceFiles.forEach(file => {
            formData.append('reference_images', file);
        });
        
        const referencePaths = slotManager.getReferencePaths();
        if (referencePaths && referencePaths.length > 0) {
            formData.append('reference_image_paths', JSON.stringify(referencePaths));
        }

        return formData;
    }

    const promptHighlightColors = [
        '#34d399', // green
        '#f97316', // orange
        '#facc15', // yellow
        '#38bdf8', // blue
        '#fb7185', // pink
        '#a855f7', // purple
    ];

    const DEFAULT_THEME = 'theme-sdvn';
    const DEFAULT_BODY_FONT = 'Be Vietnam Pro';

    const themeOptionsData = [
        { id: 'theme-sdvn', name: 'SDVN', gradient: 'linear-gradient(to bottom, #5858e6, #151523)' },
        { id: 'theme-vietnam', name: 'Vietnam', gradient: 'radial-gradient(ellipse at bottom, #c62921, #a21a14)' },
        { id: 'theme-skyline', name: 'Skyline', gradient: 'linear-gradient(to left, #6FB1FC, #4364F7, #0052D4)' },
        { id: 'theme-hidden-jaguar', name: 'Hidden Jaguar', gradient: 'linear-gradient(to bottom, #0fd850 0%, #f9f047 100%)' },
        { id: 'theme-wide-matrix', name: 'Wide Matrix', gradient: 'linear-gradient(to top, #fcc5e4 0%, #fda34b 15%, #ff7882 35%, #c8699e 52%, #7046aa 71%, #0c1db8 87%, #020f75 100%)' },
        { id: 'theme-rainbow', name: 'Rainbow', gradient: 'linear-gradient(to right, #0575E6, #00F260)' },
        { id: 'theme-soundcloud', name: 'SoundCloud', gradient: 'linear-gradient(to right, #f83600, #fe8c00)' },
        { id: 'theme-amin', name: 'Amin', gradient: 'linear-gradient(to right, #4A00E0, #8E2DE2)' },
    ];

    let currentPlaceholderSegments = [];
    let currentTheme = DEFAULT_THEME;

    function escapeHtml(value) {
        return value.replace(/[&<>"']/g, (char) => {
            switch (char) {
                case '&': return '&amp;';
                case '<': return '&lt;';
                case '>': return '&gt;';
                case '"': return '&quot;';
                case "'": return '&#39;';
                default: return char;
            }
        });
    }

    function buildPromptHighlightHtml(value) {
        if (!promptHighlight) return '';
        if (!value) {
            currentPlaceholderSegments = [];
            return `<span class="prompt-placeholder">${escapeHtml(promptPlaceholderText)}</span>`;
        }

        const placeholderRegex = /(\{[^{}]*\}|\[[^\[\]]*\])/g;
        let lastIndex = 0;
        let match;
        let colorIndex = 0;
        let html = '';
        const segments = [];

        while ((match = placeholderRegex.exec(value)) !== null) {
            html += escapeHtml(value.slice(lastIndex, match.index));
            const color = promptHighlightColors[colorIndex % promptHighlightColors.length];
            segments.push({
                text: match[0],
                color,
            });
            html += `<span class="prompt-highlight-segment" style="color:${color}">${escapeHtml(match[0])}</span>`;
            lastIndex = match.index + match[0].length;
            colorIndex++;
        }

        html += escapeHtml(value.slice(lastIndex));
        currentPlaceholderSegments = segments;
        return html || `<span class="prompt-placeholder">${escapeHtml(promptPlaceholderText)}</span>`;
    }

    function buildNoteHighlightHtml(value) {
        if (!noteHighlight) return '';
        if (!value) {
            return `<span class="note-placeholder">${escapeHtml(promptNotePlaceholderText)}</span>`;
        }

        const lines = value.split('\n');
        return lines
            .map((line, index) => {
                const color = currentPlaceholderSegments[index]?.color;
                const styleAttr = color ? ` style="color:${color}"` : '';
                return `<span class="note-line"${styleAttr}>${escapeHtml(line)}</span>`;
            })
            .join('<br>');
    }

    function refreshPromptHighlight() {
        if (!promptHighlight || !promptInput) return;
        promptHighlight.innerHTML = buildPromptHighlightHtml(promptInput.value);
        promptHighlight.scrollTop = promptInput.scrollTop;
        promptHighlight.scrollLeft = promptInput.scrollLeft;
        refreshNoteHighlight();
    }

    function refreshNoteHighlight() {
        if (!noteHighlight || !promptNoteInput) return;
        noteHighlight.innerHTML = buildNoteHighlightHtml(promptNoteInput.value);
        noteHighlight.scrollTop = promptNoteInput.scrollTop;
        noteHighlight.scrollLeft = promptNoteInput.scrollLeft;
    }

    function triggerInputUpdate(targetInput) {
        if (!targetInput) return;
        targetInput.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function getFieldInput(target) {
        if (target === 'note') return promptNoteInput;
        return promptInput;
    }

    async function copyToClipboard(text) {
        if (!navigator.clipboard?.writeText) {
            const temp = document.createElement('textarea');
            temp.value = text;
            document.body.appendChild(temp);
            temp.select();
            document.execCommand('copy');
            temp.remove();
            return;
        }
        await navigator.clipboard.writeText(text);
    }

    async function pasteIntoInput(targetInput) {
        if (!targetInput) return;
        if (!navigator.clipboard?.readText) {
            alert('Clipboard paste không được hỗ trợ trong trình duyệt này.');
            return;
        }
        const text = await navigator.clipboard.readText();
        if (!text && text !== '') return;
        const start = targetInput.selectionStart ?? targetInput.value.length;
        const end = targetInput.selectionEnd ?? start;
        targetInput.value = targetInput.value.slice(0, start) + text + targetInput.value.slice(end);
        const cursor = start + text.length;
        requestAnimationFrame(() => {
            targetInput.setSelectionRange(cursor, cursor);
            targetInput.focus();
        });
        triggerInputUpdate(targetInput);
    }

    async function handleFieldAction(action, target) {
        const targetInput = getFieldInput(target);
        if (!targetInput) return;
        if (action === 'copy') {
            await copyToClipboard(targetInput.value);
            return;
        }
        if (action === 'paste') {
            await pasteIntoInput(targetInput);
            return;
        }
        if (action === 'clear') {
            targetInput.value = '';
            triggerInputUpdate(targetInput);
        }
    }

    function updateThemeSelectionUi() {
        if (!themeOptionsContainer) return;
        themeOptionsContainer.querySelectorAll('.theme-option').forEach(btn => {
            const isActive = btn.dataset.themeId === currentTheme;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-selected', isActive);
        });
    }

    function applyThemeClass(themeId) {
        const themeIds = themeOptionsData.map(option => option.id);
        document.body.classList.remove(...themeIds);
        if (themeId && themeIds.includes(themeId)) {
            document.body.classList.add(themeId);
            currentTheme = themeId;
        } else {
            currentTheme = '';
        }
        updateThemeSelectionUi();
    }

    function selectTheme(themeId, { persist = true } = {}) {
        applyThemeClass(themeId);
        if (persist) {
            persistSettings();
        }
    }

    function applyBodyFont(fontName) {
        const fontMap = {
            'Be Vietnam Pro': "'Be Vietnam Pro', sans-serif",
            'Playwrite AU SA': "'Playwrite AU SA', cursive",
            'JetBrains Mono': "'JetBrains Mono', monospace",
        };
        const cssFont = fontMap[fontName] || fontMap[DEFAULT_BODY_FONT];
        document.body.style.fontFamily = cssFont;
        if (bodyFontSelect && fontName) {
            bodyFontSelect.value = fontName;
        }
    }

    function renderThemeOptions(initialTheme) {
        if (!themeOptionsContainer) return;
        themeOptionsContainer.innerHTML = '';
        themeOptionsData.forEach(option => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'theme-option';
            btn.dataset.themeId = option.id;
            btn.setAttribute('role', 'option');
            btn.setAttribute('aria-label', `Chọn theme ${option.name}`);
            btn.style.backgroundImage = option.gradient;
            btn.innerHTML = `<span class="theme-option-name">${option.name}</span>`;
            btn.addEventListener('click', () => selectTheme(option.id));
            themeOptionsContainer.appendChild(btn);
        });
        applyThemeClass(initialTheme);
    }

    // --- End Helper Functions ---

    let zoomLevel = 1;
    let panOffset = { x: 0, y: 0 };
    let isPanning = false;
    let lastPointer = { x: 0, y: 0 };
    let hasGeneratedImage = false; // Track if image exists

    const slotManager = createReferenceSlotManager(imageInputGrid, {
        onChange: persistSettings,
    });

    const templateGallery = createTemplateGallery({
        container: templateGalleryContainer,
        onSelectTemplate: (template) => {
            // Fill prompt field with template prompt (language-aware)
            if (template.prompt) {
                promptInput.value = i18n.getText(template.prompt);
                persistSettings();
                refreshPromptHighlight();
            }
            // Fill note (default empty when absent)
            promptNoteInput.value = template.note !== undefined ? (i18n.getText(template.note) || '') : '';
            refreshNoteHighlight();
            persistSettings();
            // Stay in template gallery view - don't auto-switch
            // User will switch view by selecting image from history or generating
        }
    });

    const gallery = createGallery({
        galleryGrid,
        onSelect: async ({ imageUrl, metadata }) => {
            displayImage(imageUrl);
            if (metadata) {
                applyMetadata(metadata);
            }
        }
    });

    setupHelpPopups({
        buttonsSelector: '[data-popup-target]',
        overlayId: 'popup-overlay',
        titleId: 'popup-title',
        bodyId: 'popup-body',
        closeBtnId: 'popup-close',
        content: POPUP_CONTENT,
    });

    const openApiSettings = () => {
        if (!apiSettingsOverlay) return;
        apiSettingsOverlay.classList.remove('hidden');
        apiKeyInput?.focus();
    };

    const closeApiSettings = () => {
        if (!apiSettingsOverlay) return;
        apiSettingsOverlay.classList.add('hidden');
    };

    openApiSettingsBtn?.addEventListener('click', openApiSettings);
    apiSettingsCloseBtn?.addEventListener('click', closeApiSettings);
    saveApiSettingsBtn?.addEventListener('click', closeApiSettings);

    apiSettingsOverlay?.addEventListener('click', (event) => {
        if (event.target === apiSettingsOverlay) {
            closeApiSettings();
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && apiSettingsOverlay && !apiSettingsOverlay.classList.contains('hidden')) {
            event.preventDefault();
            closeApiSettings();
        }
    });

    const savedSettings = loadSettings();
    renderThemeOptions(currentTheme || DEFAULT_THEME);
    applyThemeClass(currentTheme || DEFAULT_THEME);
    slotManager.initialize(savedSettings.referenceImages || []);
    refreshPromptHighlight();
    applyBodyFont(savedSettings.bodyFont || DEFAULT_BODY_FONT);

    apiKeyInput.addEventListener('input', persistSettings);
    let isApiKeyVisible = false;

    const refreshApiKeyVisibility = () => {
        if (!apiKeyInput) return;
        apiKeyInput.type = isApiKeyVisible ? 'text' : 'password';
        if (apiKeyToggleBtn) {
            apiKeyToggleBtn.setAttribute('aria-pressed', String(isApiKeyVisible));
            apiKeyToggleBtn.setAttribute('aria-label', isApiKeyVisible ? 'Ẩn API key' : 'Hiện API key');
        }
        apiKeyEyeIcon?.classList.toggle('hidden', isApiKeyVisible);
        apiKeyEyeOffIcon?.classList.toggle('hidden', !isApiKeyVisible);
    };

    if (apiKeyToggleBtn) {
        apiKeyToggleBtn.addEventListener('click', () => {
            isApiKeyVisible = !isApiKeyVisible;
            refreshApiKeyVisibility();
        });
    }
    refreshApiKeyVisibility();
    promptInput.addEventListener('input', () => {
        refreshPromptHighlight();
        persistSettings();
    });
    promptInput.addEventListener('scroll', () => {
        if (!promptHighlight) return;
        promptHighlight.scrollTop = promptInput.scrollTop;
        promptHighlight.scrollLeft = promptInput.scrollLeft;
    });
    promptNoteInput.addEventListener('input', () => {
        refreshNoteHighlight();
        persistSettings();
    });
    promptNoteInput.addEventListener('scroll', () => {
        if (!noteHighlight) return;
        noteHighlight.scrollTop = promptNoteInput.scrollTop;
        noteHighlight.scrollLeft = promptNoteInput.scrollLeft;
    });
    aspectRatioInput.addEventListener('change', persistSettings);
    resolutionInput.addEventListener('change', persistSettings);
    if (bodyFontSelect) {
        bodyFontSelect.addEventListener('change', () => {
            applyBodyFont(bodyFontSelect.value);
            persistSettings();
        });
    }
    window.addEventListener('beforeunload', persistSettings);

    document.querySelectorAll('.field-action-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const action = btn.dataset.action;
            const target = btn.closest('.field-action-buttons')?.dataset.target;
            if (!action || !target) return;
            try {
                await handleFieldAction(action, target);
            } catch (err) {
                console.warn('Field action failed', err);
                alert('Không thể thực hiện thao tác clipboard. Vui lòng thử lại.');
            }
        });
    });

    const queueCounter = document.getElementById('queue-counter');
    const queueCountText = document.getElementById('queue-count-text');

    let generationQueue = [];
    let isProcessingQueue = false;
    let pendingRequests = 0; // Track requests waiting for backend response

    function updateQueueCounter() {
        // Count includes:
        // 1. Items waiting in queue
        // 2. Item currently being processed (isProcessingQueue)
        // 3. Items waiting for backend response (pendingRequests)
        const count = generationQueue.length + (isProcessingQueue ? 1 : 0) + pendingRequests;
        
        console.log('Queue counter update:', { 
            queue: generationQueue.length, 
            processing: isProcessingQueue, 
            pending: pendingRequests,
            total: count 
        });
        
        if (count > 0) {
            if (queueCounter) {
                queueCounter.classList.remove('hidden');
                queueCountText.textContent = count;
            }
        } else {
            if (queueCounter) {
                queueCounter.classList.add('hidden');
            }
        }
    }

    async function processNextInQueue() {
        if (generationQueue.length === 0) {
            isProcessingQueue = false;
            updateQueueCounter();
            return;
        }

        // Take task from queue FIRST, then update state
        const task = generationQueue.shift();
        isProcessingQueue = true;
        updateQueueCounter(); // Show counter immediately
        
        try {
            setViewState('loading');
            
            // Check if this task already has a result (immediate generation)
            if (task.immediateResult) {
                // Display the already-generated image
                displayImage(task.immediateResult.image, task.immediateResult.image_data);
                gallery.load();
            } else {
                // Need to generate the image
                const formData = buildGenerateFormData({
                    prompt: task.prompt,
                    note: task.note || '',
                    aspect_ratio: task.aspectRatio,
                    resolution: task.resolution,
                    api_key: task.apiKey,
                    model: task.model,
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
                } else if (data.queue && data.prompts && Array.isArray(data.prompts)) {
                    // Backend returned more items - add them to queue
                    console.log('Backend returned additional queue items:', data.prompts.length);
                    data.prompts.forEach(processedPrompt => {
                        generationQueue.push({
                            prompt: processedPrompt,
                            note: '',
                            aspectRatio: task.aspectRatio,
                            resolution: task.resolution,
                            apiKey: task.apiKey,
                            model: task.model,
                        });
                    });
                    updateQueueCounter();
                } else {
                    throw new Error('No image data received');
                }
            }
        } catch (error) {
            showError(error.message);
            // Wait a bit before next task if error
            await new Promise(resolve => setTimeout(resolve, 2000));
        } finally {
            // Process next task
            processNextInQueue();
        }
    }

    async function addToQueue() {
        const prompt = promptInput.value.trim();
        const note = promptNoteInput.value.trim();
        const aspectRatio = aspectRatioInput.value;
        const resolution = resolutionInput.value;
        const apiKey = apiKeyInput.value.trim();
        const selectedModel = apiModelSelect?.value || 'gemini-3-pro-image-preview';

        if (!apiKey) {
            openApiSettings();
            return;
        }

        if (!prompt) {
            showError('Please enter a prompt.');
            return;
        }

        // Show loading state if not already processing and this is the first request
        if (!isProcessingQueue && pendingRequests === 0) {
            setViewState('loading');
        }

        // Increment pending requests and update counter immediately
        pendingRequests++;
        updateQueueCounter();

        let fetchCompleted = false;

        try {
            const formData = buildGenerateFormData({
                prompt: prompt,
                note: note,
                aspect_ratio: aspectRatio,
                resolution: resolution,
                api_key: apiKey,
                model: selectedModel,
            });

            const response = await fetch('/generate', {
                method: 'POST',
                body: formData,
            });

            const data = await response.json();
            
            // Mark fetch as completed and decrement pending
            // We do this BEFORE adding to queue to avoid double counting
            fetchCompleted = true;
            pendingRequests--;

            if (!response.ok) {
                throw new Error(data.error || 'Failed to generate image');
            }

            // Check if backend returned a queue
            if (data.queue && data.prompts && Array.isArray(data.prompts)) {
                console.log('Backend returned queue with', data.prompts.length, 'prompts');
                // Add all prompts to the queue
                data.prompts.forEach(processedPrompt => {
                    generationQueue.push({
                        prompt: processedPrompt,
                        note: '',
                        aspectRatio,
                        resolution,
                        apiKey,
                        model: selectedModel,
                    });
                });
            } else if (data.image) {
                console.log('Backend returned single image');
                // Single image - add to queue for consistent processing
                generationQueue.push({
                    prompt: prompt,
                    note: note,
                    aspectRatio,
                    resolution,
                    apiKey,
                    model: selectedModel,
                    immediateResult: {
                        image: data.image,
                        image_data: data.image_data
                    }
                });
            } else {
                throw new Error('Unexpected response from server');
            }

            // Update counter after adding to queue
            updateQueueCounter();

            // Start processing queue only if not already processing
            if (!isProcessingQueue) {
                console.log('Starting queue processing');
                processNextInQueue();
            } else {
                console.log('Already processing, item added to queue');
            }
        } catch (error) {
            console.error('Error in addToQueue:', error);
            
            // If fetch failed (didn't complete), we need to decrement pendingRequests
            if (!fetchCompleted) {
                pendingRequests--;
            }
            
            updateQueueCounter();
            showError(error.message);
        }
    }

    generateBtn.addEventListener('click', () => {
        addToQueue();
    });

    document.addEventListener('keydown', handleGenerateShortcut);
    document.addEventListener('keydown', handleResetShortcut);
    document.addEventListener('keydown', handleDownloadShortcut);
    document.addEventListener('keydown', handleTemplateShortcut);

    // Fix for download issue: use fetch/blob to force download
    if (downloadLink) {
        downloadLink.addEventListener('click', async (event) => {
            event.preventDefault();
            const url = downloadLink.href;
            const filename = downloadLink.getAttribute('download') || 'image.png';

            try {
                const response = await fetch(url);
                const blob = await response.blob();
                const blobUrl = window.URL.createObjectURL(blob);
                
                const tempLink = document.createElement('a');
                tempLink.href = blobUrl;
                tempLink.download = filename;
                document.body.appendChild(tempLink);
                tempLink.click();
                document.body.removeChild(tempLink);
                window.URL.revokeObjectURL(blobUrl);
            } catch (error) {
                console.error('Download failed:', error);
                window.open(url, '_blank');
            }
        });
    }

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

    // Refine Prompt Logic
    if (refinePromptBtn) {
        refinePromptBtn.addEventListener('click', () => {
            refineInstructionInput.value = ''; // Clear previous instruction
            refineModal.classList.remove('hidden');
            refineInstructionInput.focus();
        });
    }

    if (closeRefineModalBtn) {
        closeRefineModalBtn.addEventListener('click', () => {
            refineModal.classList.add('hidden');
        });
    }

    // Close modal when clicking outside
    if (refineModal) {
        refineModal.addEventListener('click', (e) => {
            if (e.target === refineModal) {
                refineModal.classList.add('hidden');
            }
        });
    }

    const refineLoading = document.getElementById('refine-loading');

    if (confirmRefineBtn && refineLoading) {
        confirmRefineBtn.addEventListener('click', async () => {
            const instruction = refineInstructionInput.value.trim();
            const currentPrompt = promptInput.value.trim();
            const apiKey = apiKeyInput.value.trim();

            if (!instruction) return;
            if (!apiKey) {
                alert('Please enter your API Key first.');
                return;
            }

            // Show loading state
            confirmRefineBtn.classList.add('hidden');
            refineLoading.classList.remove('hidden');

            try {
                const response = await fetch('/refine_prompt', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        current_prompt: currentPrompt,
                        instruction: instruction,
                        api_key: apiKey
                    }),
                });

                const data = await response.json();

                if (data.error) {
                    throw new Error(data.error);
                }

                if (data.refined_prompt) {
                    promptInput.value = data.refined_prompt;
                    refreshPromptHighlight();
                    persistSettings(); // Save the new prompt
                    refineModal.classList.add('hidden');
                }
            } catch (error) {
                alert('Failed to refine prompt: ' + error.message);
            } finally {
                // Reset state
                confirmRefineBtn.classList.remove('hidden');
                refineLoading.classList.add('hidden');
            }
        });
    }

    // Create Template Logic
    const createTemplateBtn = document.getElementById('create-template-btn');
    const createTemplateModal = document.getElementById('create-template-modal');
    const closeTemplateModalBtn = document.getElementById('close-template-modal');
    const saveTemplateBtn = document.getElementById('save-template-btn');
    
    const templateTitleInput = document.getElementById('template-title');
    const templatePromptInput = document.getElementById('template-prompt');
    const templateNoteInput = document.getElementById('template-note');
    const templateModeSelect = document.getElementById('template-mode');
    const templateCategorySelect = document.getElementById('template-category-select');
    const templateCategoryInput = document.getElementById('template-category-input');
    const templatePreviewDropzone = document.getElementById('template-preview-dropzone');
    const templatePreviewImg = document.getElementById('template-preview-img');
    const dropzonePlaceholder = document.querySelector('.dropzone-placeholder');
    const templateTagList = document.getElementById('template-tag-list');
    const templateTagInput = document.getElementById('template-tags-input');

    let currentPreviewFile = null;
    let currentPreviewUrl = null;
    let editingTemplate = null; // Track if we're editing an existing template
    let editingTemplateSource = null;
    let editingBuiltinIndex = null;
    const TEMPLATE_TAG_LIMIT = 8;
    let templateTags = [];

    const TEMPLATE_PREVIEW_MAX_DIMENSION = 1024;
    const TEMPLATE_PREVIEW_QUALITY = 0.85;

    function getExtensionFromMime(mime) {
        if (!mime) return 'png';
        const normalized = mime.toLowerCase();
        if (normalized.includes('jpeg') || normalized.includes('jpg')) {
            return 'jpg';
        }
        if (normalized.includes('webp')) {
            return 'webp';
        }
        if (normalized.includes('png')) {
            return 'png';
        }
        return 'png';
    }

    function ensurePreviewFileName(original, mimeType) {
        const baseName = (original || 'preview').replace(/\.[^.]+$/, '');
        const extension = getExtensionFromMime(mimeType);
        return `${baseName}.${extension}`;
    }

    function loadImageFromFile(file) {
        return new Promise((resolve, reject) => {
            const objectUrl = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
                URL.revokeObjectURL(objectUrl);
                resolve(img);
            };
            img.onerror = (err) => {
                URL.revokeObjectURL(objectUrl);
                reject(err);
            };
            img.src = objectUrl;
        });
    }

    async function getImageBitmapFromFile(file) {
        if (window.createImageBitmap) {
            try {
                return await createImageBitmap(file);
            } catch (error) {
                console.warn('createImageBitmap failed, falling back to Image element', error);
            }
        }
        return loadImageFromFile(file);
    }

    function canvasToBlob(canvas, type, quality) {
        return new Promise((resolve, reject) => {
            canvas.toBlob((blob) => {
                if (blob) {
                    resolve(blob);
                } else {
                    reject(new Error('Canvas toBlob returned null'));
                }
            }, type, quality);
        });
    }

    async function compressPreviewFileForUpload(file) {
        if (!file || !file.type || !file.type.startsWith('image/')) {
            return { blob: file, filename: file?.name || 'preview.png' };
        }

        try {
            const bitmap = await getImageBitmapFromFile(file);
            const bitmapWidth = typeof bitmap.width === 'number' && bitmap.width > 0 ? bitmap.width : (bitmap.naturalWidth || 0);
            const bitmapHeight = typeof bitmap.height === 'number' && bitmap.height > 0 ? bitmap.height : (bitmap.naturalHeight || 0);
            if (!bitmapWidth || !bitmapHeight) {
                throw new Error('Invalid image dimensions');
            }

            const maxSide = Math.max(bitmapWidth, bitmapHeight);
            const scale = maxSide > TEMPLATE_PREVIEW_MAX_DIMENSION ? TEMPLATE_PREVIEW_MAX_DIMENSION / maxSide : 1;
            const targetWidth = Math.max(1, Math.round(bitmapWidth * scale));
            const targetHeight = Math.max(1, Math.round(bitmapHeight * scale));

            const canvas = document.createElement('canvas');
            canvas.width = targetWidth;
            canvas.height = targetHeight;

            const ctx = canvas.getContext('2d');
            if (!ctx) {
                throw new Error('Unable to create canvas context');
            }
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);

            if (bitmap.close) {
                bitmap.close();
            }

            let targetType = file.type.toLowerCase();
            if (!targetType.startsWith('image/')) {
                targetType = 'image/png';
            }

            let blob;
            const quality = targetType === 'image/png' ? undefined : TEMPLATE_PREVIEW_QUALITY;
            try {
                blob = await canvasToBlob(canvas, targetType, quality);
            } catch (error) {
                if (targetType !== 'image/png') {
                    targetType = 'image/png';
                    blob = await canvasToBlob(canvas, targetType);
                } else {
                    throw error;
                }
            }

            const filename = ensurePreviewFileName(file.name, targetType);
            return { blob, filename };
        } catch (error) {
            console.warn('Failed to compress template preview, falling back to original file', error);
            return { blob: file, filename: file.name || 'preview.png' };
        }
    }

    function normalizeRawTags(raw) {
        if (!raw) return [];
        if (Array.isArray(raw)) {
            return raw.map(tag => typeof tag === 'string' ? tag.trim() : '').filter(Boolean);
        }
        if (typeof raw === 'string') {
            return raw.split(',').map(tag => tag.trim()).filter(Boolean);
        }
        return [];
    }

    function renderTemplateTags() {
        if (!templateTagList) return;
        templateTagList.innerHTML = '';
        templateTags.forEach(tag => {
            const chip = document.createElement('span');
            chip.className = 'template-tag-chip';

            const textSpan = document.createElement('span');
            textSpan.className = 'template-tag-chip-text';
            textSpan.textContent = tag;
            chip.appendChild(textSpan);

            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'template-tag-remove';
            removeBtn.setAttribute('aria-label', `Remove ${tag}`);
            removeBtn.innerHTML = '&times;';
            removeBtn.addEventListener('click', () => {
                removeTemplateTag(tag);
            });
            chip.appendChild(removeBtn);

            templateTagList.appendChild(chip);
        });
    }

    function setTemplateTags(raw) {
        const normalized = normalizeRawTags(raw);
        templateTags = normalized.slice(0, TEMPLATE_TAG_LIMIT);
        renderTemplateTags();
    }

    function addTemplateTag(value) {
        if (!value) return;
        const normalized = value.trim();
        if (!normalized || templateTags.length >= TEMPLATE_TAG_LIMIT) return;
        const exists = templateTags.some(tag => tag.toLowerCase() === normalized.toLowerCase());
        if (exists) return;
        templateTags = [...templateTags, normalized];
        renderTemplateTags();
    }

    function removeTemplateTag(tagToRemove) {
        templateTags = templateTags.filter(tag => tag.toLowerCase() !== tagToRemove.toLowerCase());
        renderTemplateTags();
    }

    function flushTemplateTagInput() {
        if (!templateTagInput) return;
        const raw = templateTagInput.value;
        if (!raw.trim()) return;
        const parts = raw.split(',').map(part => part.trim()).filter(Boolean);
        parts.forEach(part => addTemplateTag(part));
        templateTagInput.value = '';
    }

    if (templateTagInput) {
        templateTagInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ',') {
                event.preventDefault();
                flushTemplateTagInput();
            }
        });
        templateTagInput.addEventListener('blur', () => {
            flushTemplateTagInput();
        });
    }

    // Global function for opening edit modal (called from templateGallery.js)
    window.openEditTemplateModal = async function(template) {
        editingTemplate = template;
        editingTemplateSource = template.isUserTemplate ? 'user' : 'builtin';
        editingBuiltinIndex = editingTemplateSource === 'builtin' ? template.builtinTemplateIndex : null;
        
        // Pre-fill with template data
        templateTitleInput.value = template.title || '';
        templatePromptInput.value = template.prompt || '';
        templateNoteInput.value = i18n.getText(template.note) || '';
        templateModeSelect.value = template.mode || 'generate';
        templateCategoryInput.classList.add('hidden');
        templateCategoryInput.value = '';

        // Populate categories
        try {
            const response = await fetch('/prompts');
            const data = await response.json();
            
            if (data.prompts) {
                const categories = new Set();
                data.prompts.forEach(t => {
                    if (t.category) {
                        const categoryText = typeof t.category === 'string' 
                            ? t.category 
                            : (t.category.vi || t.category.en || '');
                        if (categoryText) categories.add(categoryText);
                    }
                });
                
                templateCategorySelect.innerHTML = '';
                const sortedCategories = Array.from(categories).sort();
                sortedCategories.forEach(cat => {
                    const option = document.createElement('option');
                    option.value = cat;
                    option.textContent = cat;
                    templateCategorySelect.appendChild(option);
                });
                
                const newOption = document.createElement('option');
                newOption.value = 'new';
                newOption.textContent = '+ New Category';
                templateCategorySelect.appendChild(newOption);
                
                // Set to template's category
                const templateCategory = typeof template.category === 'string' 
                    ? template.category 
                    : (template.category.vi || template.category.en || '');
                templateCategorySelect.value = templateCategory || 'User';
            }
        } catch (error) {
            console.error('Failed to load categories:', error);
        }

        // Set preview image
        if (template.preview) {
            templatePreviewImg.src = template.preview;
            templatePreviewImg.classList.remove('hidden');
            dropzonePlaceholder.classList.add('hidden');
            currentPreviewUrl = template.preview;
        } else {
            templatePreviewImg.src = '';
            templatePreviewImg.classList.add('hidden');
            dropzonePlaceholder.classList.remove('hidden');
            currentPreviewUrl = null;
        }
        currentPreviewFile = null;

        setTemplateTags(template.tags || []);
        if (templateTagInput) {
            templateTagInput.value = '';
        }

        // Update button text
        saveTemplateBtn.innerHTML = '<span>Update Template</span><div class="btn-shine"></div>';
        
        createTemplateModal.classList.remove('hidden');
    };

    // Global function for opening create modal with empty values (called from templateGallery.js)
    window.openCreateTemplateModal = async function() {
        editingTemplate = null;
        editingTemplateSource = 'user';
        editingBuiltinIndex = null;
        
        setTemplateTags([]);
        if (templateTagInput) {
            templateTagInput.value = '';
        }

        // Clear all fields
        templateTitleInput.value = '';
        templatePromptInput.value = '';
        templateNoteInput.value = promptNoteInput.value || '';
        templateModeSelect.value = 'generate';
        templateCategoryInput.classList.add('hidden');
        templateCategoryInput.value = '';

        // Populate categories
        try {
            const response = await fetch('/prompts');
            const data = await response.json();
            
            if (data.prompts) {
                const categories = new Set();
                data.prompts.forEach(t => {
                    if (t.category) {
                        const categoryText = typeof t.category === 'string' 
                            ? t.category 
                            : (t.category.vi || t.category.en || '');
                        if (categoryText) categories.add(categoryText);
                    }
                });
                
                templateCategorySelect.innerHTML = '';
                const sortedCategories = Array.from(categories).sort();
                sortedCategories.forEach(cat => {
                    const option = document.createElement('option');
                    option.value = cat;
                    option.textContent = cat;
                    templateCategorySelect.appendChild(option);
                });
                
                const newOption = document.createElement('option');
                newOption.value = 'new';
                newOption.textContent = '+ New Category';
                templateCategorySelect.appendChild(newOption);
                
                if (sortedCategories.includes('User')) {
                    templateCategorySelect.value = 'User';
                } else if (sortedCategories.length > 0) {
                    templateCategorySelect.value = sortedCategories[0];
                }
            }
        } catch (error) {
            console.error('Failed to load categories:', error);
        }

        // Clear preview image
        templatePreviewImg.src = '';
        templatePreviewImg.classList.add('hidden');
        dropzonePlaceholder.classList.remove('hidden');
        currentPreviewUrl = null;
        currentPreviewFile = null;

        // Update button text
        saveTemplateBtn.innerHTML = '<span>Save Template</span><div class="btn-shine"></div>';
        
        createTemplateModal.classList.remove('hidden');
    };

    if (createTemplateBtn) {
        createTemplateBtn.addEventListener('click', async () => {
            // Reset editing state
            editingTemplate = null;
            editingTemplateSource = 'user';
            editingBuiltinIndex = null;
            
            // Pre-fill data
            templateTitleInput.value = '';
            templatePromptInput.value = promptInput.value;
            templateNoteInput.value = promptNoteInput.value || '';
            templateModeSelect.value = 'generate';
            templateCategoryInput.classList.add('hidden');
            templateCategoryInput.value = '';

            // Populate categories dynamically from template library
            try {
                const response = await fetch('/prompts');
                const data = await response.json();
                
                if (data.prompts) {
                    // Extract unique categories
                    const categories = new Set();
                    data.prompts.forEach(template => {
                        if (template.category) {
                            // Handle both string and object categories
                            const categoryText = typeof template.category === 'string' 
                                ? template.category 
                                : (template.category.vi || template.category.en || '');
                            if (categoryText) {
                                categories.add(categoryText);
                            }
                        }
                    });
                    
                    // Clear existing options except "new"
                    templateCategorySelect.innerHTML = '';
                    
                    // Add sorted categories
                    const sortedCategories = Array.from(categories).sort();
                    sortedCategories.forEach(cat => {
                        const option = document.createElement('option');
                        option.value = cat;
                        option.textContent = cat;
                        templateCategorySelect.appendChild(option);
                    });
                    
                    // Add "new category" option at the end
                    const newOption = document.createElement('option');
                    newOption.value = 'new';
                    newOption.textContent = '+ New Category';
                    templateCategorySelect.appendChild(newOption);
                    
                    // Set default to first category or "User" if it exists
                    if (sortedCategories.includes('User')) {
                        templateCategorySelect.value = 'User';
                    } else if (sortedCategories.length > 0) {
                        templateCategorySelect.value = sortedCategories[0];
                    }
                }
            } catch (error) {
                console.error('Failed to load categories:', error);
                // Fallback to default categories
                templateCategorySelect.innerHTML = `
                    <option value="User">User</option>
                    <option value="new">+ New Category</option>
                `;
                templateCategorySelect.value = 'User';
            }

            // Set preview image from current generated image
            if (generatedImage.src && !generatedImage.src.endsWith('placeholder.png')) {
                templatePreviewImg.src = generatedImage.src;
                templatePreviewImg.classList.remove('hidden');
                dropzonePlaceholder.classList.add('hidden');
                currentPreviewUrl = generatedImage.src;
            } else {
                templatePreviewImg.src = '';
                templatePreviewImg.classList.add('hidden');
                dropzonePlaceholder.classList.remove('hidden');
                currentPreviewUrl = null;
            }
            currentPreviewFile = null;

            setTemplateTags([]);
            if (templateTagInput) {
                templateTagInput.value = '';
            }

            // Update button text
            saveTemplateBtn.innerHTML = '<span>Save Template</span><div class="btn-shine"></div>';

            createTemplateModal.classList.remove('hidden');
        });
    }

    if (closeTemplateModalBtn) {
        closeTemplateModalBtn.addEventListener('click', () => {
            createTemplateModal.classList.add('hidden');
            editingTemplate = null;
            editingTemplateSource = null;
            editingBuiltinIndex = null;
        });
    }

    // Category select logic
    if (templateCategorySelect) {
        templateCategorySelect.addEventListener('change', (e) => {
            if (e.target.value === 'new') {
                templateCategoryInput.classList.remove('hidden');
                templateCategoryInput.focus();
            } else {
                templateCategoryInput.classList.add('hidden');
            }
        });
    }

    // Drag and drop for preview
    const templatePreviewUrlInput = document.getElementById('template-preview-url');
    let isUrlInputMode = false;

    if (templatePreviewDropzone) {
        // Click to toggle URL input mode
        templatePreviewDropzone.addEventListener('click', (e) => {
            // Don't toggle if clicking on the input itself
            if (e.target === templatePreviewUrlInput) return;
            
            if (!isUrlInputMode) {
                // Switch to URL input mode
                isUrlInputMode = true;
                templatePreviewImg.classList.add('hidden');
                dropzonePlaceholder.classList.add('hidden');
                templatePreviewUrlInput.classList.remove('hidden');
                templatePreviewUrlInput.focus();
            }
        });

        // Handle URL input
        if (templatePreviewUrlInput) {
            templatePreviewUrlInput.addEventListener('blur', async () => {
                const url = templatePreviewUrlInput.value.trim();
                if (url) {
                    try {
                        // Try to load the image from URL
                        const img = new Image();
                        img.onload = () => {
                            templatePreviewImg.src = url;
                            templatePreviewImg.classList.remove('hidden');
                            dropzonePlaceholder.classList.add('hidden');
                            templatePreviewUrlInput.classList.add('hidden');
                            currentPreviewUrl = url;
                            currentPreviewFile = null;
                            isUrlInputMode = false;
                        };
                        img.onerror = () => {
                            alert('Failed to load image from URL. Please check the URL and try again.');
                            templatePreviewUrlInput.focus();
                        };
                        img.src = url;
                    } catch (error) {
                        alert('Invalid image URL');
                        templatePreviewUrlInput.focus();
                    }
                } else {
                    // If empty, go back to placeholder
                    isUrlInputMode = false;
                    templatePreviewUrlInput.classList.add('hidden');
                    dropzonePlaceholder.classList.remove('hidden');
                }
            });

            templatePreviewUrlInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    templatePreviewUrlInput.blur();
                } else if (e.key === 'Escape') {
                    templatePreviewUrlInput.value = '';
                    templatePreviewUrlInput.blur();
                }
            });
        }
        
        templatePreviewDropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            templatePreviewDropzone.classList.add('drag-over');
        });

        templatePreviewDropzone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            templatePreviewDropzone.classList.remove('drag-over');
        });

        templatePreviewDropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            templatePreviewDropzone.classList.remove('drag-over');
            
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                const file = files[0];
                if (file.type.startsWith('image/')) {
                    currentPreviewFile = file;
                    const objectUrl = URL.createObjectURL(file);
                    templatePreviewImg.src = objectUrl;
                    templatePreviewImg.classList.remove('hidden');
                    dropzonePlaceholder.classList.add('hidden');
                    templatePreviewUrlInput.classList.add('hidden');
                    isUrlInputMode = false;
                }
            }
        });
    }

    // Save template
    if (saveTemplateBtn) {
        saveTemplateBtn.addEventListener('click', async () => {
            const title = templateTitleInput.value.trim();
            const prompt = templatePromptInput.value.trim();
            const note = templateNoteInput.value.trim();
            const mode = templateModeSelect.value;
            let category = templateCategorySelect.value;
            
            if (category === 'new') {
                category = templateCategoryInput.value.trim();
            }

            if (!title) {
                alert('Please enter a title for the template.');
                return;
            }
            if (!prompt) {
                alert('Please enter a prompt.');
                return;
            }
            if (!category) {
                alert('Please select or enter a category.');
                return;
            }

            saveTemplateBtn.disabled = true;
            saveTemplateBtn.textContent = editingTemplate ? 'Updating...' : 'Saving...';

            try {
                const formData = new FormData();
                formData.append('title', title);
                formData.append('prompt', prompt);
                formData.append('note', note);
                formData.append('mode', mode);
                formData.append('category', category);
                formData.append('tags', JSON.stringify(templateTags));

                if (currentPreviewFile) {
                    const previewPayload = await compressPreviewFileForUpload(currentPreviewFile);
                    formData.append('preview', previewPayload.blob, previewPayload.filename);
                } else if (currentPreviewUrl) {
                    formData.append('preview_path', currentPreviewUrl);
                }

                // If editing, add the template index
                const endpoint = editingTemplate ? '/update_template' : '/save_template';
                if (editingTemplate) {
                    if (editingTemplateSource === 'user') {
                        formData.append('template_index', editingTemplate.userTemplateIndex);
                    } else if (editingTemplateSource === 'builtin' && editingBuiltinIndex !== null) {
                        formData.append('builtin_index', editingBuiltinIndex);
                    }
                }

                const response = await fetch(endpoint, {
                    method: 'POST',
                    body: formData
                });

                const data = await response.json();

                if (data.error) {
                    throw new Error(data.error);
                }

                // Success
                createTemplateModal.classList.add('hidden');
                
                // Reload template gallery
                await templateGallery.load();
                
                // Reset editing state
                editingTemplate = null;
                editingTemplateSource = null;
                editingBuiltinIndex = null;

            } catch (error) {
                alert(`Failed to ${editingTemplate ? 'update' : 'save'} template: ` + error.message);
            } finally {
                saveTemplateBtn.disabled = false;
                saveTemplateBtn.innerHTML = '<span>Save Template</span><div class="btn-shine"></div>';
            }
        });
    }

    // Close modal when clicking outside
    if (createTemplateModal) {
        createTemplateModal.addEventListener('click', (e) => {
            if (e.target === createTemplateModal) {
                createTemplateModal.classList.add('hidden');
                editingTemplate = null;
                editingTemplateSource = null;
                editingBuiltinIndex = null;
            }
        });
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
    loadTemplateGallery();
    initializeSidebarResizer(sidebar, resizeHandle);
    
    // Restore last image if available
    try {
        const lastImage = localStorage.getItem('gemini-app-last-image');
        if (lastImage) {
            displayImage(lastImage);
        }
    } catch (e) {
        console.warn('Failed to restore last image', e);
    }
    
    // Setup canvas language toggle
    const canvasLangInput = document.getElementById('canvas-lang-input');
    if (canvasLangInput) {
        // Set initial state
        canvasLangInput.checked = i18n.currentLang === 'en';
        
        canvasLangInput.addEventListener('change', (e) => {
            i18n.setLanguage(e.target.checked ? 'en' : 'vi');
            // Update visual state
            const options = document.querySelectorAll('.canvas-lang-option');
            options.forEach(opt => {
                const isActive = opt.dataset.lang === i18n.currentLang;
                opt.classList.toggle('active', isActive);
            });
            // Reload template gallery with new language
            templateGallery.render();
        });
    }

    // Setup history filter buttons
    const historyFilterBtns = document.querySelectorAll('.history-filter-btn');
    const historyFavoritesBtn = document.querySelector('.history-favorites-btn');
    const historySourceBtns = document.querySelectorAll('.history-source-btn');
    const initialSource = gallery.getCurrentSource ? gallery.getCurrentSource() : 'generated';

    historySourceBtns.forEach(btn => {
        const isActive = btn.dataset.source === initialSource;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-pressed', String(isActive));

        btn.addEventListener('click', async () => {
            const targetSource = btn.dataset.source || 'generated';
            historySourceBtns.forEach(b => {
                const active = b === btn;
                b.classList.toggle('active', active);
                b.setAttribute('aria-pressed', String(active));
            });
            await gallery.setSource(targetSource, { resetFilters: true });

            // Reset filters UI to show all when switching source
            historyFilterBtns.forEach(b => {
                if (!b.classList.contains('history-favorites-btn')) {
                    b.classList.toggle('active', b.dataset.filter === 'all');
                }
            });

            // Disable favorites toggle on source change
            if (historyFavoritesBtn) {
                historyFavoritesBtn.classList.remove('active');
            }
            if (gallery.setFavoritesActive) {
                gallery.setFavoritesActive(false);
            }

            // Clear search box
            const historySearchInputEl = document.getElementById('history-search-input');
            if (historySearchInputEl) {
                historySearchInputEl.value = '';
            }
            if (gallery.setSearchQuery) {
                gallery.setSearchQuery('');
            }
        });
    });

    // Set initial active state based on saved filter
    const currentFilter = gallery.getCurrentFilter();
    historyFilterBtns.forEach(btn => {
        if (btn.dataset.filter === currentFilter && !btn.classList.contains('history-favorites-btn')) {
            btn.classList.add('active');
        }
    });

    // Handle favorites button as toggle
    if (historyFavoritesBtn) {
        historyFavoritesBtn.addEventListener('click', () => {
            const isActive = gallery.toggleFavorites();
            historyFavoritesBtn.classList.toggle('active', isActive);
        });
    }

    // Handle date filter buttons
    historyFilterBtns.forEach(btn => {
        if (!btn.classList.contains('history-favorites-btn')) {
            btn.addEventListener('click', () => {
                const filterType = btn.dataset.filter;
                
                // Remove active from all date filter buttons (not favorites)
                historyFilterBtns.forEach(b => {
                    if (!b.classList.contains('history-favorites-btn')) {
                        b.classList.remove('active');
                    }
                });
                btn.classList.add('active');
                gallery.setFilter(filterType);
            });
        }
    });
    const historySearchInput = document.getElementById('history-search-input');
    if (historySearchInput) {
        // Set initial value from saved search
        historySearchInput.value = gallery.getSearchQuery();

        // Search on input with debounce
        let searchTimeout;
        historySearchInput.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                gallery.setSearch(e.target.value);
            }, 300); // 300ms debounce
        });
    }


    function setViewState(state) {
        placeholderState.classList.add('hidden');
        loadingState.classList.add('hidden');
        errorState.classList.add('hidden');
        templateGalleryState.classList.add('hidden');
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
            case 'template-gallery':
                templateGalleryState.classList.remove('hidden');
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

        hasGeneratedImage = true; // Mark that we have an image
        setViewState('result');
        
        // Persist image URL
        try {
            localStorage.setItem('gemini-app-last-image', imageUrl);
        } catch (e) {
            console.warn('Failed to save last image URL', e);
        }
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
        if (metadata.prompt) {
            promptInput.value = metadata.prompt;
            refreshPromptHighlight();
        }
        
        // If metadata doesn't have 'note' field, set to empty string instead of keeping current value
        if (metadata.hasOwnProperty('note')) {
            promptNoteInput.value = metadata.note || '';
        } else {
            promptNoteInput.value = '';
        }
        refreshNoteHighlight();
        
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

    async function loadTemplateGallery() {
        try {
            await templateGallery.load();
            // Don't auto-show template gallery - let user trigger it
            // Default view will be placeholder or template gallery based on state
            if (!hasGeneratedImage) {
                setViewState('template-gallery');
            }
        } catch (error) {
            console.error('Unable to load template gallery', error);
        }
    }

    function initializeSidebarResizer(sidebar, handle) {
        if (!sidebar || !handle) return;
        const resizerQuery = window.matchMedia('(min-width: 1025px)');
        let resizerCleanup = null;

        const toggleResizer = () => {
            if (resizerQuery.matches) {
                if (!resizerCleanup) {
                    resizerCleanup = setupSidebarResizer(sidebar, handle);
                }
            } else if (resizerCleanup) {
                resizerCleanup();
                resizerCleanup = null;
                sidebar.style.width = '';
            }
        };

        toggleResizer();
        if (typeof resizerQuery.addEventListener === 'function') {
            resizerQuery.addEventListener('change', toggleResizer);
        }
        if (typeof resizerQuery.addListener === 'function') {
            resizerQuery.addListener(toggleResizer);
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

    function handleTemplateShortcut(event) {
        if (event.key.toLowerCase() !== 't') return;
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        const targetTag = event.target?.tagName;
        if (targetTag && ['INPUT', 'TEXTAREA', 'SELECT'].includes(targetTag)) return;
        if (event.target?.isContentEditable) return;
        
        event.preventDefault();
        
        // Toggle template gallery
        if (templateGalleryState.classList.contains('hidden')) {
            setViewState('template-gallery');
        } else {
            // If we have a generated image, go back to result
            if (hasGeneratedImage) {
                setViewState('result');
            } else {
                // Otherwise go to placeholder
                setViewState('placeholder');
            }
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
            case 'toggle-template':
                // Toggle between result and template gallery
                if (resultState.classList.contains('hidden')) {
                    setViewState('result');
                } else {
                    setViewState('template-gallery');
                }
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
        if (!sidebar || !handle) return null;
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

        const onPointerDown = (event) => {
            isResizing = true;
            activePointerId = event.pointerId;
            handle.setPointerCapture(activePointerId);
            document.body.style.cursor = 'ew-resize';
            event.preventDefault();
        };

        const onPointerMove = (event) => {
            if (!isResizing) return;
            updateWidth(event.clientX);
        };

        handle.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('pointermove', onPointerMove);
        document.addEventListener('pointerup', stopResize);
        document.addEventListener('pointercancel', stopResize);

        return () => {
            stopResize();
            handle.removeEventListener('pointerdown', onPointerDown);
            document.removeEventListener('pointermove', onPointerMove);
            document.removeEventListener('pointerup', stopResize);
            document.removeEventListener('pointercancel', stopResize);
        };
    }

});
