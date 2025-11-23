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
