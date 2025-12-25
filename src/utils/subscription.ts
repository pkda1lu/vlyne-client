import { parseProxyLink } from './protocol-parser';
import type { ServerConfig } from '../types/server';

export interface SubscriptionInfo {
    url: string;
    name: string;
    lastUpdate: number;
    servers: ServerConfig[];
    upload?: number;
    download?: number;
    total?: number;
    expire?: number;
}

export async function fetchSubscription(url: string): Promise<ServerConfig[]> {
    try {
        console.log('fetchSubscription called with:', url);
        // Use IPC to fetch from main process (avoids CORS issues)
        const response = await window.electronAPI.fetchSubscription(url);
        const text = response.data;
        const serverName = response.name;
        const userInfoStr = response.userInfo;

        // Parse UserInfo
        // upload=123; download=456; total=789; expire=1234567890
        const metadata: any = {};
        if (userInfoStr) {
            const parts = userInfoStr.split(';');
            for (const part of parts) {
                const [key, value] = part.trim().split('=');
                if (key && value) {
                    metadata[key] = parseInt(value, 10);
                }
            }
        }

        console.log('Received text from IPC (length):', text.length);
        console.log('Received text (full):', text);

        // Try to decode as base64
        let decodedText: string;
        try {
            decodedText = atob(text);
            console.log('Successfully decoded base64');
        } catch {
            // If not base64, use as is
            decodedText = text;
            console.log('Text is not base64, using as is');
        }

        console.log('Decoded text (length):', decodedText.length);
        console.log('Decoded text (full):', decodedText);

        // Split by newlines and parse each link
        const links = decodedText
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0 && !line.startsWith('#'));

        console.log('Found links:', links.length);
        console.log('First few links:', links.slice(0, 3));

        const servers: ServerConfig[] = [];

        for (const link of links) {
            console.log('Parsing link:', link.substring(0, 50) + '...');
            const server = parseProxyLink(link);
            if (server) {
                console.log('Successfully parsed server:', server.name);
                servers.push(server);
            } else {
                console.log('Failed to parse link');
            }
        }

        console.log('Total servers parsed:', servers.length);

        // If we got a name header and the subscription didn't have a name or it differs, we might want to return it.
        // NOTE: The current function signature only returns ServerConfig[].
        // To support "Auto-naming" for the subscription itself (not just servers), we need to update how this is called.
        // But for now, let's attach the subscription name to the servers if needed?
        // Actually, the user wants the SUBSCRIPTION name.

        // We can hack: attach the discovered name to the first server or property, 
        // OR better: change return type of fetchSubscription to return { servers, name }.

        // We return servers attached with name, but typically we need to return the metadata object separately 
        // to update the subscription state.
        // For now, attaching to array as a property is a valid JS hack to pass data without breaking signature heavily,
        // OR we just rely on the caller to not need it yet?
        // User wants metadata displayed. 
        // I will attach it to the array object itself!
        // Decode base64 name if needed
        let finalName = serverName;
        console.log('Raw server name:', finalName);

        if (finalName && finalName.startsWith('base64:')) {
            try {
                const b64 = finalName.replace('base64:', '');
                // Decode utf-8 string from base64
                const binaryString = atob(b64);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }
                finalName = new TextDecoder().decode(bytes);
                console.log('Decoded server name:', finalName);
            } catch (e) {
                console.error('Failed to decode base64 name:', e);
            }
        }

        console.log('UserInfo string:', userInfoStr);
        console.log('Parsed metadata:', metadata);

        // We return servers attached with name, but typically we need to return the metadata object separately 
        // to update the subscription state.
        // For now, attaching to array as a property is a valid JS hack to pass data without breaking signature heavily,
        // OR we just rely on the caller to not need it yet?
        // User wants metadata displayed. 
        // I will attach it to the array object itself!
        const result = servers.map(s => ({ ...s, subscriptionName: finalName || s.subscriptionName }));
        (result as any).metadata = metadata;
        (result as any).subscriptionName = finalName;

        return result;
    } catch (error) {
        console.error('Failed to fetch subscription:', error);
        throw error;
    }
}

export async function updateSubscription(subscription: SubscriptionInfo): Promise<SubscriptionInfo> {
    const servers = await fetchSubscription(subscription.url);
    const metadata = (servers as any).metadata || {};
    // Base64 decoding is now handled in fetchSubscription
    const detectedName = (servers as any).subscriptionName;

    return {
        ...subscription,
        name: detectedName || subscription.name, // Auto-update name if found
        servers,
        lastUpdate: Date.now(),
        upload: metadata.upload,
        download: metadata.download,
        total: metadata.total,
        expire: metadata.expire,
    };
}
