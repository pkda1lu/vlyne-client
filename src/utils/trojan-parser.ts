import type { TrojanConfig } from '../types/server';

import { decodeName } from './name-decoder';

export function parseTrojanLink(link: string): TrojanConfig | null {
    try {
        if (!link.startsWith('trojan://')) return null;

        const url = new URL(link);
        const params = url.searchParams;

        return {
            id: crypto.randomUUID(),
            name: decodeName(url.hash.slice(1)) || 'Unnamed Trojan Server',
            protocol: 'trojan',
            address: url.hostname,
            port: url.port,
            password: url.username,
            status: 'disconnected',
            originalLink: link,

            // Transport
            network: (params.get('type') as any) || 'tcp',
            security: (params.get('security') as any) || 'tls',

            // TLS settings
            sni: params.get('sni') || undefined,
            fp: params.get('fp') || undefined,
            alpn: params.get('alpn')?.split(','),
            allowInsecure: params.get('allowInsecure') === '1',

            // Transport specific
            path: params.get('path') || undefined,
            host: params.get('host') || undefined,
            serviceName: params.get('serviceName') || undefined,
            headerType: params.get('headerType') || undefined,
        };
    } catch (e) {
        console.error('Failed to parse Trojan link:', e);
        return null;
    }
}
