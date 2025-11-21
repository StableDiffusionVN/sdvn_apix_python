import { withCacheBuster } from './utils.js';
import { extractMetadataFromBlob } from './metadata.js';

export function createGallery({ galleryGrid, onSelect }) {
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

    async function load() {
        if (!galleryGrid) return;
        try {
            const response = await fetch(`/gallery?t=${new Date().getTime()}`);
            const data = await response.json();
            galleryGrid.innerHTML = '';

            data.images.forEach(imageUrl => {
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
        } catch (error) {
            console.error('Failed to load gallery:', error);
        }
    }

    return { load };
}
