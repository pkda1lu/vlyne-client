/**
 * Mirrors the Rust model in `src-tauri/src/model.rs`.
 *
 * Kept hand-written rather than generated: the surface is small, and an
 * explicit mirror makes a backend change fail loudly at the type level.
 */

export type Protocol =
  | 'vless'
  | 'vmess'
  | 'trojan'
  | 'shadowsocks'
  | 'hysteria2'
  | 'tuic'
  | 'anytls'
  | 'socks'
  | 'http';

export interface TlsOptions {
  enabled: boolean;
  serverName: string;
  insecure: boolean;
  alpn: string[];
  fingerprint?: string | null;
  realityPublicKey?: string | null;
  realityShortId?: string | null;
}

export type TransportType = 'tcp' | 'ws' | 'grpc' | 'http' | 'httpUpgrade' | 'xhttp';

/** XHTTP upload modes the core accepts. Mirrors `XHTTP_MODES` in `model.rs`. */
export const XHTTP_MODES = ['auto', 'packet-up', 'stream-up', 'stream-one'] as const;

export interface Transport {
  type: TransportType;
  path?: string;
  host?: string | string[];
  serviceName?: string;
  earlyData?: number;
  mode?: string;
  headers?: Record<string, string>;
}

/**
 * Whether the core can dial this node.
 *
 * The only thing it refuses outright is an XHTTP mode it does not know, which
 * would make it reject the whole configuration rather than just this node.
 */
export function isNodeUsable(node: Node): boolean {
  if (node.transport.type !== 'xhttp') return true;
  const mode = node.transport.mode;
  return !mode || (XHTTP_MODES as readonly string[]).includes(mode);
}

export interface Multiplex {
  enabled: boolean;
  protocol: string;
  maxConnections: number;
  padding: boolean;
}

/** Protocol-specific fields are flattened into the node by serde. */
export interface Node {
  id: string;
  name: string;
  server: string;
  serverPort: number;
  protocol: Protocol;
  tls: TlsOptions;
  transport: Transport;
  multiplex: Multiplex;
  subscriptionId?: string | null;
  link?: string | null;
  latencyMs?: number | null;
  lastTestedAt?: number | null;

  uuid?: string;
  password?: string;
  method?: string;
  flow?: string | null;
  alterId?: number;
  security?: string;
}

export interface SubscriptionUsage {
  upload: number;
  download: number;
  /** Zero means unlimited or not reported. */
  total: number;
  /** Unix seconds. Zero means no expiry reported. */
  expire: number;
}

export interface Subscription {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  lastUpdatedAt?: number | null;
  lastError?: string | null;
  usage?: SubscriptionUsage | null;
  nodeCount: number;
}

export type TunnelMode = 'systemProxy' | 'tun';
export type RoutingPreset = 'global' | 'bypass-lan' | 'bypass-ru' | 'custom';
export type RuleTarget = 'proxy' | 'direct' | 'block';
export type RuleKind =
  | 'domain'
  | 'domainSuffix'
  | 'domainKeyword'
  | 'domainRegex'
  | 'ipCidr'
  | 'port'
  | 'processName';

export interface RoutingRule {
  id: string;
  kind: RuleKind;
  value: string;
  target: RuleTarget;
  enabled: boolean;
}

export interface Settings {
  general: {
    language: string;
    launchAtLogin: boolean;
    startMinimized: boolean;
    closeToTray: boolean;
    autoConnect: boolean;
    checkUpdates: boolean;
  };
  subscriptions: {
    /** Re-fetch every subscription once its interval has elapsed. */
    autoUpdate: boolean;
    updateIntervalHours: number;
    /** Check them all shortly after launch, whatever the interval says. */
    checkOnStart: boolean;
  };
  mode: TunnelMode;
  inbound: {
    socksPort: number;
    httpPort: number;
    clashPort: number;
    allowLan: boolean;
  };
  routing: {
    preset: RoutingPreset;
    rules: RoutingRule[];
    blockAds: boolean;
    blockQuicForDirect: boolean;
    bypassProcesses: string[];
  };
  dns: {
    remote: string;
    direct: string;
    enableFakeip: boolean;
    disableCache: boolean;
  };
  tun: {
    mtu: number;
    strictRoute: boolean;
    autoRoute: boolean;
    ipv6: boolean;
  };
  probe: {
    url: string;
    timeoutMs: number;
    intervalS: number;
  };
  core: {
    logLevel: string;
    multiplex: Multiplex;
    configOverride?: string | null;
  };
}

export interface AppData {
  nodes: Node[];
  subscriptions: Subscription[];
  activeNodeId?: string | null;
  settings: Settings;
}

export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'failed'
  | 'stopping';

export interface Status {
  state: ConnectionState;
  mode: TunnelMode;
  nodeId?: string | null;
  nodeName?: string | null;
  connectedSince?: number | null;
  error?: string | null;
  systemProxyActive: boolean;
  elevated: boolean;
}

export interface Traffic {
  up: number;
  down: number;
  totalUp: number;
  totalDown: number;
}

export interface LogLine {
  at: number;
  text: string;
}

export interface Bootstrap {
  data: AppData;
  status: Status;
  traffic: Traffic;
  appVersion: string;
  coreVersion: string;
  elevated: boolean;
  logs: LogLine[];
}

/** The shape `Error` serialises to on the Rust side. */
export interface IpcError {
  code: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Account and shop
// ---------------------------------------------------------------------------

export interface AccountInfo {
  linked: boolean;
  userId?: number | null;
  linkedAt?: number | null;
  apiBase: string;
}

export type PayMethod = 'yookassa' | 'cryptobot';

/**
 * The shop payload, passed through from the service untouched.
 *
 * Keys are snake_case because they come straight from the same API the
 * Telegram mini app uses; renaming them here would mean editing two places
 * every time the shop gains a field.
 */
export interface ShopState {
  subscription: {
    url?: string | null;
    qr?: string | null;
    unlimited: boolean;
    used: number;
    used_h: string;
    limit: number;
    limit_h: string;
    left: number;
    left_h: string;
    percent: number;
    extra: number;
    extra_h: string;
    free_gb: number;
    period_end: string;
  };
  referral: {
    code: string;
    link?: string;
    invited: number;
    purchases: number;
    earned_gb: number;
    percent: number;
    welcome_gb: number;
    legacy_balance: number;
  };
  packs: { code: string; gb: number; price: number; bonus_gb: number }[];
  user?: { id: number; name: string };
  support?: string;
  cryptobot?: boolean;
}

export interface BuyResult {
  /** Set when a full-discount promo credited the traffic outright. */
  free?: boolean;
  order_id: number | string;
  url?: string;
  price?: number;
}

export interface CheckResult {
  status?: string;
  paid?: boolean;
  credited?: boolean;
  message?: string;
}
