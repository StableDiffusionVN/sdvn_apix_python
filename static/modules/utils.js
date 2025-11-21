export function withCacheBuster(url) {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}t=${new Date().getTime()}`;
}

export function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

export function dataUrlToBlob(dataUrl) {
    try {
        const [prefix, base64] = dataUrl.split(',');
        const mimeMatch = prefix.match(/:(.*?);/);
        const mime = mimeMatch ? mimeMatch[1] : 'image/png';
        const binary = atob(base64);
        const len = binary.length;
        const buffer = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            buffer[i] = binary.charCodeAt(i);
        }
        return new Blob([buffer], { type: mime });
    } catch (error) {
        console.warn('Unable to convert cached image to blob', error);
        return null;
    }
}
