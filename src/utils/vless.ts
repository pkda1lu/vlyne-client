import type { VlessConfig } from '../types/server';
import { decodeName } from './name-decoder';

export function parseVlessLink(link: string): VlessConfig | null {
    try {
        if (!link.startsWith('vless://')) return null;

        const url = new URL(link);
        const params = url.searchParams;

        return {
            id: crypto.randomUUID(),
            name: decodeName(url.hash.slice(1)) || 'Unnamed Server',
            protocol: 'vless',
            address: url.hostname,
            port: url.port,
            uuid: url.username,
            encryption: 'none',
            status: 'disconnected',
            originalLink: link,
            security: (params.get('security') as any) || 'none',
            network: (params.get('type') as any) || 'tcp',
            flow: params.get('flow') || undefined,
            sni: params.get('sni') || undefined,
            path: params.get('path') || undefined,
            host: params.get('host') || undefined,
            pbk: params.get('pbk') || undefined,
            sid: params.get('sid') || undefined,
            fp: params.get('fp') || undefined,
            spx: params.get('spx') || undefined,
            serviceName: params.get('serviceName') || undefined,
            mode: params.get('mode') || undefined,
            alpn: params.get('alpn')?.split(','),
            headerType: params.get('headerType') || undefined,
        };
    } catch (e) {
        console.error('Failed to parse VLESS link', e);
        return null;
    }
}
