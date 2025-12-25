import type { ServerConfig } from '../types/server';
import { parseVlessLink } from './vless';
import { parseVmessLink } from './vmess-parser';
import { parseTrojanLink } from './trojan-parser';
import { parseShadowsocksLink } from './ss-parser';

export function parseProxyLink(link: string): ServerConfig | null {
    console.log('parseProxyLink called with:', link);

    if (link.startsWith('vless://')) {
        const result = parseVlessLink(link);
        console.log('VLESS parse result:', result);
        return result;
    } else if (link.startsWith('vmess://')) {
        const result = parseVmessLink(link);
        console.log('VMess parse result:', result);
        return result;
    } else if (link.startsWith('trojan://')) {
        const result = parseTrojanLink(link);
        console.log('Trojan parse result:', result);
        return result;
    } else if (link.startsWith('ss://')) {
        const result = parseShadowsocksLink(link);
        console.log('SS parse result:', result);
        return result;
    }

    console.log('No matching protocol found');
    return null;
}

export { parseVlessLink, parseVmessLink, parseTrojanLink, parseShadowsocksLink };
