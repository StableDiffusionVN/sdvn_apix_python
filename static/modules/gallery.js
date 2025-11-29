import { withCacheBuster } from './utils.js';
import { extractMetadataFromBlob } from './metadata.js';

const GALLERY_STATE_KEY = 'gemini-app-gallery-state';
const FILTER_STORAGE_KEY = 'gemini-app-history-filter';   // legacy (single-state)
const SEARCH_STORAGE_KEY = 'gemini-app-history-search';   // legacy (single-state)
const SOURCE_STORAGE_KEY = 'gemini-app-history-source';
const VALID_SOURCES = ['generated', 'uploads'];

export function createGallery({ galleryGrid, onSelect }) {
    let currentSource = 'generated';
    let allImages = [];
    let favorites = [];
    let perSourceState = {
        generated: { filter: 'all', search: '', favoritesOnly: false },
        uploads: { filter: 'all', search: '', favoritesOnly: false },
    };

    const persistState = () => {
        try {
            localStorage.setItem(GALLERY_STATE_KEY, JSON.stringify({
                sourceState: perSourceState,
                source: currentSource,
            }));
        } catch (e) {
            console.warn('Failed to persist gallery state', e);
        }
    };

    // Load saved state (with legacy fallback)
    try {
        const saved = localStorage.getItem(GALLERY_STATE_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed?.sourceState) {
                perSourceState = {
                    generated: { filter: 'all', search: '', favoritesOnly: false, ...(parsed.sourceState.generated || {}) },
                    uploads: { filter: 'all', search: '', favoritesOnly: false, ...(parsed.sourceState.uploads || {}) },
                };
            }
            if (parsed?.source && VALID_SOURCES.includes(parsed.source)) {
                currentSource = parsed.source;
            }
        } else {
            // Legacy fallback (single state)
            const savedFilter = localStorage.getItem(FILTER_STORAGE_KEY);
            const savedSearch = localStorage.getItem(SEARCH_STORAGE_KEY);
            if (savedFilter) perSourceState.generated.filter = savedFilter;
            if (savedSearch) perSourceState.generated.search = savedSearch;
        }

        const savedSource = localStorage.getItem(SOURCE_STORAGE_KEY);
        if (savedSource && VALID_SOURCES.includes(savedSource)) {
            currentSource = savedSource;
        }
    } catch (e) {
        console.warn('Failed to load gallery state', e);
    }

    const getState = (source = currentSource) => {
        if (!perSourceState[source]) {
            perSourceState[source] = { filter: 'all', search: '', favoritesOnly: false };
        }
        return perSourceState[source];
    };

    // Load favorites from backend
    async function loadFavorites() {
        try {
            const response = await fetch('/gallery_favorites');
            const data = await response.json();
            favorites = data.favorites || [];
        } catch (error) {
            console.warn('Failed to load gallery favorites', error);
        }
    }

    function extractRelativePath(imageUrl) {
        if (!imageUrl) return '';
        try {
            const url = new URL(imageUrl, window.location.origin);
            const path = url.pathname;
            const staticIndex = path.indexOf('/static/');
            if (staticIndex !== -1) {
                return path.slice(staticIndex + '/static/'.length).replace(/^\//, '');
            }
            return path.replace(/^\//, '');
        } catch (error) {
            const parts = imageUrl.split('/static/');
            if (parts[1]) return parts[1].split('?')[0];
            return imageUrl.split('/').pop().split('?')[0];
        }
    }

    function getFavoriteKey(imageUrl) {
        const relative = extractRelativePath(imageUrl);
        if (relative) return relative;
        const filename = imageUrl.split('/').pop().split('?')[0];
        return `${currentSource}/${filename}`;
    }

    function isFavorite(imageUrl) {
        const key = getFavoriteKey(imageUrl);
        const filename = imageUrl.split('/').pop().split('?')[0];
        return favorites.includes(key) || favorites.includes(filename);
    }

    // Date comparison utilities
    function getFileTimestamp(imageUrl) {
        // Extract date from filename format: model_yyyymmdd_id.png
        // Example: gemini-3-pro-image-preview_20251125_1.png
        const filename = imageUrl.split('/').pop().split('?')[0];
        const match = filename.match(/_(\d{8})_/); // Match yyyymmdd between underscores
        if (match) {
            const dateStr = match[1]; // e.g., "20251125"
            const year = parseInt(dateStr.substring(0, 4), 10);
            const month = parseInt(dateStr.substring(4, 6), 10) - 1; // Month is 0-indexed
            const day = parseInt(dateStr.substring(6, 8), 10);
            return new Date(year, month, day).getTime();
        }
        return null;
    }

    function isToday(timestamp) {
        if (!timestamp) return false;
        const date = new Date(timestamp);
        const today = new Date();
        return date.toDateString() === today.toDateString();
    }

    function isThisWeek(timestamp) {
        if (!timestamp) return false;
        const date = new Date(timestamp);
        const today = new Date();
        const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
        return date >= weekAgo && date <= today;
    }

    function isThisMonth(timestamp) {
        if (!timestamp) return false;
        const date = new Date(timestamp);
        const today = new Date();
        return date.getMonth() === today.getMonth() && 
               date.getFullYear() === today.getFullYear();
    }

    function isThisYear(timestamp) {
        if (!timestamp) return false;
        const date = new Date(timestamp);
        const today = new Date();
        return date.getFullYear() === today.getFullYear();
    }

    function matchesSearch(imageUrl) {
        const { search } = getState();
        if (!search) return true;
        const filename = imageUrl.split('/').pop().split('?')[0];
        return filename.toLowerCase().includes(search.toLowerCase());
    }

    function shouldShowImage(imageUrl) {
        const state = getState();
        // First check text search
        if (!matchesSearch(imageUrl)) return false;
        
        // Check favorites toggle - if enabled, only show favorites
        if (state.favoritesOnly && !isFavorite(imageUrl)) {
            return false;
        }
        
        // Then check date filter
        if (state.filter === 'all') return true;
        
        const timestamp = getFileTimestamp(imageUrl);
        if (!timestamp) return state.filter === 'all';
        
        switch (state.filter) {
            case 'today':
                return isToday(timestamp);
            case 'week':
                return isThisWeek(timestamp);
            case 'month':
                return isThisMonth(timestamp);
            case 'year':
                return isThisYear(timestamp);
            default:
                return true;
        }
    }

    async function toggleFavorite(imageUrl) {
        const filename = imageUrl.split('/').pop().split('?')[0];
        const relativePath = extractRelativePath(imageUrl);
        
        try {
            const response = await fetch('/toggle_gallery_favorite', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filename,
                    path: relativePath,
                    source: currentSource
                })
            });
            
            const data = await response.json();
            if (data.favorites) {
                favorites = data.favorites;
                renderGallery();
            }
        } catch (error) {
            console.error('Failed to toggle favorite', error);
        }
    }

    async function readMetadataFromImage(imageUrl) {
        try {
            const response = await fetch(withCacheBuster(imageUrl));
            if (!response.ok) return null;
            const blob = await response.blob();
            return await extractMetadataFromBlob(blob);
        } catch (error) {
            console.warn('Unable to read gallery metadata', error);
            return null;
        }
    }

    function renderGallery() {
        if (!galleryGrid) return;
        galleryGrid.innerHTML = '';

        const filteredImages = allImages.filter(shouldShowImage);

        filteredImages.forEach(imageUrl => {
            const div = document.createElement('div');
            div.className = 'gallery-item';
            
            // Image container for positioning
            div.style.position = 'relative';

            const img = document.createElement('img');
            img.src = withCacheBuster(imageUrl);
            img.loading = 'lazy';
            img.draggable = true;
            img.dataset.source = imageUrl;
            
            // Click to select
            div.addEventListener('click', async (e) => {
                // Don't select if clicking delete or favorite button
                if (e.target.closest('.delete-btn') || e.target.closest('.favorite-btn')) return;
                
                const metadata = await readMetadataFromImage(imageUrl);
                await onSelect?.({ imageUrl, metadata });
                const siblings = galleryGrid.querySelectorAll('.gallery-item');
                siblings.forEach(el => el.classList.remove('active'));
                div.classList.add('active');
            });

            img.addEventListener('dragstart', event => {
                event.dataTransfer?.setData('text/uri-list', imageUrl);
                event.dataTransfer?.setData('text/plain', imageUrl);
                if (event.dataTransfer) {
                    event.dataTransfer.effectAllowed = 'copy';
                }
            });
            
            // Toolbar for buttons
            const toolbar = document.createElement('div');
            toolbar.className = 'gallery-item-toolbar';
            
            // Favorite button
            const favoriteBtn = document.createElement('button');
            favoriteBtn.className = 'favorite-btn';
            if (isFavorite(imageUrl)) {
                favoriteBtn.classList.add('active');
            }
            favoriteBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="${isFavorite(imageUrl) ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
            </svg>`;
            favoriteBtn.title = isFavorite(imageUrl) ? 'Remove from favorites' : 'Add to favorites';
            favoriteBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await toggleFavorite(imageUrl);
            });
            
            // Delete button
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'delete-btn';
            deleteBtn.innerHTML = '×';
            deleteBtn.title = 'Delete image';
            deleteBtn.addEventListener('click', async (e) => {
                e.stopPropagation();

                
                const filename = imageUrl.split('/').pop().split('?')[0];
                const relativePath = extractRelativePath(imageUrl);
                try {
                    const res = await fetch('/delete_image', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            filename,
                            path: relativePath,
                            source: currentSource
                        })
                    });
                    
                    if (res.ok) {
                        div.remove();
                        // Also remove from allImages array
                        allImages = allImages.filter(url => url !== imageUrl);
                    } else {
                        console.error('Failed to delete image');
                    }
                } catch (err) {
                    console.error('Error deleting image:', err);
                }
            });

            toolbar.appendChild(favoriteBtn);
            toolbar.appendChild(deleteBtn);

            div.appendChild(img);
            div.appendChild(toolbar);
            galleryGrid.appendChild(div);
        });
    }

    async function load() {
        if (!galleryGrid) return;
        try {
            await loadFavorites();
            const response = await fetch(`/gallery?source=${currentSource}&t=${new Date().getTime()}`);
            const data = await response.json();
            allImages = data.images || [];
            renderGallery();
        } catch (error) {
            console.error('Failed to load gallery:', error);
        }
    }

    function setFilter(filterType) {
        if (currentFilter === filterType) return;
        const state = getState();
        state.filter = filterType;
        persistState();
        renderGallery();
    }

    function setSearch(query) {
        const state = getState();
        state.search = query || '';
        persistState();
        renderGallery();
    }

    function toggleFavorites() {
        const state = getState();
        state.favoritesOnly = !state.favoritesOnly;
        persistState();
        renderGallery();
        return state.favoritesOnly;
    }

    function setFavoritesActive(active) {
        const state = getState();
        state.favoritesOnly = Boolean(active);
        persistState();
        renderGallery();
        return state.favoritesOnly;
    }

    function setSource(source, { resetFilters = false } = {}) {
        const normalized = VALID_SOURCES.includes(source) ? source : 'generated';
        currentSource = normalized;
        try {
            localStorage.setItem(SOURCE_STORAGE_KEY, currentSource);
        } catch (e) {
            console.warn('Failed to save history source', e);
        }
        if (resetFilters) {
            const state = getState();
            state.filter = 'all';
            state.favoritesOnly = false;
            state.search = '';
            persistState();
        }
        persistState();
        return load();
    }

    function getCurrentFilter() {
        return getState().filter;
    }

    function getSearchQuery() {
        return getState().search;
    }

    function getCurrentSource() {
        return currentSource;
    }

    function isFavoritesActive() {
        return getState().favoritesOnly;
    }

    function setSearchQuery(value) {
        setSearch(value);
    }

    function navigate(direction) {
        const activeItem = galleryGrid.querySelector('.gallery-item.active');
        
        if (!activeItem) {
            // If nothing active, select the first item on any arrow key
            const firstItem = galleryGrid.querySelector('.gallery-item');
            if (firstItem) {
                firstItem.click();
                firstItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
            return;
        }

        let targetItem;
        if (direction === 'prev') {
            targetItem = activeItem.previousElementSibling;
        } else if (direction === 'next') {
            targetItem = activeItem.nextElementSibling;
        }

        if (targetItem && targetItem.classList.contains('gallery-item')) {
            targetItem.click();
            targetItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }

    // Setup keyboard navigation
    document.addEventListener('keydown', (e) => {
        // Ignore if user is typing in an input
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        
        if (e.key === 'ArrowLeft') {
            navigate('prev');
        } else if (e.key === 'ArrowRight') {
            navigate('next');
        }
    });

    return { 
        load, 
        setFilter, 
        getCurrentFilter, 
        setSearch, 
        getSearchQuery, 
        toggleFavorites, 
        isFavoritesActive, 
        setSource, 
        getCurrentSource,
        setFavoritesActive,
        setSearchQuery
    };
}
