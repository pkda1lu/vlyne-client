
export function decodeName(rawName: string): string {
    if (!rawName) return '';
    try {
        let decoded = rawName;
        // Try decoding up to 3 times to handle double/triple encoding
        // and stop if no change
        for (let i = 0; i < 3; i++) {
            const temp = decodeURIComponent(decoded);
            if (temp === decoded) break;
            decoded = temp;
        }
        return decoded;
    } catch (e) {
        // Fallback: try to decode part of it or just return raw
        // Sometimes malformed URI sequences cause throw
        console.warn(`Failed to decode name: ${rawName}`, e);
        return rawName;
    }
}
