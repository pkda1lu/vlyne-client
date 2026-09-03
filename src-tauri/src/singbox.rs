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

fn build_inbounds(settings: &Settings) -> Vec<Value> {
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

fn build_route(settings: &Settings, routing: &RoutingSettings, paths: &CorePaths) -> Value {
    let mut sets = RuleSets::new();
    let dir = &paths.rule_sets_dir;
    let mut rules: Vec<Value> = Vec::new();

    // Sniffing must run first so later rules can match on domains, and DNS has
    // to be hijacked before anything else claims port 53.
    rules.push(json!({ "action": "sniff" }));
    rules.push(json!({ "protocol": "dns", "action": "hijack-dns" }));

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
        "inbounds": build_inbounds(settings),
        "outbounds": outbounds,
        "route": build_route(settings, &settings.routing, paths),
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

        for (name, settings) in cases {
            let (config, _) = generate(GenerateArgs {
                nodes: &nodes,
                active_id: Some(&nodes[0].id),
                settings: &settings,
                paths: &paths,
                clash_secret: "secret",
            })
            .unwrap_or_else(|e| panic!("{name}: generation failed: {e}"));

            if let Some(complaint) = core_rejects(&config) {
                panic!("{name}: the core rejected the generated config:\n{complaint}");
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
