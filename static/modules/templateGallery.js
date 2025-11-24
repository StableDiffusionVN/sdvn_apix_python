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
    let favoriteTemplateKeys = new Set();
    let favoriteFilterActive = false;
    let userTemplateFilterActive = false;

    function setFavoriteKeys(keys) {
        if (Array.isArray(keys)) {
            favoriteTemplateKeys = new Set(keys.filter(Boolean));
        } else {
            favoriteTemplateKeys = new Set();
        }
    }

    function getTemplateKey(template) {
        if (!template) return '';
        if (template.userTemplateIndex !== undefined && template.userTemplateIndex !== null) {
            return `user-${template.userTemplateIndex}`;
        }

        const title = i18n.getText(template.title);
        const promptText = i18n.getText(template.prompt);
        const categoryText = i18n.getText(template.category);
        const modeText = template.mode || 'generate';

        return `builtin-${title}||${promptText}||${categoryText}||${modeText}`;
    }

    function isFavoriteKey(key) {
        return Boolean(key) && favoriteTemplateKeys.has(key);
    }

    async function updateFavoriteState(key, favorite) {
        if (!key || typeof favorite !== 'boolean') return;

        try {
            const response = await fetch('/template_favorite', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key, favorite }),
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || 'Failed to update favorite');
            }
            setFavoriteKeys(data.favorites);
        } catch (error) {
            throw error;
        }
    }

    function resolveTagText(tag) {
        if (!tag) return '';
        return i18n.getText(tag);
    }

    function getTemplateTags(template) {
        if (!template) return [];
        const rawTags = template.tags;
        if (!rawTags) return [];

        let normalized = [];
        if (Array.isArray(rawTags)) {
            normalized = rawTags;
        } else if (typeof rawTags === 'string') {
            normalized = rawTags.split(',');
        } else {
            return [];
        }

        return normalized
            .map(tag => resolveTagText(tag).trim())
            .filter(Boolean);
    }

    function filterTemplates() {
        let filtered = allTemplates;

        if (currentCategory !== 'all') {
            filtered = filtered.filter(t => {
                const categoryText = i18n.getText(t.category);
                return categoryText === currentCategory;
            });
        }

        if (currentMode !== 'all') {
            filtered = filtered.filter(t => {
                return (t.mode || 'generate') === currentMode;
            });
        }

        if (favoriteFilterActive) {
            filtered = filtered.filter(t => {
                const key = getTemplateKey(t);
                return isFavoriteKey(key);
            });
        }

        if (userTemplateFilterActive) {
            filtered = filtered.filter(t => Boolean(t.isUserTemplate));
        }

        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            filtered = filtered.filter(t => {
                const title = i18n.getText(t.title).toLowerCase();
                const prompt = i18n.getText(t.prompt).toLowerCase();
                const category = i18n.getText(t.category).toLowerCase();
                const tagText = getTemplateTags(t).join(' ').toLowerCase();
                return title.includes(query) ||
                    prompt.includes(query) ||
                    category.includes(query) ||
                    tagText.includes(query);
            });
        }

        return filtered;
    }

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

    function createTemplateCard(template) {
        const card = document.createElement('div');
        card.className = 'template-card';
        card.setAttribute('data-category', i18n.getText(template.category) || '');
        card.setAttribute('data-mode', template.mode || 'generate');

        const preview = document.createElement('div');
        preview.className = 'template-card-preview';
        if (template.preview) {
            const img = document.createElement('img');
            img.src = template.preview;
            img.alt = i18n.getText(template.title) || 'Template preview';
            img.loading = 'lazy';
            img.onerror = function () {
                this.onerror = null;
                this.src = '/static/eror.png';
            };
            preview.appendChild(img);
        }

        const previewActions = document.createElement('div');
        previewActions.className = 'template-card-preview-actions';

        const templateKey = getTemplateKey(template);
        const isFavorite = isFavoriteKey(templateKey);

        const favoriteBtn = document.createElement('button');
        favoriteBtn.type = 'button';
        favoriteBtn.className = `template-card-favorite-btn${isFavorite ? ' active' : ''}`;
        favoriteBtn.setAttribute('aria-pressed', isFavorite ? 'true' : 'false');
        favoriteBtn.title = isFavorite ? 'Remove from favorites' : 'Mark as favorite';
        favoriteBtn.innerHTML = `
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.5 4.5 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.5 3 22 5.5 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
            </svg>`;
        favoriteBtn.addEventListener('click', async (event) => {
            event.stopPropagation();
            favoriteBtn.disabled = true;
            try {
                await updateFavoriteState(templateKey, !isFavorite);
                render();
            } catch (error) {
                console.error('Failed to update favorite:', error);
                favoriteBtn.disabled = false;
            }
        });
        previewActions.appendChild(favoriteBtn);

        if (template.isUserTemplate || template.builtinTemplateIndex !== undefined) {
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
            previewActions.appendChild(editBtn);
        }

        preview.appendChild(previewActions);
        card.appendChild(preview);

        const content = document.createElement('div');
        content.className = 'template-card-content';

        const title = document.createElement('h4');
        title.className = 'template-card-title';
        title.textContent = i18n.getText(template.title) || 'Untitled Template';
        content.appendChild(title);

        card.appendChild(content);

        card.addEventListener('click', () => {
            onSelectTemplate?.(template);
        });

        return card;
    }

    async function load() {
        try {
            const response = await fetch('/prompts');
            const data = await response.json();

            if (data.prompts) {
                allTemplates = data.prompts;
                setFavoriteKeys(data.favorites);
                render();
                return true;
            }
            return false;
        } catch (error) {
            console.error('Failed to load templates:', error);
            return false;
        }
    }

    function render() {
        if (!container) return;

        const filtered = filterTemplates();
        const categories = getCategories();

        container.innerHTML = '';

        const header = document.createElement('div');
        header.className = 'template-gallery-header';

        const title = document.createElement('h2');
        title.className = 'template-gallery-title';
        title.textContent = i18n.t('promptTemplates');
        header.appendChild(title);

        const controls = document.createElement('div');
        controls.className = 'template-gallery-controls';

        const searchRow = document.createElement('div');
        searchRow.className = 'template-gallery-search-row';

        const searchContainer = document.createElement('div');
        searchContainer.className = 'template-search-container';
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.className = 'template-search-input';
        searchInput.placeholder = i18n.t('searchPlaceholder');
        searchInput.value = searchQuery;

        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                searchQuery = e.target.value;
                render();
            }
        });

        searchInput.addEventListener('blur', (e) => {
            if (searchQuery !== e.target.value) {
                searchQuery = e.target.value;
                render();
            }
        });

        searchContainer.appendChild(searchInput);
        searchRow.appendChild(searchContainer);
        controls.appendChild(searchRow);

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

        const favoritesToggle = document.createElement('button');
        favoritesToggle.type = 'button';
        favoritesToggle.className = `template-favorites-toggle${favoriteFilterActive ? ' active' : ''}`;
        favoritesToggle.setAttribute('aria-pressed', favoriteFilterActive ? 'true' : 'false');
        favoritesToggle.setAttribute('aria-label', favoriteFilterActive ? 'Show all templates' : 'Show favorites only');
        favoritesToggle.title = favoriteFilterActive ? 'Show all templates' : 'Show favorites only';
        favoritesToggle.innerHTML = `
            <span class="template-favorites-toggle-icon" aria-hidden="true">
                <svg viewBox="0 0 24 20" width="16" height="16" fill="currentColor">
                    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.5 4.5 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.5 3 22 5.5 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                </svg>
            </span>
        `;
        favoritesToggle.addEventListener('click', () => {
            favoriteFilterActive = !favoriteFilterActive;
            render();
        });
        const filterRow = document.createElement('div');
        filterRow.className = 'template-gallery-filter-row';

        filterRow.appendChild(modeSelect);
        filterRow.appendChild(categorySelect);
        filterRow.appendChild(favoritesToggle);

        const userToggle = document.createElement('button');
        userToggle.type = 'button';
        userToggle.className = `template-user-toggle${userTemplateFilterActive ? ' active' : ''}`;
        userToggle.setAttribute('aria-pressed', userTemplateFilterActive ? 'true' : 'false');
        userToggle.setAttribute('aria-label', userTemplateFilterActive ? 'Show all templates' : 'Show my templates');
        userToggle.title = userTemplateFilterActive ? 'Show all templates' : 'Show my templates';
        userToggle.innerHTML = `
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
            </svg>
        `;
        userToggle.addEventListener('click', () => {
            userTemplateFilterActive = !userTemplateFilterActive;
            render();
        });
        filterRow.appendChild(userToggle);

        const createTemplateBtn = document.createElement('button');
        createTemplateBtn.className = 'template-create-btn';
        createTemplateBtn.innerHTML = `
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M10 14H12M12 14H14M12 14V16M12 14V12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                <path
                    d="M22 11.7979C22 9.16554 22 7.84935 21.2305 6.99383C21.1598 6.91514 21.0849 6.84024 21.0062 6.76946C20.1506 6 18.8345 6 16.2021 6H15.8284C14.6747 6 14.0979 6 13.5604 5.84678C13.2651 5.7626 12.9804 5.64471 12.7121 5.49543C12.2237 5.22367 11.8158 4.81578 11 4L10.4497 3.44975C10.1763 3.17633 10.0396 3.03961 9.89594 2.92051C9.27652 2.40704 8.51665 2.09229 7.71557 2.01738C7.52976 2 7.33642 2 6.94975 2C6.06722 2 5.62595 2 5.25839 2.06935C3.64031 2.37464 2.37464 3.64031 2.06935 5.25839C2 5.62595 2 6.06722 2 6.94975M21.9913 16C21.9554 18.4796 21.7715 19.8853 20.8284 20.8284C19.6569 22 17.7712 22 14 22H10C6.22876 22 4.34315 22 3.17157 20.8284C2 19.6569 2 17.7712 2 14V11"
                    stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
            </svg>
        `;
        createTemplateBtn.addEventListener('click', () => {
            if (window.openCreateTemplateModal) {
                window.openCreateTemplateModal();
            }
        });
        filterRow.appendChild(createTemplateBtn);

        controls.appendChild(filterRow);

        header.appendChild(controls);
        container.appendChild(header);

        const count = document.createElement('div');
        count.className = 'template-results-count';
        count.textContent = i18n.t('resultsCount', filtered.length);
        container.appendChild(count);

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

    return {
        load,
        render,
        show() {
            if (container) {
                container.classList.remove('hidden');
            }
        },
        hide() {
            if (container) {
                container.classList.add('hidden');
            }
        }
    };
}
