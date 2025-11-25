import { withCacheBuster } from './utils.js';
import { extractMetadataFromBlob } from './metadata.js';

const FILTER_STORAGE_KEY = 'gemini-app-history-filter';
const SEARCH_STORAGE_KEY = 'gemini-app-history-search';

export function createGallery({ galleryGrid, onSelect }) {
    let currentFilter = 'all';
    let searchQuery = '';
    let allImages = [];

    // Load saved filter and search from localStorage
    try {
        const savedFilter = localStorage.getItem(FILTER_STORAGE_KEY);
        if (savedFilter) currentFilter = savedFilter;
        
        const savedSearch = localStorage.getItem(SEARCH_STORAGE_KEY);
        if (savedSearch) searchQuery = savedSearch;
    } catch (e) {
        console.warn('Failed to load history filter/search', e);
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
                // Don't select if clicking delete button
                if (e.target.closest('.delete-btn')) return;
                
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
            
            // Delete button
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'delete-btn';
            deleteBtn.innerHTML = '×';
            deleteBtn.title = 'Delete image';
            deleteBtn.addEventListener('click', async (e) => {
                e.stopPropagation();

                
                const filename = imageUrl.split('/').pop().split('?')[0];
                try {
                    const res = await fetch('/delete_image', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ filename })
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

            div.appendChild(img);
            div.appendChild(deleteBtn);
            galleryGrid.appendChild(div);
        });
    }

    async function load() {
        if (!galleryGrid) return;
        try {
            const response = await fetch(`/gallery?t=${new Date().getTime()}`);
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

    function getCurrentFilter() {
        return currentFilter;
    }

    function getSearchQuery() {
        return searchQuery;
    }

    return { load, setFilter, getCurrentFilter, setSearch, getSearchQuery };
}
