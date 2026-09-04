//! Generation of sing-box configuration.
//!
//! Targets the sing-box 1.12 schema: rule actions instead of a `block`
//! outbound, `sniff`/`hijack-dns` as actions, and `rule_set` files for geo data.

use serde_json::{json, Map, Value};

use crate::error::{Error, Result};
use crate::model::{
    DnsSettings, Node, Protocol, RoutingPreset, RoutingSettings, RuleKind, RuleTarget, Settings,
    Transport, TunnelMode,
};

/// Tag of the selector every route ultimately points at.
pub const TAG_PROXY: &str = "proxy";
/// Tag of the latency-based automatic selector.
pub const TAG_AUTO: &str = "auto";
/// Tag of the outbound that leaves the machine untouched.
pub const TAG_DIRECT: &str = "direct";

/// How many nodes can be measured at once.
///
/// A selector can only point at one node at a time, so each concurrent probe
/// needs its own selector and its own loopback inbound to reach it.
pub const PROBE_LANES: u16 = 8;

/// Tag of the selector serving probe lane `lane`.
pub fn probe_selector_tag(lane: u16) -> String {
    format!("probe-{lane}")
}

fn probe_inbound_tag(lane: u16) -> String {
    format!("probe-in-{lane}")
}

/// Loopback port that reaches probe lane `lane`, given the run's base port.
pub fn probe_port(base: u16, lane: u16) -> u16 {
    base.saturating_add(lane)
}

/// Find a free run of [`PROBE_LANES`] consecutive loopback ports at or above
/// `preferred`.
///
/// A single occupied port would otherwise stop the core from starting at all,
/// which would trade a working tunnel for a latency feature.
pub fn find_probe_base(preferred: u16) -> Option<u16> {
    let is_free = |port: u16| std::net::TcpListener::bind(("127.0.0.1", port)).is_ok();

    let start = preferred.max(1024);
    let mut base = start;
    while base.checked_add(PROBE_LANES).is_some() && base < start.saturating_add(400) {
        if (0..PROBE_LANES).all(|lane| is_free(base + lane)) {
            return Some(base);
        }
        base = base.saturating_add(PROBE_LANES);
    }
    None
}

/// Host the connectivity check asks for its view of our public address.
///
/// Shared with `commands::check_connectivity` so the routing exception and the
/// request can never point at different places.
pub const CONNECTIVITY_HOST: &str = "api.ipify.org";

const DNS_REMOTE: &str = "dns-remote";
const DNS_DIRECT: &str = "dns-direct";
const DNS_FAKEIP: &str = "dns-fakeip";

/// Paths the generated config points at. Resolved by the caller so that the
/// generator itself stays free of filesystem concerns and is easy to test.
#[derive(Debug, Clone)]
pub struct CorePaths {
    /// Directory holding bundled `.srs` rule sets.
    pub rule_sets_dir: String,
    /// Where sing-box may keep its cache database.
    pub cache_file: String,
}

/// Everything the generator needs beyond the user's settings.
#[derive(Debug, Clone)]
pub struct GenerateArgs<'a> {
    /// Every node the user has. They all become outbounds so that switching
    /// between them, and measuring their latency, needs no core restart.
    pub nodes: &'a [Node],
    /// Which node the selector starts on. `None` starts on automatic.
    pub active_id: Option<&'a str>,
    pub settings: &'a Settings,
    pub paths: &'a CorePaths,
    /// Secret guarding the Clash API. Generated fresh per run.
    pub clash_secret: &'a str,
    /// First loopback port of the probe lanes, already checked to be free.
    /// `None` leaves the lanes out, which only costs latency measurement.
    pub probe_base: Option<u16>,
}

/// Maps a node id to the outbound tag it was given, so the UI can address
/// nodes over the Clash API.
#[derive(Debug, Clone)]
pub struct TagMap(pub Vec<(String, String)>);

impl TagMap {
    pub fn tag_of(&self, node_id: &str) -> Option<&str> {
        self.0
            .iter()
            .find(|(id, _)| id == node_id)
            .map(|(_, tag)| tag.as_str())
    }

    pub fn node_of(&self, tag: &str) -> Option<&str> {
        self.0
            .iter()
            .find(|(_, t)| t == tag)
            .map(|(id, _)| id.as_str())
    }
}

/// Outbound tags must be unique and must not collide with the reserved ones.
fn assign_tags(nodes: &[&Node]) -> Vec<String> {
    let mut used: Vec<String> = vec![
        TAG_PROXY.into(),
        TAG_AUTO.into(),
        TAG_DIRECT.into(),
    ];
    used.extend((0..PROBE_LANES).map(probe_selector_tag));
    let mut tags = Vec::with_capacity(nodes.len());

    for node in nodes {
        let base = {
            let trimmed = node.name.trim();
            if trimmed.is_empty() {
                format!("{}:{}", node.server, node.server_port)
            } else {
                trimmed.to_string()
            }
        };

        let mut candidate = base.clone();
        let mut n = 2;
        while used.contains(&candidate) {
            candidate = format!("{base} ({n})");
            n += 1;
        }
        used.push(candidate.clone());
        tags.push(candidate);
    }

    tags
}

// ---------------------------------------------------------------------------
// Outbound
// ---------------------------------------------------------------------------

fn tls_object(node: &Node) -> Option<Value> {
    if !node.tls.enabled {
        return None;
    }

    let mut tls = Map::new();
    tls.insert("enabled".into(), json!(true));
    tls.insert("server_name".into(), json!(node.effective_sni()));

    if node.tls.insecure {
        tls.insert("insecure".into(), json!(true));
    }
    if !node.tls.alpn.is_empty() {
        tls.insert("alpn".into(), json!(node.tls.alpn));
    }

    // REALITY mandates uTLS, so force a fingerprint when the node omits one.
    if node.tls.is_reality() {
        let mut reality = Map::new();
        reality.insert("enabled".into(), json!(true));
        reality.insert(
            "public_key".into(),
            json!(node.tls.reality_public_key.clone().unwrap_or_default()),
        );
        reality.insert(
            "short_id".into(),
            json!(node.tls.reality_short_id.clone().unwrap_or_default()),
        );
        tls.insert("reality".into(), Value::Object(reality));
        tls.insert(
            "utls".into(),
            json!({
                "enabled": true,
                "fingerprint": node.tls.fingerprint.as_deref().unwrap_or("chrome"),
            }),
        );
    } else if let Some(fp) = node.tls.fingerprint.as_deref().filter(|f| !f.is_empty()) {
        tls.insert("utls".into(), json!({ "enabled": true, "fingerprint": fp }));
    }

    Some(Value::Object(tls))
}

