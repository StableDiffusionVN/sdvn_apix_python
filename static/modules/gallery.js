import { withCacheBuster } from './utils.js';
import { extractMetadataFromBlob } from './metadata.js';

const FILTER_STORAGE_KEY = 'gemini-app-history-filter';
const SEARCH_STORAGE_KEY = 'gemini-app-history-search';
const SOURCE_STORAGE_KEY = 'gemini-app-history-source';
const VALID_SOURCES = ['generated', 'uploads'];

export function createGallery({ galleryGrid, onSelect }) {
    let currentFilter = 'all';
    let searchQuery = '';
    let currentSource = 'generated';
    let allImages = [];
    let favorites = [];
    let showOnlyFavorites = false; // New toggle state

    // Load saved filter and search from localStorage
    try {
        const savedFilter = localStorage.getItem(FILTER_STORAGE_KEY);
        if (savedFilter) currentFilter = savedFilter;
        
        const savedSearch = localStorage.getItem(SEARCH_STORAGE_KEY);
        if (savedSearch) searchQuery = savedSearch;

        const savedSource = localStorage.getItem(SOURCE_STORAGE_KEY);
        if (savedSource && VALID_SOURCES.includes(savedSource)) {
            currentSource = savedSource;
        }
    } catch (e) {
        console.warn('Failed to load history filter/search', e);
    }

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
        if (!searchQuery) return true;
        const filename = imageUrl.split('/').pop().split('?')[0];
        return filename.toLowerCase().includes(searchQuery.toLowerCase());
    }

    function shouldShowImage(imageUrl) {
        // First check text search
        if (!matchesSearch(imageUrl)) return false;
        
        // Check favorites toggle - if enabled, only show favorites
        if (showOnlyFavorites && !isFavorite(imageUrl)) {
            return false;
        }
        
        // Then check date filter
        if (currentFilter === 'all') return true;
        
        const timestamp = getFileTimestamp(imageUrl);
        if (!timestamp) return currentFilter === 'all';
        
        switch (currentFilter) {
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
        currentFilter = filterType;
        
        // Save to localStorage
        try {
            localStorage.setItem(FILTER_STORAGE_KEY, filterType);
        } catch (e) {
            console.warn('Failed to save history filter', e);
        }
        
        renderGallery();
    }

    function setSearch(query) {
        searchQuery = query || '';
        
        // Save to localStorage
        try {
            localStorage.setItem(SEARCH_STORAGE_KEY, searchQuery);
        } catch (e) {
            console.warn('Failed to save history search', e);
        }
        
        renderGallery();
    }

    function toggleFavorites() {
        showOnlyFavorites = !showOnlyFavorites;
        renderGallery();
        return showOnlyFavorites;
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
            currentFilter = 'all';
            showOnlyFavorites = false;
            searchQuery = '';
            try {
                localStorage.setItem(FILTER_STORAGE_KEY, currentFilter);
                localStorage.setItem(SEARCH_STORAGE_KEY, searchQuery);
            } catch (e) {
                console.warn('Failed to reset history filters', e);
            }
        }
        return load();
    }

    function getCurrentFilter() {
        return currentFilter;
    }

    function getSearchQuery() {
        return searchQuery;
    }

    function getCurrentSource() {
        return currentSource;
    }

    function isFavoritesActive() {
        return showOnlyFavorites;
    }

    function setFavoritesActive(active) {
        showOnlyFavorites = Boolean(active);
        renderGallery();
        return showOnlyFavorites;
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
