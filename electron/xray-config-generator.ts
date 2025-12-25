import type {
    ServerConfig,
    VlessConfig,
    VmessConfig,
    TrojanConfig,
    ShadowsocksConfig,
    XrayOutbound,
    XrayStreamSettings,
    XrayTlsSettings,
    XrayRealitySettings,
} from './types';

// Generate VLESS outbound configuration
export function generateVlessOutbound(config: VlessConfig): any {
    return {
        protocol: 'vless',
        settings: {
            vnext: [
                {
                    address: config.address,
                    port: parseInt(config.port),
                    users: [
                        {
                            id: config.uuid,
                            encryption: 'none',
                            flow: config.flow || '',
                        },
                    ],
                },
            ],
        },
    };
}

// Generate VMess outbound configuration
export function generateVmessOutbound(config: VmessConfig): any {
    return {
        protocol: 'vmess',
        settings: {
            vnext: [
                {
                    address: config.address,
                    port: parseInt(config.port),
                    users: [
                        {
                            id: config.uuid,
                            alterId: config.alterId,
                            security: config.cipher,
                        },
                    ],
                },
            ],
        },
    };
}

// Generate Trojan outbound configuration
export function generateTrojanOutbound(config: TrojanConfig): any {
    return {
        protocol: 'trojan',
        settings: {
            servers: [
                {
                    address: config.address,
                    port: parseInt(config.port),
                    password: config.password,
                },
            ],
        },
    };
}

// Generate Shadowsocks outbound configuration
export function generateShadowsocksOutbound(config: ShadowsocksConfig): any {
    return {
        protocol: 'shadowsocks',
        settings: {
            servers: [
                {
                    address: config.address,
                    port: parseInt(config.port),
                    method: config.method,
                    password: config.password,
                },
            ],
        },
    };
}

// Generate stream settings for all transports
export function generateStreamSettings(config: ServerConfig): XrayStreamSettings {
    const streamSettings: XrayStreamSettings = {
        network: config.network,
        security: config.security,
    };

    // TCP settings
    if (config.network === 'tcp') {
        streamSettings.tcpSettings = {
            header: {
                type: config.headerType || 'none',
            },
        };
    }

    // WebSocket settings
    if (config.network === 'ws') {
        streamSettings.wsSettings = {
            path: config.path || '/',
            headers: {
                Host: config.host || '',
            },
        };
    }

    // gRPC settings
    if (config.network === 'grpc') {
        streamSettings.grpcSettings = {
            serviceName: config.serviceName || '',
            multiMode: config.mode === 'multi',
        };
    }

    // HTTP/2 settings
    if (config.network === 'h2') {
        streamSettings.httpSettings = {
            host: config.host ? [config.host] : [],
            path: config.path || '/',
        };
    }

    // QUIC settings
    if (config.network === 'quic') {
        streamSettings.quicSettings = {
            security: config.headerType || 'none',
            key: config.path || '',
            header: {
                type: config.headerType || 'none',
            },
        };
    }

    // KCP settings
    if (config.network === 'kcp') {
        streamSettings.kcpSettings = {
            mtu: 1350,
            tti: 50,
            uplinkCapacity: 12,
            downlinkCapacity: 100,
            congestion: false,
            readBufferSize: 2,
            writeBufferSize: 2,
            header: {
                type: config.headerType || 'none',
            },
            seed: config.seed,
        };
    }

    // TLS settings
    if (config.security === 'tls') {
        streamSettings.tlsSettings = generateTlsSettings(config);
    }

    // Reality settings
    if (config.security === 'reality') {
        streamSettings.realitySettings = generateRealitySettings(config);
    }

    return streamSettings;
}

// Generate TLS settings
export function generateTlsSettings(config: ServerConfig): XrayTlsSettings {
    return {
        serverName: config.sni || config.address,
        allowInsecure: config.allowInsecure || false,
        alpn: config.alpn || [],
        fingerprint: config.fp || 'chrome',
    };
}

// Generate Reality settings
export function generateRealitySettings(config: ServerConfig): XrayRealitySettings {
    return {
        show: false,
        fingerprint: config.fp || 'chrome',
        serverName: config.sni || config.address,
        publicKey: config.pbk || '',
        shortId: config.sid || '',
        spiderX: config.spx || '/',
    };
}

// Main function to generate complete Xray outbound
export function generateXrayOutbound(config: ServerConfig): XrayOutbound {
    let outbound: any;

    // Generate protocol-specific outbound
    switch (config.protocol) {
        case 'vless':
            outbound = generateVlessOutbound(config as VlessConfig);
            break;
        case 'vmess':
            outbound = generateVmessOutbound(config as VmessConfig);
            break;
        case 'trojan':
            outbound = generateTrojanOutbound(config as TrojanConfig);
            break;
        case 'shadowsocks':
            outbound = generateShadowsocksOutbound(config as ShadowsocksConfig);
            break;
        default:
            throw new Error(`Unsupported protocol: ${(config as ServerConfig).protocol}`);
    }

    // Add stream settings
    outbound.streamSettings = generateStreamSettings(config);

    // Add mux if enabled
    if (config.mux?.enabled) {
        outbound.mux = {
            enabled: true,
            concurrency: config.mux.concurrency || 8,
        };
    }

    return outbound;
}

