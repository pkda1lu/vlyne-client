//! Domain model: nodes, subscriptions and settings.
//!
//! Everything here is serialised straight to the frontend and to disk, so field
//! names are camelCase and unknown fields are tolerated on read.

use serde::{Deserialize, Serialize};

fn default_true() -> bool {
    true
}

// ---------------------------------------------------------------------------
// Transport / security
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TlsOptions {
    #[serde(default)]
    pub enabled: bool,
    /// SNI. Empty means "use the server address".
    #[serde(default)]
    pub server_name: String,
    #[serde(default)]
    pub insecure: bool,
    #[serde(default)]
    pub alpn: Vec<String>,
    /// uTLS fingerprint (chrome, firefox, safari, ios, random...).
    #[serde(default)]
    pub fingerprint: Option<String>,
    /// REALITY public key. Presence switches REALITY on.
    #[serde(default)]
    pub reality_public_key: Option<String>,
    #[serde(default)]
    pub reality_short_id: Option<String>,
}

impl TlsOptions {
    pub fn is_reality(&self) -> bool {
        self.reality_public_key
            .as_deref()
            .map(|k| !k.is_empty())
            .unwrap_or(false)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Transport {
    /// Plain TCP. sing-box expresses this as the absence of a transport field.
    Tcp,
    #[serde(rename_all = "camelCase")]
    Ws {
        #[serde(default)]
        path: String,
        #[serde(default)]
        host: String,
        /// v2ray-style early data, from the `ed` query parameter.
        #[serde(default)]
        early_data: u32,
        #[serde(default)]
        early_data_header: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Grpc {
        #[serde(default)]
        service_name: String,
    },
    #[serde(rename_all = "camelCase")]
    Http {
        #[serde(default)]
        path: String,
        #[serde(default)]
        host: Vec<String>,
        #[serde(default)]
        method: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    HttpUpgrade {
        #[serde(default)]
        path: String,
        #[serde(default)]
        host: String,
    },
    /// Xray's XHTTP, previously called SplitHTTP. The bundled core implements
    /// it under the `xhttp` name only, so the older name is normalised away at
    /// parse time.
    #[serde(rename_all = "camelCase")]
    Xhttp {
        #[serde(default)]
        path: String,
        #[serde(default)]
        host: String,
        /// One of [`XHTTP_MODES`].
        #[serde(default)]
        mode: String,
        #[serde(default)]
        headers: std::collections::BTreeMap<String, String>,
    },
}

/// The upload modes the core accepts. Anything else makes it refuse the whole
/// configuration, so a node carrying an unknown mode is held back instead.
pub const XHTTP_MODES: [&str; 4] = ["auto", "packet-up", "stream-up", "stream-one"];

impl Default for Transport {
    fn default() -> Self {
        Transport::Tcp
    }
}

impl Transport {
    pub fn is_supported(&self) -> bool {
        match self {
            // An unknown mode is rejected by the core at load time, which would
            // take every other node down with it.
            Transport::Xhttp { mode, .. } => {
                mode.is_empty() || XHTTP_MODES.contains(&mode.as_str())
            }
            _ => true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Multiplex {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_mux_protocol")]
    pub protocol: String,
    #[serde(default = "default_mux_connections")]
    pub max_connections: u32,
    #[serde(default)]
    pub padding: bool,
}

fn default_mux_protocol() -> String {
    "h2mux".to_string()
}

fn default_mux_connections() -> u32 {
    4
}

impl Default for Multiplex {
    fn default() -> Self {
        Self {
            enabled: false,
            protocol: default_mux_protocol(),
            max_connections: default_mux_connections(),
            padding: false,
        }
    }
}

// ---------------------------------------------------------------------------
// Protocol payloads
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "protocol", rename_all = "camelCase")]
pub enum Protocol {
    #[serde(rename_all = "camelCase")]
    Vless {
        uuid: String,
        #[serde(default)]
        flow: Option<String>,
        /// VLESS encryption. "none" for everything but the post-quantum variant.
        #[serde(default)]
        encryption: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Vmess {
        uuid: String,
        #[serde(default)]
        alter_id: u32,
        #[serde(default = "default_vmess_security")]
        security: String,
        #[serde(default)]
        global_padding: bool,
    },
    #[serde(rename_all = "camelCase")]
    Trojan { password: String },
    #[serde(rename_all = "camelCase")]
    Shadowsocks {
        method: String,
        password: String,
        #[serde(default)]
        plugin: Option<String>,
        #[serde(default)]
        plugin_opts: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Hysteria2 {
        password: String,
        #[serde(default)]
        obfs_password: Option<String>,
        #[serde(default)]
        up_mbps: Option<u32>,
        #[serde(default)]
        down_mbps: Option<u32>,
    },
    #[serde(rename_all = "camelCase")]
    Tuic {
        uuid: String,
        password: String,
        #[serde(default)]
        congestion_control: Option<String>,
        #[serde(default)]
        udp_relay_mode: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    AnyTls { password: String },
    #[serde(rename_all = "camelCase")]
    Socks {
        #[serde(default)]
        username: Option<String>,
        #[serde(default)]
        password: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Http {
        #[serde(default)]
        username: Option<String>,
        #[serde(default)]
        password: Option<String>,
    },
}

fn default_vmess_security() -> String {
    "auto".to_string()
}

impl Protocol {
    pub fn kind(&self) -> &'static str {
        match self {
            Protocol::Vless { .. } => "vless",
            Protocol::Vmess { .. } => "vmess",
            Protocol::Trojan { .. } => "trojan",
            Protocol::Shadowsocks { .. } => "shadowsocks",
            Protocol::Hysteria2 { .. } => "hysteria2",
            Protocol::Tuic { .. } => "tuic",
            Protocol::AnyTls { .. } => "anytls",
            Protocol::Socks { .. } => "socks",
            Protocol::Http { .. } => "http",
        }
    }

    /// Whether sing-box accepts a `transport` block on this outbound.
    ///
    /// Only the V2Ray-family protocols layer a stream transport underneath;
    /// giving one to any other outbound makes the core reject the config.
    pub fn supports_transport(&self) -> bool {
        matches!(
            self,
            Protocol::Vless { .. } | Protocol::Vmess { .. } | Protocol::Trojan { .. }
        )
    }

    /// Whether sing-box accepts a `multiplex` block on this outbound.
    ///
    /// AnyTLS multiplexes internally and TUIC/Hysteria2 ride on QUIC streams,
    /// so none of them take the field.
    pub fn supports_multiplex(&self) -> bool {
        matches!(
            self,
            Protocol::Vless { .. }
                | Protocol::Vmess { .. }
                | Protocol::Trojan { .. }
                | Protocol::Shadowsocks { .. }
        )
    }

    /// Whether the outbound carries its TLS inside QUIC.
    ///
    /// uTLS shapes a TLS ClientHello over TCP and has no QUIC equivalent, so
    /// the core answers `unsupported usage for uTLS` on every connection an
    /// outbound like this opens. The config still passes `check`: it only
    /// fails when something actually dials.
    pub fn uses_quic(&self) -> bool {
        matches!(self, Protocol::Hysteria2 { .. } | Protocol::Tuic { .. })
    }
}

// ---------------------------------------------------------------------------
// Node
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Node {
    pub id: String,
    pub name: String,
    pub server: String,
    pub server_port: u16,
    #[serde(flatten)]
    pub protocol: Protocol,
    #[serde(default)]
    pub tls: TlsOptions,
    #[serde(default)]
    pub transport: Transport,
    #[serde(default)]
    pub multiplex: Multiplex,
    /// Subscription this node came from, if any.
    #[serde(default)]
    pub subscription_id: Option<String>,
    /// The original share link, kept verbatim for export and re-parsing.
    #[serde(default)]
    pub link: Option<String>,
    /// Last measured latency in milliseconds. `None` means never tested.
    #[serde(default)]
    pub latency_ms: Option<u32>,
    #[serde(default)]
    pub last_tested_at: Option<i64>,
}

impl Node {
    /// `Some(key)` when sing-box cannot dial this node. The key is a locale id.
    pub fn unsupported_reason(&self) -> Option<&'static str> {
        if !self.transport.is_supported() {
            return Some("transport.xhttpMode");
        }
        None
    }

    /// The SNI actually used on the wire.
    pub fn effective_sni(&self) -> &str {
        if self.tls.server_name.is_empty() {
            &self.server
        } else {
            &self.tls.server_name
        }
    }

    /// Stable identity of the endpoint, used to deduplicate subscription nodes
    /// so that latency history survives a subscription refresh.
    pub fn dedup_key(&self) -> String {
        format!(
            "{}|{}|{}|{}",
            self.protocol.kind(),
            self.server,
            self.server_port,
            self.name
        )
    }
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionUsage {
    #[serde(default)]
    pub upload: u64,
    #[serde(default)]
    pub download: u64,
    /// Zero means unlimited or not reported.
    #[serde(default)]
    pub total: u64,
    /// Unix seconds. Zero means no expiry reported.
    #[serde(default)]
    pub expire: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Subscription {
    pub id: String,
    pub name: String,
    pub url: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub last_updated_at: Option<i64>,
    #[serde(default)]
    pub last_error: Option<String>,
    #[serde(default)]
    pub usage: Option<SubscriptionUsage>,
    #[serde(default)]
    pub node_count: usize,
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TunnelMode {
    /// Local SOCKS/HTTP inbounds plus the Windows system proxy.
    SystemProxy,
    /// A virtual adapter capturing all traffic. Requires elevation.
    Tun,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RoutingPreset {
    /// Everything through the proxy except loopback.
    Global,
    /// Private ranges stay direct, the rest is proxied.
    BypassLan,
    /// Private ranges plus Russian IPs and domains stay direct.
    BypassRu,
    /// Only the user's own rules decide.
    Custom,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RuleTarget {
    Proxy,
    Direct,
    Block,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RuleKind {
    Domain,
    DomainSuffix,
    DomainKeyword,
    DomainRegex,
    IpCidr,
    Port,
    ProcessName,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutingRule {
    pub id: String,
    pub kind: RuleKind,
    pub value: String,
    pub target: RuleTarget,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneralSettings {
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default)]
    pub launch_at_login: bool,
    #[serde(default)]
    pub start_minimized: bool,
    #[serde(default = "default_true")]
    pub close_to_tray: bool,
    #[serde(default)]
    pub auto_connect: bool,
    #[serde(default = "default_true")]
    pub check_updates: bool,
}

fn default_language() -> String {
    "ru".into()
}

/// How subscriptions keep themselves current.
///
/// The cadence is one setting for the whole app rather than one per
/// subscription: a user who wants their servers fresh wants all of them
/// fresh, and a per-source interval was a knob nobody could see.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionSettings {
    /// Re-fetch every subscription once its interval has elapsed.
    #[serde(default = "default_true")]
    pub auto_update: bool,
    /// Hours between refreshes. Clamped on use, so a hand-edited profile
    /// cannot ask for a refresh every second.
    #[serde(default = "default_update_interval_hours")]
    pub update_interval_hours: u32,
    /// Check every subscription shortly after launch, whatever the interval
    /// says. This is what catches a plan that expired while the app was shut.
    #[serde(default = "default_true")]
    pub check_on_start: bool,
}

pub const MIN_UPDATE_INTERVAL_HOURS: u32 = 1;
pub const MAX_UPDATE_INTERVAL_HOURS: u32 = 24 * 7;

fn default_update_interval_hours() -> u32 {
    12
}

impl Default for SubscriptionSettings {
    fn default() -> Self {
        Self {
            auto_update: true,
            update_interval_hours: default_update_interval_hours(),
            check_on_start: true,
        }
    }
}

impl SubscriptionSettings {
    /// The interval actually used, in seconds.
    pub fn interval_seconds(&self) -> i64 {
        self.update_interval_hours
            .clamp(MIN_UPDATE_INTERVAL_HOURS, MAX_UPDATE_INTERVAL_HOURS) as i64
            * 3600
    }
}

impl Default for GeneralSettings {
    fn default() -> Self {
        Self {
            language: default_language(),
            launch_at_login: false,
            start_minimized: false,
            close_to_tray: true,
            auto_connect: false,
            check_updates: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InboundSettings {
    #[serde(default = "default_socks_port")]
    pub socks_port: u16,
    #[serde(default = "default_http_port")]
    pub http_port: u16,
    /// Clash API port, used for traffic statistics and selector switching.
    #[serde(default = "default_clash_port")]
    pub clash_port: u16,
    /// First of a small run of loopback ports used to measure node latency.
    /// The core reserves one per concurrent probe.
    #[serde(default = "default_probe_port")]
    pub probe_port: u16,
    #[serde(default)]
    pub allow_lan: bool,
}

// 10808/10809 are the v2rayN convention that nearly every client copies, so
// defaulting to them guarantees a clash with whatever else is installed.
fn default_socks_port() -> u16 {
    17080
}
fn default_http_port() -> u16 {
    17081
}
fn default_probe_port() -> u16 {
    17100
}
fn default_clash_port() -> u16 {
    17090
}

impl Default for InboundSettings {
    fn default() -> Self {
        Self {
            socks_port: default_socks_port(),
            http_port: default_http_port(),
            clash_port: default_clash_port(),
            probe_port: default_probe_port(),
            allow_lan: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutingSettings {
    #[serde(default = "default_preset")]
    pub preset: RoutingPreset,
    #[serde(default)]
    pub rules: Vec<RoutingRule>,
    #[serde(default)]
    pub block_ads: bool,
    /// Reject QUIC on direct traffic so browsers fall back to TCP, which the
    /// system proxy can actually see.
    #[serde(default = "default_true")]
    pub block_quic_for_direct: bool,
    /// Processes that never enter the tunnel. TUN mode only.
    #[serde(default)]
    pub bypass_processes: Vec<String>,
}

fn default_preset() -> RoutingPreset {
    RoutingPreset::BypassLan
}

impl Default for RoutingSettings {
    fn default() -> Self {
        Self {
            preset: default_preset(),
            rules: Vec::new(),
            block_ads: false,
            block_quic_for_direct: true,
            bypass_processes: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DnsSettings {
    #[serde(default = "default_remote_dns")]
    pub remote: String,
    #[serde(default = "default_direct_dns")]
    pub direct: String,
    #[serde(default = "default_true")]
    pub enable_fakeip: bool,
    #[serde(default)]
    pub disable_cache: bool,
}

fn default_remote_dns() -> String {
    "https://1.1.1.1/dns-query".into()
}
fn default_direct_dns() -> String {
    "https://77.88.8.8/dns-query".into()
}

impl Default for DnsSettings {
    fn default() -> Self {
        Self {
            remote: default_remote_dns(),
            direct: default_direct_dns(),
            enable_fakeip: true,
            disable_cache: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TunSettings {
    #[serde(default = "default_mtu")]
    pub mtu: u32,
    #[serde(default = "default_true")]
    pub strict_route: bool,
    #[serde(default = "default_true")]
    pub auto_route: bool,
    #[serde(default)]
    pub ipv6: bool,
}

fn default_mtu() -> u32 {
    9000
}

impl Default for TunSettings {
    fn default() -> Self {
        Self {
            mtu: default_mtu(),
            strict_route: true,
            auto_route: true,
            ipv6: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeSettings {
    #[serde(default = "default_probe_url")]
    pub url: String,
    #[serde(default = "default_probe_timeout")]
    pub timeout_ms: u32,
    /// How often the automatic selector re-measures its members. This is what
    /// makes automatic mode move off a node that has stopped answering.
    #[serde(default = "default_probe_interval")]
    pub interval_s: u32,
}

fn default_probe_url() -> String {
    "https://www.gstatic.com/generate_204".into()
}
fn default_probe_timeout() -> u32 {
    5000
}
fn default_probe_interval() -> u32 {
    60
}

impl Default for ProbeSettings {
    fn default() -> Self {
        Self {
            url: default_probe_url(),
            timeout_ms: default_probe_timeout(),
            interval_s: default_probe_interval(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreSettings {
    #[serde(default = "default_log_level")]
    pub log_level: String,
    #[serde(default)]
    pub multiplex: Multiplex,
    /// Extra JSON deep-merged into the generated sing-box config.
    #[serde(default)]
    pub config_override: Option<String>,
}

fn default_log_level() -> String {
    "warn".into()
}

impl Default for CoreSettings {
    fn default() -> Self {
        Self {
            log_level: default_log_level(),
            multiplex: Multiplex::default(),
            config_override: None,
        }
    }
}

/// Newtype so `Settings` can derive `Default` while `mode` still defaults sanely.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(transparent)]
pub struct TunnelModeSetting(pub TunnelMode);

impl Default for TunnelModeSetting {
    fn default() -> Self {
        TunnelModeSetting(TunnelMode::SystemProxy)
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(default)]
    pub general: GeneralSettings,
    #[serde(default)]
    pub subscriptions: SubscriptionSettings,
    #[serde(default)]
    pub mode: TunnelModeSetting,
    #[serde(default)]
    pub inbound: InboundSettings,
    #[serde(default)]
    pub routing: RoutingSettings,
    #[serde(default)]
    pub dns: DnsSettings,
    #[serde(default)]
    pub tun: TunSettings,
    #[serde(default)]
    pub probe: ProbeSettings,
    #[serde(default)]
    pub core: CoreSettings,
}

// ---------------------------------------------------------------------------
// Persisted document
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppData {
    #[serde(default)]
    pub nodes: Vec<Node>,
    #[serde(default)]
    pub subscriptions: Vec<Subscription>,
    #[serde(default)]
    pub active_node_id: Option<String>,
    #[serde(default)]
    pub settings: Settings,
    /// Link to the Vlyne service. Holds a credential, so it is deliberately
    /// kept out of `Settings`, which the config preview renders verbatim.
    #[serde(default)]
    pub account: crate::account::Account,
}

// ---------------------------------------------------------------------------
// Runtime status pushed to the UI
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConnectionState {
    Disconnected,
    Connecting,
    Connected,
    /// The core died or never became ready. `Status::error` explains why.
    Failed,
    Stopping,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub state: ConnectionState,
    pub mode: TunnelMode,
    #[serde(default)]
    pub node_id: Option<String>,
    #[serde(default)]
    pub node_name: Option<String>,
    #[serde(default)]
    pub connected_since: Option<i64>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub system_proxy_active: bool,
    #[serde(default)]
    pub elevated: bool,
}

impl Default for Status {
    fn default() -> Self {
        Self {
            state: ConnectionState::Disconnected,
            mode: TunnelMode::SystemProxy,
            node_id: None,
            node_name: None,
            connected_since: None,
            error: None,
            system_proxy_active: false,
            elevated: false,
        }
    }
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Traffic {
    pub up: u64,
    pub down: u64,
    pub total_up: u64,
    pub total_down: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The frontend mirrors this shape by hand in `src/lib/types.ts`, so the
    /// exact wire form is part of the contract rather than an implementation
    /// detail.
    #[test]
    fn default_settings_serialise_the_way_the_ui_expects() {
        let json = serde_json::to_value(Settings::default()).unwrap();

        assert_eq!(json["mode"], serde_json::json!("systemProxy"));
        assert_eq!(json["general"]["language"], serde_json::json!("ru"));
        assert_eq!(json["routing"]["preset"], serde_json::json!("bypass-lan"));
        assert_eq!(json["inbound"]["socksPort"], serde_json::json!(17080));
        assert_eq!(json["probe"]["intervalS"], serde_json::json!(60));
    }

    /// The selected server is persisted in the profile and handed to the UI by
    /// `bootstrap`, so both directions have to keep the field.
    #[test]
    fn active_node_id_survives_a_load_and_serialise_round_trip() {
        let on_disk = r#"{
            "nodes": [],
            "subscriptions": [],
            "activeNodeId": "n2",
            "settings": {}
        }"#;

        let data: AppData = serde_json::from_str(on_disk).unwrap();
        assert_eq!(data.active_node_id.as_deref(), Some("n2"));

        let out = serde_json::to_value(&data).unwrap();
        assert_eq!(out["activeNodeId"], serde_json::json!("n2"));
    }

    #[test]
    fn tunnel_mode_round_trips_through_json() {
        for mode in [TunnelMode::SystemProxy, TunnelMode::Tun] {
            let json = serde_json::to_string(&TunnelModeSetting(mode)).unwrap();
            let back: TunnelModeSetting = serde_json::from_str(&json).unwrap();
            assert_eq!(back.0, mode);
        }
        assert_eq!(
            serde_json::to_string(&TunnelModeSetting::default()).unwrap(),
            "\"systemProxy\""
        );
    }

    /// A profile written by an older build must not reset the user's settings.
    #[test]
    fn a_partial_profile_fills_in_defaults() {
        let data: AppData =
            serde_json::from_str(r#"{"settings":{"general":{"language":"en"}}}"#).unwrap();

        assert_eq!(data.settings.general.language, "en");
        assert_eq!(data.settings.mode.0, TunnelMode::SystemProxy);
        assert_eq!(data.settings.inbound.socks_port, 17080);
        assert!(data.nodes.is_empty());

        // Subscriptions kept themselves current before the setting existed,
        // so a profile predating it must come back updating, not idle.
        assert!(data.settings.subscriptions.auto_update);
        assert!(data.settings.subscriptions.check_on_start);
        assert_eq!(data.settings.subscriptions.update_interval_hours, 12);
    }

    /// A hand-edited profile must not be able to ask for a refresh loop.
    #[test]
    fn the_update_interval_is_clamped() {
        let mut settings = SubscriptionSettings::default();
        assert_eq!(settings.interval_seconds(), 12 * 3600);

        settings.update_interval_hours = 0;
        assert_eq!(settings.interval_seconds(), 3600);

        settings.update_interval_hours = 10_000;
        assert_eq!(settings.interval_seconds(), 24 * 7 * 3600);
    }
}
