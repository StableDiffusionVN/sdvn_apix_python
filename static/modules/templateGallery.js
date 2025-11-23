/**
 * Template Gallery Module
 * Displays prompt templates from prompts.json as selectable cards
 */

import { i18n } from './i18n.js';

export function createTemplateGallery({ container, onSelectTemplate }) {
    let allTemplates = [];
    let currentCategory = 'all';
    let currentMode = 'all';
    let searchQuery = '';

    /**
     * Fetch templates from API
     */
    async function load() {
        try {
            const response = await fetch('/prompts');
            const data = await response.json();
            
            if (data.prompts) {
                allTemplates = data.prompts;
                render();
                return true;
            }
            return false;
        } catch (error) {
            console.error('Failed to load templates:', error);
            return false;
        }
    }

    /**
     * Get unique categories from templates
     */
    function getCategories() {
        const categories = new Set();
        allTemplates.forEach(t => {
            if (t.category) {
                const categoryText = i18n.getText(t.category);
                if (categoryText) categories.add(categoryText);
            }
        });
        return Array.from(categories).sort();
    }

    /**
     * Filter templates based on category and search
     */
    function filterTemplates() {
        let filtered = allTemplates;

        // Filter by category
        if (currentCategory !== 'all') {
            filtered = filtered.filter(t => {
                const categoryText = i18n.getText(t.category);
                return categoryText === currentCategory;
            });
        }

        // Filter by mode
        if (currentMode !== 'all') {
            filtered = filtered.filter(t => {
                return (t.mode || 'generate') === currentMode;
            });
        }

        // Filter by search query
        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            filtered = filtered.filter(t => {
                const title = i18n.getText(t.title).toLowerCase();
                const prompt = i18n.getText(t.prompt).toLowerCase();
                const category = i18n.getText(t.category).toLowerCase();
                return title.includes(query) || 
                       prompt.includes(query) || 
                       category.includes(query);
            });
        }

        return filtered;
    }

    /**
     * Create a template card element
     */
    function createTemplateCard(template) {
        const card = document.createElement('div');
        card.className = 'template-card';
        card.setAttribute('data-category', i18n.getText(template.category) || '');
        card.setAttribute('data-mode', template.mode || 'generate');

        // Preview image
        const preview = document.createElement('div');
        preview.className = 'template-card-preview';
        if (template.preview) {
            const img = document.createElement('img');
            img.src = template.preview;
            img.alt = i18n.getText(template.title) || 'Template preview';
            img.loading = 'lazy';
            img.onerror = function() {
                this.onerror = null;
                this.src = '/static/eror.png';
            };
            preview.appendChild(img);
        }
        
        // Edit button (show on all templates)
        const editBtn = document.createElement('button');
        editBtn.className = 'template-edit-btn';
        editBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M11 4H4C3.46957 4 2.96086 4.21071 2.58579 4.58579C2.21071 4.96086 2 5.46957 2 6V20C2 20.5304 2.21071 21.0391 2.58579 21.4142C2.96086 21.7893 3.46957 22 4 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M18.5 2.50001C18.8978 2.10219 19.4374 1.87869 20 1.87869C20.5626 1.87869 21.1022 2.10219 21.5 2.50001C21.8978 2.89784 22.1213 3.43741 22.1213 4.00001C22.1213 4.56262 21.8978 5.10219 21.5 5.50001L12 15L8 16L9 12L18.5 2.50001Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        `;
        editBtn.title = 'Edit Template';
        editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (window.openEditTemplateModal) {
                window.openEditTemplateModal(template);
            }
        });
        preview.appendChild(editBtn);
        
        card.appendChild(preview);

        // Content
        const content = document.createElement('div');
        content.className = 'template-card-content';

        // Title
        const title = document.createElement('h4');
        title.className = 'template-card-title';
        title.textContent = i18n.getText(template.title) || 'Untitled Template';
        content.appendChild(title);

        card.appendChild(content);

        // Click handler
        card.addEventListener('click', () => {
            onSelectTemplate?.(template);
        });

        return card;
    }

    /**
     * Render the gallery
     */
    function render() {
        if (!container) return;

        const filtered = filterTemplates();
        const categories = getCategories();

        container.innerHTML = '';

        // Create header with controls
        const header = document.createElement('div');
        header.className = 'template-gallery-header';

        // Title
        const title = document.createElement('h2');
        title.className = 'template-gallery-title';
        title.textContent = i18n.t('promptTemplates');
        header.appendChild(title);

        // Controls container
        const controls = document.createElement('div');
        controls.className = 'template-gallery-controls';

        // Search input
        const searchContainer = document.createElement('div');
        searchContainer.className = 'template-search-container';
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.className = 'template-search-input';
        searchInput.placeholder = i18n.t('searchPlaceholder');
        searchInput.value = searchQuery;
        
        // Only search on Enter
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                searchQuery = e.target.value;
                render();
            }
        });
        
        // Also update on blur to ensure value is captured if user clicks away
        searchInput.addEventListener('blur', (e) => {
             if (searchQuery !== e.target.value) {
                searchQuery = e.target.value;
                render();
             }
        });

        searchContainer.appendChild(searchInput);
        controls.appendChild(searchContainer);

        // Mode filter
        const modeSelect = document.createElement('select');
        modeSelect.className = 'template-mode-select';
        
        const modes = [
            { value: 'all', label: 'All Modes' },
            { value: 'edit', label: 'Edit' },
            { value: 'generate', label: 'Generate' }
        ];

        modes.forEach(mode => {
            const option = document.createElement('option');
            option.value = mode.value;
            option.textContent = mode.label;
            modeSelect.appendChild(option);
        });

        modeSelect.value = currentMode;
        modeSelect.addEventListener('change', (e) => {
            currentMode = e.target.value;
            render();
        });
        controls.appendChild(modeSelect);

        // Category filter
        const categorySelect = document.createElement('select');
        categorySelect.className = 'template-category-select';
        
        const allOption = document.createElement('option');
        allOption.value = 'all';
        allOption.textContent = i18n.t('allCategories');
        categorySelect.appendChild(allOption);

        categories.forEach(cat => {
            const option = document.createElement('option');
            option.value = cat;
            option.textContent = cat;
            categorySelect.appendChild(option);
        });

        categorySelect.value = currentCategory;
        categorySelect.addEventListener('change', (e) => {
            currentCategory = e.target.value;
            render();
        });
        controls.appendChild(categorySelect);

        // Create Template button
        const createTemplateBtn = document.createElement('button');
        createTemplateBtn.className = 'template-create-btn';
        createTemplateBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 5V19M5 12H19" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span>Create Template</span>
        `;
        createTemplateBtn.addEventListener('click', () => {
            if (window.openCreateTemplateModal) {
                window.openCreateTemplateModal();
            }
        });
        controls.appendChild(createTemplateBtn);

        header.appendChild(controls);
        container.appendChild(header);

        // Results count
        const count = document.createElement('div');
        count.className = 'template-results-count';
        count.textContent = i18n.t('resultsCount', filtered.length);
        container.appendChild(count);

        // Create grid
        const grid = document.createElement('div');
        grid.className = 'template-card-grid';

        if (filtered.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'template-empty-state';
            empty.textContent = i18n.t('noResults');
            grid.appendChild(empty);
        } else {
            filtered.forEach(template => {
                grid.appendChild(createTemplateCard(template));
            });
        }

        container.appendChild(grid);
    }

    /**
     * Show the gallery
     */
    function show() {
        if (container) {
            container.classList.remove('hidden');
        }
    }

    /**
     * Hide the gallery
     */
    function hide() {
        if (container) {
            container.classList.add('hidden');
        }
    }

    return {
        load,
        render,
        show,
        hide
    };
}