// Generate complete Xray configuration
// Generate complete Xray configuration
export function generateXrayConfig(config: ServerConfig, settings: any, resourcesPath: string): any {
    const logLevel = settings?.core?.logLevel || 'warning';
    const accessLog = settings?.core?.accessLog ? `${resourcesPath}/access.log` : 'none';
    const errorLog = settings?.core?.errorLog ? `${resourcesPath}/error.log` : 'none';

    const socksPort = settings?.inbound?.socksPort ?? 10806;
    const httpPort = settings?.inbound?.httpPort ?? 10810;
    const allowLan = settings?.inbound?.allowLan || false;
    const udpSupport = settings?.inbound?.udpSupport !== false; // Default true
    const sniffing = settings?.inbound?.sniffing !== false; // Default true

    const listenIp = allowLan ? '0.0.0.0' : '127.0.0.1';

    // DNS Configuration
    const dns: any = {
        servers: [
            settings?.dns?.primaryDns || '8.8.8.8',
            settings?.dns?.fallbackDns || '1.1.1.1'
        ],
        queryStrategy: settings?.dns?.strategy || 'UseIP',
    };

    // Routing Rules
    const routingRules = [];

    // Direct domain rules from DNS settings
    if (settings?.dns?.directDomains?.length > 0) {
        // ... (implementation for direct domains if array exists)
    }

    const mode = settings?.routing?.mode || 'global';

    if (mode === 'bypass-lan') {
        routingRules.push({
            type: 'field',
            outboundTag: 'direct',
            ip: ['geoip:private']
        });
    } else if (mode === 'bypass-china') {
        routingRules.push(
            {
                type: 'field',
                outboundTag: 'direct',
                ip: ['geoip:private', 'geoip:cn']
            },
            {
                type: 'field',
                outboundTag: 'direct',
                domain: ['geosite:cn']
            }
        );
    } else if (mode === 'custom') {
        if (settings?.routing?.customRules) {
            // ... (parse custom rules)
            settings.routing.customRules.forEach((rule: any) => {
                routingRules.push({
                    type: 'field',
                    outboundTag: rule.outbound === 'proxy' ? 'proxy' : (rule.outbound === 'block' ? 'block' : 'direct'),
                    [rule.type]: [rule.value]
                });
            });
        }
    }

    // Always add final rule for proxy
    if (mode !== 'global') {
        // If not global, we might want everything else to go to proxy?
        // Actually V2Ray default is first match. If no match, it falls through to first outbound?
        // Yes, usually first outbound is default.
    }

    const outboundConfig = generateXrayOutbound(config);

    // Fragmentation (sockopt)
    if (settings?.advanced?.fragment?.enabled) {
        if (!outboundConfig.streamSettings) outboundConfig.streamSettings = { network: config.network, security: config.security };
        if (!outboundConfig.streamSettings.sockopt) outboundConfig.streamSettings.sockopt = {};

        outboundConfig.streamSettings.sockopt.dialerProxy = 'fragment';
    }

    const outbounds = [
        outboundConfig,
        { protocol: 'freedom', tag: 'direct' },
        { protocol: 'blackhole', tag: 'block' }
    ];

    if (settings?.advanced?.fragment?.enabled) {
        outbounds.push({
            tag: 'fragment',
            protocol: 'freedom',
            settings: {
                fragment: {
                    packets: settings.advanced.fragment.packets || 'tlshello',
                    length: settings.advanced.fragment.length || '100-200',
                    interval: settings.advanced.fragment.interval || '10-20'
                }
            },
            streamSettings: {
                sockopt: {
                    tcpKeepAliveIdle: 100,
                    mark: 255
                }
            }
        } as any);
    }

    return {
        log: {
            loglevel: logLevel,
            access: accessLog,
            error: errorLog,
        },
        dns: dns,
        inbounds: [
            {
                port: socksPort,
                listen: listenIp,
                protocol: 'socks',
                settings: {
                    auth: 'noauth',
                    udp: udpSupport
                },
                sniffing: {
                    enabled: sniffing,
                    destOverride: ['http', 'tls']
                }
            },
            {
                port: httpPort,
                listen: listenIp,
                protocol: 'http',
                settings: {
                    auth: 'noauth',
                    udp: udpSupport
                },
            },
        ],
        outbounds: outbounds,
        routing: {
            domainStrategy: settings?.routing?.domainStrategy || 'IPIfNonMatch',
            rules: routingRules
        }
    };
}
