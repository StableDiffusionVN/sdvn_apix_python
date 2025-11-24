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
    const openApiSettingsBtn = document.getElementById('open-api-settings-btn');
    const apiSettingsOverlay = document.getElementById('api-settings-overlay');
    const apiSettingsCloseBtn = document.getElementById('api-settings-close');
    const saveApiSettingsBtn = document.getElementById('save-api-settings-btn');
    const apiKeyToggleBtn = document.getElementById('toggle-api-key-visibility');
    const apiKeyEyeIcon = apiKeyToggleBtn?.querySelector('.icon-eye');
    const apiKeyEyeOffIcon = apiKeyToggleBtn?.querySelector('.icon-eye-off');

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
            }
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
    slotManager.initialize(savedSettings.referenceImages || []);

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
    promptInput.addEventListener('input', persistSettings);
    aspectRatioInput.addEventListener('change', persistSettings);
    resolutionInput.addEventListener('change', persistSettings);

    generateBtn.addEventListener('click', async () => {
        const prompt = promptInput.value.trim();
        const aspectRatio = aspectRatioInput.value;
        const resolution = resolutionInput.value;
        const apiKey = apiKeyInput.value.trim();

        if (!apiKey) {
            openApiSettings();
            return;
        }

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
    document.addEventListener('keydown', handleTemplateShortcut);

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
                formData.append('mode', mode);
                formData.append('category', category);
                formData.append('tags', JSON.stringify(templateTags));

                if (currentPreviewFile) {
                    formData.append('preview', currentPreviewFile);
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
