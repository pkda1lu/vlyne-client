import type { ShadowsocksConfig } from '../types/server';
import { decodeName } from './name-decoder';

export function parseShadowsocksLink(link: string): ShadowsocksConfig | null {
    try {
        if (!link.startsWith('ss://')) return null;

        // SS links can be in SIP002 format: ss://base64(method:password)@server:port#name
        // or: ss://method:password@server:port#name

        let url: URL;
        let method: string;
        let password: string;

        // Try to parse as URL first
        try {
            url = new URL(link);

            // Check if userinfo is base64 encoded
            if (url.username && !url.password) {
                // Base64 encoded format
                const decoded = atob(url.username);
                const [m, p] = decoded.split(':');
                method = m;
                password = p;
            } else {
                // Plain format
                method = url.username;
                password = url.password;
            }
        } catch {
            // Try legacy format: ss://base64(method:password@server:port)#name
            const hashIndex = link.indexOf('#');
            const name = hashIndex > 0 ? decodeName(link.substring(hashIndex + 1)) : 'Unnamed SS Server';
            const base64Part = link.substring(5, hashIndex > 0 ? hashIndex : undefined);

            const decoded = atob(base64Part);
            const match = decoded.match(/^(.+?):(.+?)@(.+?):(\d+)$/);

            if (!match) return null;

            method = match[1];
            password = match[2];

            return {
                id: crypto.randomUUID(),
                name,
                protocol: 'shadowsocks',
                address: match[3],
                port: match[4],
                method,
                password,
                status: 'disconnected',
                originalLink: link,
                network: 'tcp',
                security: 'none',
            };
        }

        const params = url.searchParams;

        return {
            id: crypto.randomUUID(),
            name: decodeName(url.hash.slice(1)) || 'Unnamed SS Server',
            protocol: 'shadowsocks',
            address: url.hostname,
            port: url.port,
            method,
            password,
            status: 'disconnected',
            originalLink: link,

            // Transport
            network: 'tcp',
            security: 'none',

            // Plugin support (e.g., v2ray-plugin, obfs)
            plugin: params.get('plugin') || undefined,
            pluginOpts: params.get('plugin-opts') || undefined,
        };
    } catch (e) {
        console.error('Failed to parse Shadowsocks link:', e);
        return null;
    }
}
