import type { VmessConfig } from '../types/server';

interface VmessLinkData {
    v?: string; // version
    ps?: string; // name/remark
    add: string; // address
    port: string | number;
    id: string; // uuid
    aid?: string | number; // alterId
    net?: string; // network
    type?: string; // header type
    host?: string;
    path?: string;
    tls?: string; // tls/reality/none
    sni?: string;
    alpn?: string;
    fp?: string; // fingerprint
    pbk?: string; // reality public key
    sid?: string; // reality short id
    spx?: string; // reality spider x
    scy?: string; // cipher/security
}

import { decodeName } from './name-decoder';

export function parseVmessLink(link: string): VmessConfig | null {
    try {
        if (!link.startsWith('vmess://')) return null;

        // VMess links are base64 encoded JSON
        const base64Data = link.substring(8);
        const jsonStr = atob(base64Data);
        const data: VmessLinkData = JSON.parse(jsonStr);

        return {
            id: crypto.randomUUID(),
            name: decodeName(data.ps || '') || 'Unnamed VMess Server',
            protocol: 'vmess',
            address: data.add,
            port: String(data.port),
            uuid: data.id,
            alterId: Number(data.aid || 0),
            cipher: data.scy || 'auto',
            status: 'disconnected',
            originalLink: link,

            // Transport
            network: (data.net as any) || 'tcp',
            security: (data.tls === 'tls' ? 'tls' : data.tls === 'reality' ? 'reality' : 'none') as any,

            // TLS/Reality
            sni: data.sni,
            fp: data.fp,
            pbk: data.pbk,
            sid: data.sid,
            spx: data.spx,
            alpn: data.alpn ? data.alpn.split(',') : undefined,

            // Transport specific
            path: data.path,
            host: data.host,
            headerType: data.type,
        };
    } catch (e) {
        console.error('Failed to parse VMess link:', e);
        return null;
    }
}