fn transport_object(node: &Node) -> Option<Value> {
    match &node.transport {
        // sing-box represents raw TCP as the absence of a transport.
        Transport::Tcp => None,
        Transport::Ws {
            path,
            host,
            early_data,
            early_data_header,
        } => {
            let mut o = Map::new();
            o.insert("type".into(), json!("ws"));
            o.insert(
                "path".into(),
                json!(if path.is_empty() { "/" } else { path }),
            );
            if !host.is_empty() {
                o.insert("headers".into(), json!({ "Host": host }));
            }
            if *early_data > 0 {
                o.insert("max_early_data".into(), json!(early_data));
                o.insert(
                    "early_data_header_name".into(),
                    json!(early_data_header
                        .as_deref()
                        .unwrap_or("Sec-WebSocket-Protocol")),
                );
            }
            Some(Value::Object(o))
        }
        Transport::Grpc { service_name } => Some(json!({
            "type": "grpc",
            "service_name": service_name,
        })),
        Transport::Http { path, host, method } => {
            let mut o = Map::new();
            o.insert("type".into(), json!("http"));
            o.insert(
                "path".into(),
                json!(if path.is_empty() { "/" } else { path }),
            );
            if !host.is_empty() {
                o.insert("host".into(), json!(host));
            }
            if let Some(m) = method.as_deref().filter(|m| !m.is_empty()) {
                o.insert("method".into(), json!(m));
            }
            Some(Value::Object(o))
        }
        Transport::HttpUpgrade { path, host } => {
            let mut o = Map::new();
            o.insert("type".into(), json!("httpupgrade"));
            o.insert(
                "path".into(),
                json!(if path.is_empty() { "/" } else { path }),
            );
            if !host.is_empty() {
                o.insert("host".into(), json!(host));
            }
            Some(Value::Object(o))
        }
        Transport::Xhttp {
            path,
            host,
            mode,
            headers,
        } => {
            let mut o = Map::new();
            o.insert("type".into(), json!("xhttp"));
            o.insert(
                "path".into(),
                json!(if path.is_empty() { "/" } else { path }),
            );
            if !host.is_empty() {
                o.insert("host".into(), json!(host));
            }
            // The core defaults to "auto"; sending an empty string is an error.
            if !mode.is_empty() {
                o.insert("mode".into(), json!(mode));
            }
            if !headers.is_empty() {
                o.insert("headers".into(), json!(headers));
            }
            Some(Value::Object(o))
        }
    }
}

fn multiplex_object(node: &Node, settings: &Settings) -> Option<Value> {
    // A per-node setting wins; otherwise fall back to the global default.
    let mux = if node.multiplex.enabled {
        &node.multiplex
    } else {
        &settings.core.multiplex
    };
    if !mux.enabled {
        return None;
    }
    Some(json!({
        "enabled": true,
        "protocol": mux.protocol,
        "max_connections": mux.max_connections,
        "padding": mux.padding,
    }))
}

/// Build a single node outbound under the given tag.
pub fn build_outbound(node: &Node, settings: &Settings, tag: &str) -> Result<Value> {
    if let Some(reason) = node.unsupported_reason() {
        return Err(Error::UnsupportedNode(reason.to_string()));
    }

    let mut o = Map::new();
    o.insert("tag".into(), json!(tag));
    o.insert("type".into(), json!(node.protocol.kind()));
    o.insert("server".into(), json!(node.server));
    o.insert("server_port".into(), json!(node.server_port));

    match &node.protocol {
        Protocol::Vless {
            uuid,
            flow,
            encryption,
        } => {
            o.insert("uuid".into(), json!(uuid));
            // An empty flow must be omitted entirely: sing-box rejects "".
            if let Some(f) = flow.as_deref().filter(|f| !f.is_empty()) {
                o.insert("flow".into(), json!(f));
            }
            // "none" is the default and is not a valid explicit value.
            if let Some(e) = encryption
                .as_deref()
                .filter(|e| !e.is_empty() && *e != "none")
            {
                o.insert("encryption".into(), json!(e));
            }
            o.insert("packet_encoding".into(), json!("xudp"));
        }
        Protocol::Vmess {
            uuid,
            alter_id,
            security,
            global_padding,
        } => {
            o.insert("uuid".into(), json!(uuid));
            o.insert("security".into(), json!(security));
            if *alter_id > 0 {
                o.insert("alter_id".into(), json!(alter_id));
            }
            if *global_padding {
                o.insert("global_padding".into(), json!(true));
            }
            o.insert("packet_encoding".into(), json!("xudp"));
        }
        Protocol::Trojan { password } => {
            o.insert("password".into(), json!(password));
        }
        Protocol::Shadowsocks {
            method,
            password,
            plugin,
            plugin_opts,
        } => {
            o.insert("method".into(), json!(method));
            o.insert("password".into(), json!(password));
            if let Some(p) = plugin.as_deref().filter(|p| !p.is_empty()) {
                o.insert("plugin".into(), json!(p));
                if let Some(opts) = plugin_opts.as_deref().filter(|p| !p.is_empty()) {
                    o.insert("plugin_opts".into(), json!(opts));
                }
            }
        }
        Protocol::Hysteria2 {
            password,
            obfs_password,
            up_mbps,
            down_mbps,
        } => {
            o.insert("password".into(), json!(password));
            if let Some(obfs) = obfs_password.as_deref().filter(|p| !p.is_empty()) {
                o.insert(
                    "obfs".into(),
                    json!({ "type": "salamander", "password": obfs }),
                );
            }
            if let Some(up) = up_mbps {
                o.insert("up_mbps".into(), json!(up));
            }
            if let Some(down) = down_mbps {
                o.insert("down_mbps".into(), json!(down));
            }
        }
        Protocol::Tuic {
            uuid,
            password,
            congestion_control,
            udp_relay_mode,
        } => {
            o.insert("uuid".into(), json!(uuid));
            o.insert("password".into(), json!(password));
            o.insert(
                "congestion_control".into(),
                json!(congestion_control.as_deref().unwrap_or("bbr")),
            );
            if let Some(mode) = udp_relay_mode.as_deref().filter(|m| !m.is_empty()) {
                o.insert("udp_relay_mode".into(), json!(mode));
            }
        }
        Protocol::AnyTls { password } => {
            o.insert("password".into(), json!(password));
        }
        Protocol::Socks { username, password } => {
            o.insert("version".into(), json!("5"));
            if let Some(u) = username.as_deref().filter(|u| !u.is_empty()) {
                o.insert("username".into(), json!(u));
                o.insert("password".into(), json!(password.as_deref().unwrap_or("")));
            }
        }
        Protocol::Http { username, password } => {
            if let Some(u) = username.as_deref().filter(|u| !u.is_empty()) {
                o.insert("username".into(), json!(u));
                o.insert("password".into(), json!(password.as_deref().unwrap_or("")));
            }
        }
    }

    if let Some(tls) = tls_object(node) {
        o.insert("tls".into(), tls);
    }

    if node.protocol.supports_transport() {
        if let Some(t) = transport_object(node) {
            o.insert("transport".into(), t);
        }
    }
    if node.protocol.supports_multiplex() {
        if let Some(m) = multiplex_object(node, settings) {
            o.insert("multiplex".into(), m);
        }
    }

    Ok(Value::Object(o))
}

// ---------------------------------------------------------------------------
// Inbounds
// ---------------------------------------------------------------------------

fn build_inbounds(settings: &Settings, probe_base: Option<u16>) -> Vec<Value> {
    let listen = if settings.inbound.allow_lan {
        "0.0.0.0"
    } else {
        "127.0.0.1"
    };

    // A mixed inbound serves both SOCKS and HTTP on one port, and is present in
    // TUN mode too so that apps configured by hand keep working.
    let mut inbounds = vec![json!({
        "type": "mixed",
        "tag": "mixed-in",
        "listen": listen,
        "listen_port": settings.inbound.socks_port,
    })];

    // The HTTP port is what the Windows system proxy points at. Keeping it a
    // separate inbound means the system proxy never depends on SOCKS support.
    if settings.inbound.http_port != settings.inbound.socks_port {
        inbounds.push(json!({
            "type": "http",
            "tag": "http-in",
            "listen": listen,
            "listen_port": settings.inbound.http_port,
        }));
    }

    // One loopback SOCKS inbound per probe lane. They are bound to 127.0.0.1
    // regardless of the LAN setting: nothing outside this machine has any
    // business steering a probe selector.
    if let Some(base) = probe_base {
        for lane in 0..PROBE_LANES {
            inbounds.push(json!({
                "type": "socks",
                "tag": probe_inbound_tag(lane),
                "listen": "127.0.0.1",
                "listen_port": probe_port(base, lane),
            }));
        }
    }

    if settings.mode.0 == TunnelMode::Tun {
        let mut tun = Map::new();
        tun.insert("type".into(), json!("tun"));
        tun.insert("tag".into(), json!("tun-in"));
        tun.insert("mtu".into(), json!(settings.tun.mtu));
        tun.insert("auto_route".into(), json!(settings.tun.auto_route));
        tun.insert("strict_route".into(), json!(settings.tun.strict_route));
        tun.insert("stack".into(), json!("mixed"));

        let mut address = vec![json!("172.19.0.1/30")];
        if settings.tun.ipv6 {
            address.push(json!("fdfe:dcba:9876::1/126"));
        }
        tun.insert("address".into(), Value::Array(address));

        inbounds.push(Value::Object(tun));
    }

    inbounds
}

