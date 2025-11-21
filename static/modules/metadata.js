export async function extractMetadataFromBlob(blob, key = 'sdvn_meta') {
    try {
        const arrayBuffer = await blob.arrayBuffer();
        if (arrayBuffer.byteLength < 8) return null;
        const view = new DataView(arrayBuffer);
        const signature = [137, 80, 78, 71, 13, 10, 26, 10];
        for (let i = 0; i < signature.length; i++) {
            if (view.getUint8(i) !== signature[i]) return null;
        }

        let offset = 8;
        const decoder = new TextDecoder('utf-8');

        while (offset + 12 <= view.byteLength) {
            const length = view.getUint32(offset);
            offset += 4;
            const chunkTypeBytes = new Uint8Array(arrayBuffer, offset, 4);
            const chunkType = decoder.decode(chunkTypeBytes);
            offset += 4;

            const chunkData = new Uint8Array(arrayBuffer, offset, length);
            offset += length;
            offset += 4; // skip CRC

            if (chunkType === 'tEXt') {
                const chunkText = decoder.decode(chunkData);
                const nullIndex = chunkText.indexOf('\u0000');
                if (nullIndex !== -1) {
                    const chunkKey = chunkText.slice(0, nullIndex);
                    const chunkValue = chunkText.slice(nullIndex + 1);
                    if (chunkKey === key) {
                        try {
                            return JSON.parse(chunkValue);
                        } catch (error) {
                            console.warn('Invalid metadata JSON', error);
                            return null;
                        }
                    }
                }
            }
        }
    } catch (error) {
        console.warn('Unable to extract metadata', error);
    }
    return null;
}
