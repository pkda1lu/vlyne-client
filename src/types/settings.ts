// Settings types for Xray client

export interface GeneralSettings {
    autoConnect: boolean;
    autoEnableProxy: boolean;
    startOnBoot: boolean;
    minimizeToTray: boolean;
    language: 'en' | 'ru';
    theme: 'dark' | 'light';
}

export type RoutingMode = 'global' | 'bypass-lan' | 'bypass-china' | 'custom';
export type DomainStrategy = 'AsIs' | 'IPIfNonMatch' | 'IPOnDemand';

export interface RoutingSettings {
    mode: RoutingMode;
    domainStrategy: DomainStrategy;
    customRules: RoutingRule[];
}

export interface RoutingRule {
    id: string;
    type: 'domain' | 'ip' | 'port';
    value: string;
    outbound: 'proxy' | 'direct' | 'block';
}

export type DnsStrategy = 'UseIP' | 'UseIPv4' | 'UseIPv6';

export interface DnsSettings {
    primaryDns: string;
    fallbackDns: string;
    strategy: DnsStrategy;
    directDomains: string[];
    proxyDomains: string[];
    blockDomains: string[];
}

export interface InboundSettings {
    socksPort: number;
    httpPort: number;
    allowLan: boolean;
    udpSupport: boolean;
    sniffing: boolean;
}

export type LogLevel = 'none' | 'error' | 'warning' | 'info' | 'debug';

export interface CoreSettings {
    xrayCorePath: string;
    logLevel: LogLevel;
    accessLog: boolean;
    errorLog: boolean;
    enableStats: boolean;
}

export interface MuxSettings {
    enabled: boolean;
    concurrency: number;
}

export interface FragmentSettings {
    enabled: boolean;
    packets: string;
    length: string;
    interval: string;
}

export interface AdvancedSettings {
    mux: MuxSettings;
    fragment: FragmentSettings;
    maxConnections: number;
    connectionTimeout: number;
}

export interface AppSettings {
    general: GeneralSettings;
    routing: RoutingSettings;
    dns: DnsSettings;
    inbound: InboundSettings;
    core: CoreSettings;
    advanced: AdvancedSettings;
}

export const defaultSettings: AppSettings = {
    general: {
        autoConnect: false,
        autoEnableProxy: true,
        startOnBoot: false,
        minimizeToTray: true,
        language: 'en',
        theme: 'dark',
    },
    routing: {
        mode: 'global',
        domainStrategy: 'IPIfNonMatch',
        customRules: [],
    },
    dns: {
        primaryDns: '8.8.8.8',
        fallbackDns: '1.1.1.1',
        strategy: 'UseIP',
        directDomains: [],
        proxyDomains: [],
        blockDomains: [],
    },
    inbound: {
        socksPort: 10806,
        httpPort: 10810,
        allowLan: false,
        udpSupport: true,
        sniffing: true,
    },
    core: {
        xrayCorePath: '',
        logLevel: 'warning',
        accessLog: false,
        errorLog: true,
        enableStats: false,
    },
    advanced: {
        mux: {
            enabled: false,
            concurrency: 8,
        },
        fragment: {
            enabled: false,
            packets: 'tlshello',
            length: '100-200',
            interval: '10-20',
        },
        maxConnections: 0,
        connectionTimeout: 300,
    },
};
