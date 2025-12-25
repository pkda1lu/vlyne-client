// Protocol types
export type Protocol = 'vless' | 'vmess' | 'trojan' | 'shadowsocks';
export type Network = 'tcp' | 'ws' | 'grpc' | 'h2' | 'quic' | 'kcp';
export type Security = 'none' | 'tls' | 'reality';
export type ServerStatus = 'disconnected' | 'connected' | 'connecting';

// Base configuration shared by all protocols
export interface BaseServerConfig {
    id: string;
    name: string;
    protocol: Protocol;
    address: string;
    port: string;
    status: ServerStatus;
    originalLink: string;

    // Connection status
    ping?: number; // Latency in ms
    load?: string; // Connection speed/load

    // Subscription tracking
    subscriptionId?: string;
    subscriptionName?: string;

    // Transport settings
    network: Network;
    security: Security;

    // TLS/Reality settings
    sni?: string;
    alpn?: string[];
    fp?: string; // fingerprint
    allowInsecure?: boolean;

    // Reality specific
    pbk?: string; // public key
    sid?: string; // short id
    spx?: string; // spider x

    // Transport specific
    path?: string; // ws, h2
    host?: string; // ws, h2
    serviceName?: string; // grpc
    mode?: string; // grpc mode
    seed?: string; // kcp
    headerType?: string; // tcp, kcp

    // Advanced features
    flow?: string; // xtls flow
    mux?: {
        enabled: boolean;
        concurrency?: number;
    };
    fragment?: {
        packets?: string;
        length?: string;
        interval?: string;
    };
}

// VLESS specific configuration
export interface VlessConfig extends BaseServerConfig {
    protocol: 'vless';
    uuid: string;
    encryption: 'none';
}

// VMess specific configuration
export interface VmessConfig extends BaseServerConfig {
    protocol: 'vmess';
    uuid: string;
    alterId: number;
    cipher: string; // auto, aes-128-gcm, chacha20-poly1305, none
}

// Trojan specific configuration
export interface TrojanConfig extends BaseServerConfig {
    protocol: 'trojan';
    password: string;
}

// Shadowsocks specific configuration
export interface ShadowsocksConfig extends BaseServerConfig {
    protocol: 'shadowsocks';
    method: string; // encryption method
    password: string;
    plugin?: string;
    pluginOpts?: string;
}

// Union type for all server configurations
export type ServerConfig = VlessConfig | VmessConfig | TrojanConfig | ShadowsocksConfig;

// Subscription metadata
export interface Subscription {
    id: string;
    name: string;
    url: string;
    lastUpdate: number;
    // Metadata
    upload?: number;
    download?: number;
    total?: number;
    expire?: number;
}

// Xray outbound configuration types
export interface XrayOutbound {
    protocol: string;
    settings: any;
    streamSettings: XrayStreamSettings;
    tag?: string;
    mux?: {
        enabled: boolean;
        concurrency?: number;
    };
}

export interface XrayStreamSettings {
    network: Network;
    security: Security;
    tlsSettings?: XrayTlsSettings;
    realitySettings?: XrayRealitySettings;
    tcpSettings?: any;
    wsSettings?: any;
    grpcSettings?: any;
    httpSettings?: any;
    quicSettings?: any;
    kcpSettings?: any;
}

export interface XrayTlsSettings {
    serverName?: string;
    allowInsecure?: boolean;
    alpn?: string[];
    fingerprint?: string;
}

export interface XrayRealitySettings {
    show: boolean;
    fingerprint: string;
    serverName: string;
    publicKey: string;
    shortId: string;
    spiderX: string;
}