// ---------------------------------------------------------------------------
// DNS
// ---------------------------------------------------------------------------

const DNS_BOOTSTRAP: &str = "dns-bootstrap";

/// Turn a user-facing DNS address into a sing-box 1.14 server object.
///
/// The 1.14 schema replaced the single `address` string with an explicit
/// transport type, so `https://1.1.1.1/dns-query` becomes
/// `{"type":"https","server":"1.1.1.1","path":"/dns-query"}`.
fn dns_server(tag: &str, address: &str, resolver: Option<&str>, detour: &str) -> Value {
    let mut o = Map::new();
    o.insert("tag".into(), json!(tag));

    let address = address.trim();

    // "local" names the system resolver and carries no host at all.
    if address.eq_ignore_ascii_case("local") {
        o.insert("type".into(), json!("local"));
        return Value::Object(o);
    }

    let (scheme, rest) = match address.split_once("://") {
        Some((s, r)) => (s.to_ascii_lowercase(), r),
        // A bare host or IP means classic DNS over UDP.
        None => ("udp".to_string(), address),
    };

    match scheme.as_str() {
        "local" => {
            o.insert("type".into(), json!("local"));
            return Value::Object(o);
        }
        "https" | "h3" | "tls" | "quic" | "udp" | "tcp" => {
            let (host, path) = match rest.split_once('/') {
                Some((h, p)) => (h, Some(format!("/{p}"))),
                None => (rest, None),
            };
            let (host, port) = split_host_port(host);

            o.insert("type".into(), json!(scheme));
            o.insert("server".into(), json!(host));
            if let Some(port) = port {
                o.insert("server_port".into(), json!(port));
            }
            // Only the HTTP-based transports carry a path.
            if let Some(path) = path.filter(|_| scheme == "https" || scheme == "h3") {
                o.insert("path".into(), json!(path));
            }
        }
        _ => {
            // Unknown scheme: fall back to UDP against the literal host so a
            // typo degrades to a working resolver rather than a broken config.
            o.insert("type".into(), json!("udp"));
            o.insert("server".into(), json!(rest));
        }
    }

    // A resolver is only needed when the server is named rather than numeric.
    if let Some(resolver) = resolver {
        let is_ip = o
            .get("server")
            .and_then(Value::as_str)
            .map(|s| s.parse::<std::net::IpAddr>().is_ok())
            .unwrap_or(false);
        if !is_ip {
            o.insert("domain_resolver".into(), json!(resolver));
        }
    }
    o.insert("detour".into(), json!(detour));

    Value::Object(o)
}

fn split_host_port(host: &str) -> (String, Option<u16>) {
    // Leave IPv6 literals alone: their colons are not a port separator.
    if host.starts_with('[') {
        return match host.split_once("]:") {
            Some((h, p)) => (
                h.trim_start_matches('[').to_string(),
                p.parse().ok(),
            ),
            None => (host.trim_matches(['[', ']']).to_string(), None),
        };
    }

    match host.split_once(':') {
        Some((h, p)) => match p.parse() {
            Ok(port) => (h.to_string(), Some(port)),
            Err(_) => (host.to_string(), None),
        },
        None => (host.to_string(), None),
    }
}

fn build_dns(settings: &Settings, dns: &DnsSettings) -> Value {
    let use_fakeip = dns.enable_fakeip && settings.mode.0 == TunnelMode::Tun;

    let mut servers = vec![
        // Resolved through the tunnel so queries for proxied names never leak.
        dns_server(DNS_REMOTE, &dns.remote, Some(DNS_DIRECT), TAG_PROXY),
        dns_server(DNS_DIRECT, &dns.direct, Some(DNS_BOOTSTRAP), TAG_DIRECT),
        // Plain UDP bootstrap, used only to resolve the encrypted resolvers.
        dns_server(DNS_BOOTSTRAP, "223.5.5.5", None, TAG_DIRECT),
    ];

    // Outbound DNS rule items were removed in 1.14; direct traffic now picks up
    // its resolver from the outbound's own `domain_resolver`.
    let mut rules: Vec<Value> = Vec::new();

    if use_fakeip {
        servers.push(json!({
            "type": "fakeip",
            "tag": DNS_FAKEIP,
            "inet4_range": "198.18.0.0/15",
            "inet6_range": "fc00::/18",
        }));
        rules.push(json!({
            "query_type": ["A", "AAAA"],
            "server": DNS_FAKEIP,
            "rewrite_ttl": 1,
        }));
    }

    let mut dns_obj = Map::new();
    dns_obj.insert("servers".into(), Value::Array(servers));
    dns_obj.insert("rules".into(), Value::Array(rules));
    dns_obj.insert("final".into(), json!(DNS_REMOTE));
    dns_obj.insert(
        "strategy".into(),
        json!(if settings.tun.ipv6 {
            "prefer_ipv4"
        } else {
            "ipv4_only"
        }),
    );
    if dns.disable_cache {
        dns_obj.insert("disable_cache".into(), json!(true));
    }

    Value::Object(dns_obj)
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

struct RuleSets {
    declarations: Vec<Value>,
}

impl RuleSets {
    fn new() -> Self {
        Self {
            declarations: Vec::new(),
        }
    }

    /// Declare a bundled `.srs` file once and return its tag.
    fn local(&mut self, dir: &str, tag: &str) -> String {
        if !self.declarations.iter().any(|d| d["tag"] == json!(tag)) {
            self.declarations.push(json!({
                "tag": tag,
                "type": "local",
                "format": "binary",
                "path": format!("{dir}/{tag}.srs"),
            }));
        }
        tag.to_string()
    }
}

fn user_rule_value(rule: &crate::model::RoutingRule) -> Option<(&'static str, Value)> {
    let v = rule.value.trim();
    if v.is_empty() {
        return None;
    }
    Some(match rule.kind {
        RuleKind::Domain => ("domain", json!([v])),
        RuleKind::DomainSuffix => ("domain_suffix", json!([v])),
        RuleKind::DomainKeyword => ("domain_keyword", json!([v])),
        RuleKind::DomainRegex => ("domain_regex", json!([v])),
        RuleKind::IpCidr => ("ip_cidr", json!([v])),
        RuleKind::Port => ("port", json!([v.parse::<u16>().ok()?])),
        RuleKind::ProcessName => ("process_name", json!([v])),
    })
}

fn build_route(
    settings: &Settings,
    routing: &RoutingSettings,
    paths: &CorePaths,
    with_probe_lanes: bool,
) -> Value {
    let mut sets = RuleSets::new();
    let dir = &paths.rule_sets_dir;
    let mut rules: Vec<Value> = Vec::new();

    // Sniffing must run first so later rules can match on domains, and DNS has
    // to be hijacked before anything else claims port 53.
    rules.push(json!({ "action": "sniff" }));
    rules.push(json!({ "protocol": "dns", "action": "hijack-dns" }));

    // Latency probes are pinned to their lane before anything else gets a say,
    // so a user rule cannot silently divert a measurement to another node.
    if with_probe_lanes {
        for lane in 0..PROBE_LANES {
            rules.push(json!({
                "inbound": [probe_inbound_tag(lane)],
                "outbound": probe_selector_tag(lane),
            }));
        }
    }

    // The connectivity check has to travel the tunnel to mean anything, so it
    // is pinned to the proxy above the client-bypass rule that follows.
    rules.push(json!({ "domain": [CONNECTIVITY_HOST], "outbound": TAG_PROXY }));

    // Everything else the client itself sends stays direct, so subscription
    // refreshes and update checks survive a node that has stopped working.
    rules.push(json!({ "process_name": ["Vlyne.exe"], "outbound": TAG_DIRECT }));

    if routing.block_ads {
        let tag = sets.local(dir, "geosite-category-ads-all");
        rules.push(json!({ "rule_set": [tag], "action": "reject" }));
    }

    // User rules outrank presets so an explicit override always wins.
    for rule in routing.rules.iter().filter(|r| r.enabled) {
        if let Some((key, value)) = user_rule_value(rule) {
            let mut o = Map::new();
            o.insert(key.into(), value);
            match rule.target {
                RuleTarget::Block => {
                    o.insert("action".into(), json!("reject"));
                }
                RuleTarget::Direct => {
                    o.insert("outbound".into(), json!(TAG_DIRECT));
                }
                RuleTarget::Proxy => {
                    o.insert("outbound".into(), json!(TAG_PROXY));
                }
            }
            rules.push(Value::Object(o));
        }
    }

    for name in routing.bypass_processes.iter().filter(|p| !p.is_empty()) {
        rules.push(json!({ "process_name": [name], "outbound": TAG_DIRECT }));
    }

    match routing.preset {
        RoutingPreset::Global => {}
        RoutingPreset::BypassLan => {
            rules.push(json!({ "ip_is_private": true, "outbound": TAG_DIRECT }));
        }
        RoutingPreset::BypassRu => {
            rules.push(json!({ "ip_is_private": true, "outbound": TAG_DIRECT }));
            let geosite = sets.local(dir, "geosite-category-ru");
            let geoip = sets.local(dir, "geoip-ru");
            rules.push(json!({ "rule_set": [geosite, geoip], "outbound": TAG_DIRECT }));
        }
        RoutingPreset::Custom => {}
    }

    // Browsers prefer QUIC, which the system proxy cannot intercept; rejecting
    // it makes them fall back to TCP instead of silently bypassing the tunnel.
    if routing.block_quic_for_direct && settings.mode.0 == TunnelMode::SystemProxy {
        rules.push(json!({ "protocol": "quic", "action": "reject" }));
    }

    let mut route = Map::new();
    route.insert("rules".into(), Value::Array(rules));
    if !sets.declarations.is_empty() {
        route.insert("rule_set".into(), Value::Array(sets.declarations));
    }
    route.insert("final".into(), json!(TAG_PROXY));
    route.insert("auto_detect_interface".into(), json!(true));
    route.insert("default_domain_resolver".into(), json!(DNS_DIRECT));

    Value::Object(route)
}

// ---------------------------------------------------------------------------
// Whole config
// ---------------------------------------------------------------------------

/// Deep-merge `patch` into `base`. Objects merge key by key; every other value
/// replaces wholesale, which is what a config override should do.
fn merge(base: &mut Value, patch: Value) {
    match (base, patch) {
        (Value::Object(b), Value::Object(p)) => {
            for (k, v) in p {
                match b.get_mut(&k) {
                    Some(slot) => merge(slot, v),
                    None => {
                        b.insert(k, v);
                    }
                }
            }
        }
        (slot, patch) => *slot = patch,
    }
}

/// Render the complete sing-box configuration.
///
/// Returns the config alongside the node-id-to-tag mapping, which the caller
/// needs in order to drive the selector over the Clash API.
pub fn generate(args: GenerateArgs<'_>) -> Result<(Value, TagMap)> {
    let GenerateArgs {
        nodes,
        active_id,
        settings,
        paths,
        clash_secret,
        probe_base,
    } = args;

    // Nodes the core cannot dial would make the whole config invalid, so they
    // are left out here and surfaced separately in the UI.
    let usable: Vec<&Node> = nodes
        .iter()
        .filter(|n| n.unsupported_reason().is_none())
        .collect();
    if usable.is_empty() {
        return Err(Error::NoNode);
    }

    let tags = assign_tags(&usable);
    let tag_map = TagMap(
        usable
            .iter()
            .zip(tags.iter())
            .map(|(n, t)| (n.id.clone(), t.clone()))
            .collect(),
    );

    let default_tag = active_id
        .and_then(|id| tag_map.tag_of(id))
        .unwrap_or(TAG_AUTO)
        .to_string();

    let mut outbounds = Vec::with_capacity(usable.len() + 3);

    // The selector is what every route points at, so switching nodes is a
    // Clash API call rather than a core restart.
    let mut selector_members = vec![json!(TAG_AUTO)];
    selector_members.extend(tags.iter().map(|t| json!(t)));
    outbounds.push(json!({
        "type": "selector",
        "tag": TAG_PROXY,
        "outbounds": selector_members,
        "default": default_tag,
        "interrupt_exist_connections": true,
    }));

    // Latency-based fallback. Selecting it hands node choice to the core.
    outbounds.push(json!({
        "type": "urltest",
        "tag": TAG_AUTO,
        "outbounds": tags,
        "url": settings.probe.url,
        "interval": format!("{}s", settings.probe.interval_s.max(30)),
        "tolerance": 50,
        "interrupt_exist_connections": false,
    }));

    // One selector per probe lane. The app points a lane at a node and then
    // makes its own request through that lane's inbound, which is the only way
    // to control the probe URL: the core ignores the `url` parameter on its
    // own delay endpoint and always reaches for www.gstatic.com.
    if probe_base.is_some() {
        for lane in 0..PROBE_LANES {
            outbounds.push(json!({
                "type": "selector",
                "tag": probe_selector_tag(lane),
                "outbounds": tags,
                "default": tags[0],
                "interrupt_exist_connections": false,
            }));
        }
    }

    for (node, tag) in usable.iter().zip(tags.iter()) {
        outbounds.push(build_outbound(node, settings, tag)?);
    }
    // Direct traffic resolves through the direct resolver rather than the
    // tunnelled one — the 1.14 replacement for outbound DNS rule items.
    outbounds.push(json!({
        "type": "direct",
        "tag": TAG_DIRECT,
        "domain_resolver": DNS_DIRECT,
    }));

    let mut config = json!({
        "log": {
            "level": settings.core.log_level,
            "timestamp": true,
        },
        "dns": build_dns(settings, &settings.dns),
        "inbounds": build_inbounds(settings, probe_base),
        "outbounds": outbounds,
        "route": build_route(settings, &settings.routing, paths, probe_base.is_some()),
        "experimental": {
            "clash_api": {
                "external_controller": format!("127.0.0.1:{}", settings.inbound.clash_port),
                "secret": clash_secret,
            },
            "cache_file": {
                "enabled": true,
                "path": paths.cache_file,
                "store_fakeip": settings.dns.enable_fakeip,
            },
        },
    });

    if let Some(raw) = settings
        .core
        .config_override
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        let patch: Value = serde_json::from_str(raw)
            .map_err(|e| Error::Other(format!("config override is not valid JSON: {e}")))?;
        merge(&mut config, patch);
    }

    Ok((config, tag_map))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::link::parse_link;

    fn paths() -> CorePaths {
        CorePaths {
            rule_sets_dir: "C:/rules".into(),
            cache_file: "C:/cache.db".into(),
        }
    }

    fn generate_for(link: &str, settings: &Settings) -> Value {
        let node = parse_link(link).unwrap();
        generate(GenerateArgs {
            nodes: std::slice::from_ref(&node),
            active_id: Some(&node.id),
            settings,
            paths: &paths(),
            clash_secret: "secret",
            probe_base: None,
        })
        .unwrap()
        .0
    }

    #[test]
    fn reality_outbound_has_utls_and_no_empty_flow() {
        let node = parse_link(
            "vless://uuid@a.com:443?security=reality&pbk=KEY&sid=ab&sni=b.com&flow=#N",
        )
        .unwrap();
        let out = build_outbound(&node, &Settings::default(), "n").unwrap();

        assert_eq!(out["tls"]["reality"]["enabled"], json!(true));
        assert_eq!(out["tls"]["utls"]["fingerprint"], json!("chrome"));
        // An empty flow would make sing-box refuse to start.
        assert!(out.get("flow").is_none());
    }

    #[test]
    fn xhttp_outbound_carries_path_host_and_mode() {
        let node = parse_link(
            "vless://uuid@a.com:443?type=xhttp&path=%2Fx&host=cdn.com&mode=stream-up&security=tls#N",
        )
        .unwrap();
        let out = build_outbound(&node, &Settings::default(), "n").unwrap();

        assert_eq!(out["transport"]["type"], json!("xhttp"));
        assert_eq!(out["transport"]["path"], json!("/x"));
        assert_eq!(out["transport"]["host"], json!("cdn.com"));
        assert_eq!(out["transport"]["mode"], json!("stream-up"));
    }

    /// A mode the core does not know would make it reject the whole config, so
    /// such a node has to be held back rather than emitted.
    #[test]
    fn an_invalid_xhttp_mode_marks_the_node_unusable() {
        let mut node = parse_link("vless://uuid@a.com:443?type=xhttp&security=tls#N").unwrap();
        node.transport = Transport::Xhttp {
            path: "/x".into(),
            host: String::new(),
            mode: "made-up".into(),
            headers: Default::default(),
        };

        assert_eq!(node.unsupported_reason(), Some("transport.xhttpMode"));
        let err = build_outbound(&node, &Settings::default(), "n").unwrap_err();
        assert_eq!(err.code(), "node.unsupported");
    }

    #[test]
    fn unsupported_nodes_are_dropped_not_fatal() {
        let good = parse_link("vless://uuid@a.com:443?security=tls#Good").unwrap();
        let mut bad = parse_link("vless://uuid@b.com:443?security=tls#Bad").unwrap();
        bad.transport = Transport::Xhttp {
            path: "/x".into(),
            host: String::new(),
            mode: "made-up".into(),
            headers: Default::default(),
        };
        let (cfg, map) = generate(GenerateArgs {
            nodes: &[good.clone(), bad.clone()],
            active_id: Some(&good.id),
            settings: &Settings::default(),
            paths: &paths(),
            clash_secret: "s",
            probe_base: None,
        })
        .unwrap();

        assert_eq!(map.tag_of(&good.id), Some("Good"));
        assert_eq!(map.tag_of(&bad.id), None);
        let tags: Vec<_> = cfg["outbounds"]
            .as_array()
            .unwrap()
            .iter()
            .map(|o| o["tag"].as_str().unwrap())
            .collect();
        assert!(tags.contains(&"Good"));
        assert!(!tags.contains(&"Bad"));
    }

    /// The lanes are what make the configured probe URL mean anything: the
    /// core ignores the url given to its own delay endpoint, so measurements
    /// have to travel a path the app controls end to end.
    #[test]
    fn probe_lanes_pair_an_inbound_with_a_selector() {
        let node = parse_link("vless://uuid@a.com:443?security=tls#N").unwrap();
        let (cfg, _) = generate(GenerateArgs {
            nodes: std::slice::from_ref(&node),
            active_id: None,
            settings: &Settings::default(),
            paths: &paths(),
            clash_secret: "s",
            probe_base: Some(17100),
        })
        .unwrap();

        for lane in 0..PROBE_LANES {
            let port = probe_port(17100, lane);
            assert!(
                cfg["inbounds"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|i| i["listen_port"] == json!(port) && i["listen"] == json!("127.0.0.1")),
                "lane {lane} has no inbound on {port}"
            );
            assert!(
                cfg["outbounds"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|o| o["tag"] == json!(probe_selector_tag(lane))),
                "lane {lane} has no selector"
            );
            assert!(
                cfg["route"]["rules"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|r| r["outbound"] == json!(probe_selector_tag(lane))),
                "lane {lane} is not routed"
            );
        }
    }

    /// A busy port range must cost only the measurements, never the tunnel.
    #[test]
    fn without_a_free_range_the_lanes_are_simply_absent() {
        let node = parse_link("vless://uuid@a.com:443?security=tls#N").unwrap();
        let (cfg, _) = generate(GenerateArgs {
            nodes: std::slice::from_ref(&node),
            active_id: None,
            settings: &Settings::default(),
            paths: &paths(),
            clash_secret: "s",
            probe_base: None,
        })
        .unwrap();

        let tags: Vec<_> = cfg["outbounds"]
            .as_array()
            .unwrap()
            .iter()
            .map(|o| o["tag"].as_str().unwrap_or_default().to_string())
            .collect();
        assert!(!tags.iter().any(|t| t.starts_with("probe-")));
        assert!(cfg["inbounds"].as_array().unwrap().len() >= 2);
    }

    // -----------------------------------------------------------------------
    // Every control in Routing has to reach the generated configuration. A
    // switch that changes nothing is worse than no switch at all, so each one
    // is pinned here to the rule it is supposed to produce.
    // -----------------------------------------------------------------------

    fn rules_of(cfg: &Value) -> Vec<Value> {
        cfg["route"]["rules"].as_array().cloned().unwrap_or_default()
    }

    fn has_rule(cfg: &Value, f: impl Fn(&Value) -> bool) -> bool {
        rules_of(cfg).iter().any(f)
    }

    fn rule_set_tags(cfg: &Value) -> Vec<String> {
        cfg["route"]["rule_set"]
            .as_array()
            .map(|sets| {
                sets.iter()
                    .filter_map(|s| s["tag"].as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default()
    }

    fn with_settings(mutate: impl FnOnce(&mut Settings)) -> Value {
        let mut settings = Settings::default();
        mutate(&mut settings);
        generate_for("vless://uuid@a.com:443?security=tls#N", &settings)
    }

    fn one_rule(kind: RuleKind, value: &str, target: RuleTarget) -> crate::model::RoutingRule {
        crate::model::RoutingRule {
            id: "1".into(),
            kind,
            value: value.into(),
            target,
            enabled: true,
        }
    }

    #[test]
    fn each_routing_preset_produces_its_own_rules() {
        let private_direct =
            |r: &Value| r["ip_is_private"] == json!(true) && r["outbound"] == json!(TAG_DIRECT);

        let global = with_settings(|s| s.routing.preset = RoutingPreset::Global);
        assert!(!has_rule(&global, private_direct), "global must tunnel everything");

        let lan = with_settings(|s| s.routing.preset = RoutingPreset::BypassLan);
        assert!(has_rule(&lan, private_direct), "bypass-lan must spare private addresses");
        assert!(rule_set_tags(&lan).is_empty(), "bypass-lan needs no geo data");

        let ru = with_settings(|s| s.routing.preset = RoutingPreset::BypassRu);
        assert!(has_rule(&ru, private_direct));
        let tags = rule_set_tags(&ru);
        assert!(tags.contains(&"geoip-ru".to_string()), "{tags:?}");
        assert!(tags.contains(&"geosite-category-ru".to_string()), "{tags:?}");

        let custom = with_settings(|s| s.routing.preset = RoutingPreset::Custom);
        assert!(!has_rule(&custom, private_direct), "custom defers to the user");
        assert!(rule_set_tags(&custom).is_empty());
    }

    #[test]
    fn blocking_ads_adds_a_reject_rule_and_nothing_else_does() {
        let ads = |cfg: &Value| {
            has_rule(cfg, |r| {
                r["action"] == json!("reject")
                    && r["rule_set"] == json!(["geosite-category-ads-all"])
            })
        };

        assert!(!ads(&with_settings(|s| s.routing.block_ads = false)));
        let on = with_settings(|s| s.routing.block_ads = true);
        assert!(ads(&on));
        assert!(rule_set_tags(&on).contains(&"geosite-category-ads-all".to_string()));
    }

    /// QUIC is worth rejecting only where the system proxy cannot see it. In
    /// TUN the tunnel carries it, and blocking it there would break sites.
    #[test]
    fn quic_is_blocked_only_where_it_would_escape() {
        let quic = |cfg: &Value| {
            has_rule(cfg, |r| {
                r["protocol"] == json!("quic") && r["action"] == json!("reject")
            })
        };

        assert!(quic(&with_settings(|s| s.routing.block_quic_for_direct = true)));
        assert!(!quic(&with_settings(|s| s.routing.block_quic_for_direct = false)));
        assert!(!quic(&with_settings(|s| {
            s.routing.block_quic_for_direct = true;
            s.mode.0 = TunnelMode::Tun;
        })));
    }

    #[test]
    fn every_rule_kind_reaches_the_configuration() {
        let cases = [
            (RuleKind::Domain, "example.com", "domain"),
            (RuleKind::DomainSuffix, "example.com", "domain_suffix"),
            (RuleKind::DomainKeyword, "ads", "domain_keyword"),
            (RuleKind::DomainRegex, "^ad.*", "domain_regex"),
            (RuleKind::IpCidr, "10.0.0.0/8", "ip_cidr"),
            (RuleKind::Port, "8080", "port"),
            (RuleKind::ProcessName, "steam.exe", "process_name"),
        ];

        for (kind, value, field) in cases {
            let cfg = with_settings(|s| {
                s.routing.rules = vec![one_rule(kind, value, RuleTarget::Direct)];
            });
            assert!(
                has_rule(&cfg, |r| !r[field].is_null() && r["outbound"] == json!(TAG_DIRECT)),
                "{kind:?} produced no {field} rule"
            );
        }
    }

    #[test]
    fn a_rule_target_decides_where_the_traffic_goes() {
        let for_target = |target| {
            with_settings(move |s| {
                s.routing.rules = vec![one_rule(RuleKind::DomainSuffix, "example.com", target)];
            })
        };
        let mine = |r: &Value| r["domain_suffix"] == json!(["example.com"]);

        assert!(has_rule(&for_target(RuleTarget::Proxy), |r| mine(r)
            && r["outbound"] == json!(TAG_PROXY)));
        assert!(has_rule(&for_target(RuleTarget::Direct), |r| mine(r)
            && r["outbound"] == json!(TAG_DIRECT)));
        assert!(has_rule(&for_target(RuleTarget::Block), |r| mine(r)
            && r["action"] == json!("reject")));
    }

    #[test]
    fn a_disabled_rule_is_left_out() {
        let cfg = with_settings(|s| {
            let mut rule = one_rule(RuleKind::DomainSuffix, "example.com", RuleTarget::Block);
            rule.enabled = false;
            s.routing.rules = vec![rule];
        });
        assert!(!has_rule(&cfg, |r| r["domain_suffix"] == json!(["example.com"])));
    }

    /// A rule with nothing in it would either match everything or fail to load.
    ///
    /// The assertion looks for the rule's own field rather than for any reject
    /// at all: QUIC is rejected by default, and matching on that would pass
    /// whatever the empty rule did.
    #[test]
    fn an_empty_rule_value_is_ignored() {
        let cfg = with_settings(|s| {
            s.routing.rules = vec![one_rule(RuleKind::DomainSuffix, "   ", RuleTarget::Block)];
        });
        assert!(!has_rule(&cfg, |r| !r["domain_suffix"].is_null()));
    }

    #[test]
    fn user_rules_outrank_the_preset() {
        let cfg = with_settings(|s| {
            s.routing.preset = RoutingPreset::BypassLan;
            s.routing.rules = vec![one_rule(
                RuleKind::IpCidr,
                "192.168.0.0/16",
                RuleTarget::Proxy,
            )];
        });

        let rules = rules_of(&cfg);
        let mine = rules
            .iter()
            .position(|r| r["ip_cidr"] == json!(["192.168.0.0/16"]))
            .expect("the user rule is missing");
        let preset = rules
            .iter()
            .position(|r| r["ip_is_private"] == json!(true))
            .expect("the preset rule is missing");
        assert!(mine < preset, "a user rule must be consulted first");
    }

    #[test]
    fn bypassed_processes_each_get_a_direct_rule() {
        let cfg = with_settings(|s| {
            s.routing.bypass_processes = vec!["steam.exe".into(), "discord.exe".into()];
        });

        for name in ["steam.exe", "discord.exe"] {
            assert!(
                has_rule(&cfg, |r| r["process_name"] == json!([name])
                    && r["outbound"] == json!(TAG_DIRECT)),
                "{name} is not bypassed"
            );
        }
    }

    // -----------------------------------------------------------------------
    // The rest of Settings, likewise.
    // -----------------------------------------------------------------------

    #[test]
    fn the_inbound_ports_are_the_ones_configured() {
        let cfg = with_settings(|s| {
            s.inbound.socks_port = 21080;
            s.inbound.http_port = 21081;
            s.inbound.clash_port = 21090;
        });

        let ports: Vec<u64> = cfg["inbounds"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|i| i["listen_port"].as_u64())
            .collect();
        assert!(ports.contains(&21080), "{ports:?}");
        assert!(ports.contains(&21081), "{ports:?}");
        assert_eq!(
            cfg["experimental"]["clash_api"]["external_controller"],
            json!("127.0.0.1:21090")
        );
    }

    #[test]
    fn allowing_the_lan_changes_what_the_inbounds_listen_on() {
        let listens = |cfg: &Value| -> Vec<String> {
            cfg["inbounds"]
                .as_array()
                .unwrap()
                .iter()
                .filter_map(|i| i["listen"].as_str().map(str::to_string))
                .collect()
        };

        let closed = with_settings(|s| s.inbound.allow_lan = false);
        let open = with_settings(|s| s.inbound.allow_lan = true);
        assert!(listens(&closed).iter().all(|l| l == "127.0.0.1"));
        assert!(listens(&open).iter().any(|l| l == "0.0.0.0"));
    }

    #[test]
    fn the_configured_resolvers_are_the_ones_used() {
        let cfg = with_settings(|s| {
            s.dns.remote = "https://dns.example/dns-query".into();
            s.dns.direct = "https://direct.example/dns-query".into();
        });

        let rendered = serde_json::to_string(&cfg["dns"]).unwrap();
        assert!(rendered.contains("dns.example"), "{rendered}");
        assert!(rendered.contains("direct.example"), "{rendered}");
    }

    #[test]
    fn the_tun_settings_reach_the_adapter() {
        let cfg = with_settings(|s| {
            s.mode.0 = TunnelMode::Tun;
            s.tun.mtu = 1400;
            s.tun.strict_route = false;
            s.tun.auto_route = false;
        });

        let tun = cfg["inbounds"]
            .as_array()
            .unwrap()
            .iter()
            .find(|i| i["type"] == json!("tun"))
            .expect("no tun inbound");
        assert_eq!(tun["mtu"], json!(1400));
        assert_eq!(tun["strict_route"], json!(false));
        assert_eq!(tun["auto_route"], json!(false));
    }

    #[test]
    fn the_log_level_and_probe_url_are_carried_through() {
        let cfg = with_settings(|s| {
            s.core.log_level = "debug".into();
            s.probe.url = "http://probe.example/generate_204".into();
        });

        assert_eq!(cfg["log"]["level"], json!("debug"));
        let auto = cfg["outbounds"]
            .as_array()
            .unwrap()
            .iter()
            .find(|o| o["tag"] == json!(TAG_AUTO))
            .expect("no automatic selector");
        assert_eq!(auto["url"], json!("http://probe.example/generate_204"));
    }

    #[test]
    fn multiplex_is_off_until_it_is_switched_on() {
        let muxed = |cfg: &Value| {
            cfg["outbounds"]
                .as_array()
                .unwrap()
                .iter()
                .any(|o| o["multiplex"]["enabled"] == json!(true))
        };

        assert!(!muxed(&with_settings(|_| {})));
        assert!(muxed(&with_settings(|s| s.core.multiplex.enabled = true)));
    }

    #[test]
    fn duplicate_names_get_unique_tags() {
        let a = parse_link("vless://uuid@a.com:443?security=tls#Same").unwrap();
        let b = parse_link("vless://uuid@b.com:443?security=tls#Same").unwrap();
        let (_, map) = generate(GenerateArgs {
            nodes: &[a.clone(), b.clone()],
            active_id: None,
            settings: &Settings::default(),
            paths: &paths(),
            clash_secret: "s",
            probe_base: None,
        })
        .unwrap();

        assert_eq!(map.tag_of(&a.id), Some("Same"));
        assert_eq!(map.tag_of(&b.id), Some("Same (2)"));
    }

    #[test]
    fn selector_defaults_to_the_active_node() {
        let a = parse_link("vless://uuid@a.com:443?security=tls#A").unwrap();
        let b = parse_link("vless://uuid@b.com:443?security=tls#B").unwrap();
        let (cfg, _) = generate(GenerateArgs {
            nodes: &[a, b.clone()],
            active_id: Some(&b.id),
            settings: &Settings::default(),
            paths: &paths(),
            clash_secret: "s",
            probe_base: None,
        })
        .unwrap();

        let selector = cfg["outbounds"]
            .as_array()
            .unwrap()
            .iter()
            .find(|o| o["tag"] == json!(TAG_PROXY))
            .unwrap();
        assert_eq!(selector["type"], json!("selector"));
        assert_eq!(selector["default"], json!("B"));
    }

    #[test]
    fn a_node_name_cannot_shadow_a_reserved_tag() {
        let node = parse_link("vless://uuid@a.com:443?security=tls#direct").unwrap();
        let (_, map) = generate(GenerateArgs {
            nodes: std::slice::from_ref(&node),
            active_id: None,
            settings: &Settings::default(),
            paths: &paths(),
            clash_secret: "s",
            probe_base: None,
        })
        .unwrap();
        assert_eq!(map.tag_of(&node.id), Some("direct (2)"));
    }

    #[test]
    fn proxy_mode_has_no_tun_inbound() {
        let cfg = generate_for("vless://uuid@a.com:443?security=tls#N", &Settings::default());
        let inbounds = cfg["inbounds"].as_array().unwrap();
        assert!(!inbounds.iter().any(|i| i["type"] == json!("tun")));
        assert!(inbounds.iter().any(|i| i["type"] == json!("http")));
    }

    #[test]
    fn tun_mode_adds_tun_inbound_and_fakeip() {
        let mut settings = Settings::default();
        settings.mode.0 = TunnelMode::Tun;
        let cfg = generate_for("vless://uuid@a.com:443?security=tls#N", &settings);

        assert!(cfg["inbounds"]
            .as_array()
            .unwrap()
            .iter()
            .any(|i| i["type"] == json!("tun")));

        // Since 1.14 fake-ip is a DNS server rather than a top-level option.
        assert!(cfg["dns"]["servers"]
            .as_array()
            .unwrap()
            .iter()
            .any(|s| s["type"] == json!("fakeip")));
        assert!(cfg["dns"]["rules"]
            .as_array()
            .unwrap()
            .iter()
            .any(|r| r["server"] == json!(DNS_FAKEIP)));
    }

    #[test]
    fn client_traffic_stays_direct_except_the_connectivity_check() {
        let cfg = generate_for("vless://uuid@a.com:443?security=tls#N", &Settings::default());
        let rules = cfg["route"]["rules"].as_array().unwrap();

        let bypass = rules
            .iter()
            .position(|r| r["process_name"] == json!(["Vlyne.exe"]))
            .expect("client bypass rule");
        assert_eq!(rules[bypass]["outbound"], json!(TAG_DIRECT));

        // The check only proves anything if it is pinned to the proxy, and it
        // must be matched before the blanket bypass sends it direct.
        let check = rules
            .iter()
            .position(|r| r["domain"] == json!([CONNECTIVITY_HOST]))
            .expect("connectivity check rule");
        assert_eq!(rules[check]["outbound"], json!(TAG_PROXY));
        assert!(check < bypass);
    }

    #[test]
    fn remote_dns_is_detoured_through_the_proxy() {
        let cfg = generate_for("vless://uuid@a.com:443?security=tls#N", &Settings::default());
        let servers = cfg["dns"]["servers"].as_array().unwrap();
        let remote = servers
            .iter()
            .find(|s| s["tag"] == json!(DNS_REMOTE))
            .unwrap();
        assert_eq!(remote["detour"], json!("proxy"));
    }

    /// Feed a generated config to the bundled core and return its complaint.
    ///
    /// This is the only check that catches a schema change in a new sing-box
    /// release. Everything else here asserts against our own expectations,
    /// which stay happily wrong when the core moves underneath them.
    fn core_rejects(config: &Value) -> Option<String> {
        let binary = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join(if cfg!(windows) {
                "sing-box.exe"
            } else {
                "sing-box"
            });

        // A checkout that has not run `npm run core:fetch` still runs the rest
        // of the suite rather than failing on a missing binary.
        if !binary.exists() {
            eprintln!("skipping schema check: {} is absent", binary.display());
            return None;
        }

        let dir = std::env::temp_dir().join(format!("vlyne-schema-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(format!("{:?}.json", std::thread::current().id()));
        std::fs::write(&path, serde_json::to_vec_pretty(config).unwrap()).unwrap();

        let output = std::process::Command::new(&binary)
            .arg("check")
            .arg("-c")
            .arg(&path)
            .output()
            .expect("failed to run the core");
        let _ = std::fs::remove_file(&path);

        if output.status.success() {
            return None;
        }
        Some(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }

    #[test]
    fn every_generated_config_is_accepted_by_the_core() {
        let nodes = [
            "vless://3f9a1c22-7b4e-4d18-9a56-0e1f2b3c4d5e@a.com:443?security=reality&pbk=Ie3KosV5eX2ulF-jt8VZ87T55ZnHFHTRaq8pdDpZUHc&sid=ab&sni=b.com&flow=xtls-rprx-vision#Reality",
            "vless://3f9a1c22-7b4e-4d18-9a56-0e1f2b3c4d5e@b.com:443?security=tls&type=ws&path=/w&host=b.com#WS",
            "vmess://eyJ2IjoiMiIsInBzIjoiVk0iLCJhZGQiOiJjLmNvbSIsInBvcnQiOiI0NDMiLCJpZCI6InV1aWQiLCJhaWQiOiIwIiwibmV0IjoiZ3JwYyIsInBhdGgiOiIvZyIsInRscyI6InRscyJ9",
            "trojan://pass@d.com:443?sni=d.com#TR",
            "ss://YWVzLTI1Ni1nY206cGFzcw@e.com:8388#SS",
            "hy2://pass@f.com:443?sni=f.com&obfs-password=x#HY",
            "tuic://3f9a1c22-7b4e-4d18-9a56-0e1f2b3c4d5e:pass@g.com:443?sni=g.com#TUIC",
            "anytls://pass@h.com:443?sni=h.com#ANY",
            // XHTTP is the one transport the core only has because it is the
            // `lx` fork. Upstream rejects the whole configuration over it, so
            // this case is what pins the choice of core.
            "vless://3f9a1c22-7b4e-4d18-9a56-0e1f2b3c4d5e@i.com:443?security=tls&type=xhttp&path=/x&host=i.com&mode=packet-up#XHTTP",
        ]
        .iter()
        .map(|l| parse_link(l).unwrap())
        .collect::<Vec<_>>();

        // The rule sets must be the real files, since the core opens them.
        let rules_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("rules");
        let paths = CorePaths {
            rule_sets_dir: rules_dir.display().to_string().replace('\\', "/"),
            cache_file: std::env::temp_dir()
                .join("vlyne-test-cache.db")
                .display()
                .to_string()
                .replace('\\', "/"),
        };

        let cases: Vec<(&str, Settings)> = vec![
            ("defaults", Settings::default()),
            ("global", {
                let mut s = Settings::default();
                s.routing.preset = RoutingPreset::Global;
                s
            }),
            ("bypass ru with ads blocked", {
                let mut s = Settings::default();
                s.routing.preset = RoutingPreset::BypassRu;
                s.routing.block_ads = true;
                s
            }),
            ("tun with fake-ip and ipv6", {
                let mut s = Settings::default();
                s.mode.0 = TunnelMode::Tun;
                s.tun.ipv6 = true;
                s
            }),
            ("multiplex and custom rules", {
                let mut s = Settings::default();
                s.core.multiplex.enabled = true;
                s.routing.preset = RoutingPreset::Custom;
                s.routing.rules = vec![
                    crate::model::RoutingRule {
                        id: "1".into(),
                        kind: RuleKind::DomainSuffix,
                        value: "example.com".into(),
                        target: RuleTarget::Direct,
                        enabled: true,
                    },
                    crate::model::RoutingRule {
                        id: "2".into(),
                        kind: RuleKind::ProcessName,
                        value: "steam.exe".into(),
                        target: RuleTarget::Block,
                        enabled: true,
                    },
                    crate::model::RoutingRule {
                        id: "3".into(),
                        kind: RuleKind::Port,
                        value: "8080".into(),
                        target: RuleTarget::Proxy,
                        enabled: true,
                    },
                ];
                s.routing.bypass_processes = vec!["discord.exe".into()];
                s
            }),
            ("plain dns addresses", {
                let mut s = Settings::default();
                s.dns.remote = "tls://dns.google".into();
                s.dns.direct = "8.8.8.8".into();
                s
            }),
        ];

        // Every case is checked twice: the probe lanes add inbounds, selectors
        // and routing rules that the core has to accept just as readily.
        for (name, settings) in cases {
            for probe_base in [None, Some(17100u16)] {
                let (config, _) = generate(GenerateArgs {
                    nodes: &nodes,
                    active_id: Some(&nodes[0].id),
                    settings: &settings,
                    paths: &paths,
                    clash_secret: "secret",
                    probe_base,
                })
                .unwrap_or_else(|e| panic!("{name}: generation failed: {e}"));

                if let Some(complaint) = core_rejects(&config) {
                    let lanes = if probe_base.is_some() { "with" } else { "without" };
                    panic!(
                        "{name} ({lanes} probe lanes): the core rejected the config:\n{complaint}"
                    );
                }
            }
        }
    }

    #[test]
    fn dns_addresses_become_typed_servers() {
        let doh = dns_server("t", "https://1.1.1.1/dns-query", Some("r"), "direct");
        assert_eq!(doh["type"], json!("https"));
        assert_eq!(doh["server"], json!("1.1.1.1"));
        assert_eq!(doh["path"], json!("/dns-query"));
        // A numeric server needs no resolver of its own.
        assert!(doh.get("domain_resolver").is_none());

        let named = dns_server("t", "tls://dns.google", Some("r"), "direct");
        assert_eq!(named["type"], json!("tls"));
        assert_eq!(named["domain_resolver"], json!("r"));
        // Only HTTP-based transports carry a path.
        assert!(named.get("path").is_none());

        let plain = dns_server("t", "8.8.8.8", None, "direct");
        assert_eq!(plain["type"], json!("udp"));
        assert_eq!(plain["server"], json!("8.8.8.8"));

        let ported = dns_server("t", "udp://8.8.8.8:5353", None, "direct");
        assert_eq!(ported["server_port"], json!(5353));

        assert_eq!(dns_server("t", "local", None, "direct")["type"], json!("local"));
    }

    #[test]
    fn ipv6_dns_literal_keeps_its_colons() {
        let (host, port) = split_host_port("[2606:4700:4700::1111]:853");
        assert_eq!(host, "2606:4700:4700::1111");
        assert_eq!(port, Some(853));

        let (host, port) = split_host_port("[2606:4700:4700::1111]");
        assert_eq!(host, "2606:4700:4700::1111");
        assert_eq!(port, None);
    }

    #[test]
    fn direct_outbound_names_its_own_resolver() {
        let cfg = generate_for("vless://uuid@a.com:443?security=tls#N", &Settings::default());
        let direct = cfg["outbounds"]
            .as_array()
            .unwrap()
            .iter()
            .find(|o| o["tag"] == json!(TAG_DIRECT))
            .unwrap();
        assert_eq!(direct["domain_resolver"], json!(DNS_DIRECT));
    }

    #[test]
    fn config_override_is_deep_merged() {
        let mut settings = Settings::default();
        settings.core.config_override = Some(r#"{"log":{"level":"debug"}}"#.into());
        let cfg = generate_for("vless://uuid@a.com:443?security=tls#N", &settings);

        assert_eq!(cfg["log"]["level"], json!("debug"));
        // Sibling keys survive the merge.
        assert_eq!(cfg["log"]["timestamp"], json!(true));
    }

    #[test]
    fn bypass_ru_declares_its_rule_sets() {
        let mut settings = Settings::default();
        settings.routing.preset = RoutingPreset::BypassRu;
        let cfg = generate_for("vless://uuid@a.com:443?security=tls#N", &settings);

        let tags: Vec<_> = cfg["route"]["rule_set"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| s["tag"].as_str().unwrap().to_string())
            .collect();
        assert!(tags.contains(&"geoip-ru".to_string()));
        assert!(tags.contains(&"geosite-category-ru".to_string()));
    }
}
