//! Share-link parsing.
//!
//! Every supported scheme is normalised into a [`Node`]. The original link is
//! always preserved so that a node can be re-exported byte-for-byte and so a
//! future core can re-interpret parameters this build ignores.

use std::collections::HashMap;

use base64::engine::general_purpose::{STANDARD, STANDARD_NO_PAD, URL_SAFE_NO_PAD};
use base64::Engine;
use percent_encoding::percent_decode_str;
use url::Url;

use crate::error::{Error, Result};
use crate::model::{Multiplex, Node, Protocol, TlsOptions, Transport};

/// Decode base64 tolerating both alphabets and missing padding, which share
/// links in the wild use interchangeably.
pub fn b64_decode(input: &str) -> Option<Vec<u8>> {
    let trimmed: String = input.trim().chars().filter(|c| !c.is_whitespace()).collect();
    STANDARD
        .decode(&trimmed)
        .or_else(|_| STANDARD_NO_PAD.decode(&trimmed))
        .or_else(|_| URL_SAFE_NO_PAD.decode(&trimmed))
        .ok()
}

fn b64_decode_utf8(input: &str) -> Option<String> {
    b64_decode(input).and_then(|b| String::from_utf8(b).ok())
}

/// Fragment identifiers are percent-encoded UTF-8 in modern panels, but older
/// ones emit raw bytes. Try the strict path first and fall back to the literal.
fn decode_fragment(raw: &str) -> String {
    if raw.is_empty() {
        return String::new();
    }
    percent_decode_str(raw)
        .decode_utf8()
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|_| raw.trim().to_string())
}

fn query_map(url: &Url) -> HashMap<String, String> {
    url.query_pairs()
        .map(|(k, v)| (k.to_ascii_lowercase(), v.to_string()))
        .collect()
}

fn get<'a>(q: &'a HashMap<String, String>, key: &str) -> Option<&'a str> {
    q.get(key).map(|s| s.as_str()).filter(|s| !s.is_empty())
}

fn truthy(v: Option<&str>) -> bool {
    matches!(v, Some("1") | Some("true") | Some("yes"))
}

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

// ---------------------------------------------------------------------------
// Shared stream settings
// ---------------------------------------------------------------------------

/// Build TLS options from the query string shared by VLESS/VMess/Trojan links.
fn parse_tls(q: &HashMap<String, String>, fallback_enabled: bool) -> TlsOptions {
    let security = get(q, "security").unwrap_or(if fallback_enabled { "tls" } else { "none" });
    let enabled = matches!(security, "tls" | "reality" | "xtls");

    let alpn = get(q, "alpn")
        .map(|s| {
            s.split(',')
                .map(|p| p.trim().to_string())
                .filter(|p| !p.is_empty())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    TlsOptions {
        enabled,
        server_name: get(q, "sni")
            .or_else(|| get(q, "peer"))
            .unwrap_or("")
            .to_string(),
        insecure: truthy(get(q, "allowinsecure")) || truthy(get(q, "insecure")),
        alpn,
        fingerprint: get(q, "fp").map(str::to_string),
        reality_public_key: get(q, "pbk").map(str::to_string),
        reality_short_id: get(q, "sid").map(str::to_string),
    }
}

/// Build the stream transport from the `type` parameter.
fn parse_transport(q: &HashMap<String, String>) -> Transport {
    let kind = get(q, "type").unwrap_or("tcp");
    let path = get(q, "path").unwrap_or("/").to_string();
    let host = get(q, "host").unwrap_or("").to_string();

    match kind {
        "ws" => {
            // v2rayN encodes early data either as `?ed=2048` or inside the path
            // as `/path?ed=2048`. Normalise both into explicit fields.
            let (path, early_from_path) = split_early_data(&path);
            Transport::Ws {
                path,
                host,
                early_data: get(q, "ed")
                    .and_then(|s| s.parse().ok())
                    .or(early_from_path)
                    .unwrap_or(0),
                early_data_header: get(q, "eh").map(str::to_string),
            }
        }
        // Query keys are lower-cased on the way in, so the camelCase spelling
        // panels emit arrives here as "servicename".
        "grpc" => Transport::Grpc {
            service_name: get(q, "servicename").unwrap_or("").to_string(),
        },
        "http" | "h2" => Transport::Http {
            path,
            host: host
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect(),
            method: get(q, "method").map(str::to_string),
        },
        "httpupgrade" => Transport::HttpUpgrade { path, host },
        "xhttp" | "splithttp" => Transport::Xhttp {
            path,
            host,
            mode: get(q, "mode").unwrap_or("auto").to_string(),
        },
        _ => Transport::Tcp,
    }
}

fn split_early_data(path: &str) -> (String, Option<u32>) {
    match path.split_once("?ed=") {
        Some((base, ed)) => {
            let value = ed
                .split('&')
                .next()
                .and_then(|s| s.parse::<u32>().ok());
            (base.to_string(), value)
        }
        None => (path.to_string(), None),
    }
}

fn host_port(url: &Url, link: &str) -> Result<(String, u16)> {
    let host = url
        .host_str()
        .ok_or_else(|| Error::BadLink(format!("no host in {link}")))?
        // IPv6 literals arrive bracketed from the url crate.
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_string();
    let port = url
        .port()
        .ok_or_else(|| Error::BadLink(format!("no port in {link}")))?;
    Ok((host, port))
}

fn fallback_name(server: &str, port: u16) -> String {
    format!("{server}:{port}")
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/// Parse a single share link. Returns `Err` for anything unrecognised.
pub fn parse_link(raw: &str) -> Result<Node> {
    let link = raw.trim();
    if link.is_empty() {
        return Err(Error::BadLink("empty".into()));
    }

    let scheme = link
        .split_once("://")
        .map(|(s, _)| s.to_ascii_lowercase())
        .ok_or_else(|| Error::BadLink(format!("no scheme in {link}")))?;

    match scheme.as_str() {
        "vless" => parse_vless(link),
        "vmess" => parse_vmess(link),
        "trojan" => parse_trojan(link),
        "ss" => parse_shadowsocks(link),
        "hysteria2" | "hy2" => parse_hysteria2(link),
        "tuic" => parse_tuic(link),
        "anytls" => parse_anytls(link),
        "socks" | "socks5" => parse_socks(link),
        "http" | "https" => Err(Error::BadLink(
            "plain http(s) URLs are subscriptions, not nodes".into(),
        )),
        other => Err(Error::BadLink(format!("unsupported scheme {other}"))),
    }
}

/// Parse a whole document: a base64 blob, or newline-separated links.
/// Unparseable lines are skipped rather than failing the batch.
pub fn parse_many(input: &str) -> Vec<Node> {
    let text = input.trim();

    // A subscription body is usually one big base64 blob. Decode it when the
    // result actually looks like links, otherwise treat the input as plain text.
    let decoded = b64_decode_utf8(text).filter(|d| d.contains("://"));
    let body = decoded.as_deref().unwrap_or(text);

    body.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .filter_map(|l| parse_link(l).ok())
        .collect()
}

// ---------------------------------------------------------------------------
// Per-protocol parsers
// ---------------------------------------------------------------------------

fn parse_vless(link: &str) -> Result<Node> {
    let url = Url::parse(link).map_err(|e| Error::BadLink(e.to_string()))?;
    let (server, server_port) = host_port(&url, link)?;
    let q = query_map(&url);

    let uuid = percent_decode_str(url.username())
        .decode_utf8_lossy()
        .to_string();
    if uuid.is_empty() {
        return Err(Error::BadLink("vless link has no uuid".into()));
    }

    let name = decode_fragment(url.fragment().unwrap_or(""));
    Ok(Node {
        id: new_id(),
        name: if name.is_empty() {
            fallback_name(&server, server_port)
        } else {
            name
        },
        server,
        server_port,
        protocol: Protocol::Vless {
            uuid,
            flow: get(&q, "flow").map(str::to_string),
            encryption: get(&q, "encryption").map(str::to_string),
        },
        tls: parse_tls(&q, false),
        transport: parse_transport(&q),
        multiplex: Multiplex::default(),
        subscription_id: None,
        link: Some(link.to_string()),
        latency_ms: None,
        last_tested_at: None,
    })
}

fn parse_vmess(link: &str) -> Result<Node> {
    let payload = link
        .strip_prefix("vmess://")
        .ok_or_else(|| Error::BadLink("not a vmess link".into()))?;

    // Two dialects exist: the v2rayN base64 JSON blob, and the newer
    // URL-shaped form that mirrors VLESS.
    if let Some(json) = b64_decode_utf8(payload) {
        return parse_vmess_json(&json, link);
    }
    parse_vmess_url(link)
}

fn parse_vmess_json(json: &str, link: &str) -> Result<Node> {
    let v: serde_json::Value =
        serde_json::from_str(json).map_err(|e| Error::BadLink(format!("vmess json: {e}")))?;

    // v2rayN writes numbers as strings about half the time.
    let s = |key: &str| -> String {
        match v.get(key) {
            Some(serde_json::Value::String(s)) => s.clone(),
            Some(serde_json::Value::Number(n)) => n.to_string(),
            _ => String::new(),
        }
    };

    let server = s("add");
    if server.is_empty() {
        return Err(Error::BadLink("vmess json has no address".into()));
    }
    let server_port: u16 = s("port")
        .parse()
        .map_err(|_| Error::BadLink("vmess json has no valid port".into()))?;

    let net = s("net");
    let path = {
        let p = s("path");
        if p.is_empty() {
            "/".to_string()
        } else {
            p
        }
    };
    let host = s("host");

    let transport = match net.as_str() {
        "ws" => {
            let (path, ed) = split_early_data(&path);
            Transport::Ws {
                path,
                host,
                early_data: ed.unwrap_or(0),
                early_data_header: None,
            }
        }
        "grpc" => Transport::Grpc {
            service_name: path.trim_start_matches('/').to_string(),
        },
        "h2" | "http" => Transport::Http {
            path,
            host: host
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect(),
            method: None,
        },
        "httpupgrade" => Transport::HttpUpgrade { path, host },
        _ => Transport::Tcp,
    };

    let tls_kind = s("tls");
    let sni = {
        let v = s("sni");
        if v.is_empty() {
            s("host")
        } else {
            v
        }
    };
    let alpn: Vec<String> = s("alpn")
        .split(',')
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
        .collect();

    let name = {
        let ps = s("ps");
        if ps.is_empty() {
            fallback_name(&server, server_port)
        } else {
            ps
        }
    };

    Ok(Node {
        id: new_id(),
        name,
        server,
        server_port,
        protocol: Protocol::Vmess {
            uuid: s("id"),
            alter_id: s("aid").parse().unwrap_or(0),
            security: {
                let scy = s("scy");
                if scy.is_empty() {
                    "auto".into()
                } else {
                    scy
                }
            },
            global_padding: false,
        },
        tls: TlsOptions {
            enabled: tls_kind == "tls" || tls_kind == "reality",
            server_name: sni,
            insecure: false,
            alpn,
            fingerprint: Some(s("fp")).filter(|f| !f.is_empty()),
            reality_public_key: None,
            reality_short_id: None,
        },
        transport,
        multiplex: Multiplex::default(),
        subscription_id: None,
        link: Some(link.to_string()),
        latency_ms: None,
        last_tested_at: None,
    })
}

fn parse_vmess_url(link: &str) -> Result<Node> {
    let url = Url::parse(link).map_err(|e| Error::BadLink(e.to_string()))?;
    let (server, server_port) = host_port(&url, link)?;
    let q = query_map(&url);
    let name = decode_fragment(url.fragment().unwrap_or(""));

    Ok(Node {
        id: new_id(),
        name: if name.is_empty() {
            fallback_name(&server, server_port)
        } else {
            name
        },
        server,
        server_port,
        protocol: Protocol::Vmess {
            uuid: url.username().to_string(),
            alter_id: get(&q, "aid").and_then(|s| s.parse().ok()).unwrap_or(0),
            security: get(&q, "encryption").unwrap_or("auto").to_string(),
            global_padding: false,
        },
        tls: parse_tls(&q, false),
        transport: parse_transport(&q),
        multiplex: Multiplex::default(),
        subscription_id: None,
        link: Some(link.to_string()),
        latency_ms: None,
        last_tested_at: None,
    })
}

fn parse_trojan(link: &str) -> Result<Node> {
    let url = Url::parse(link).map_err(|e| Error::BadLink(e.to_string()))?;
    let (server, server_port) = host_port(&url, link)?;
    let q = query_map(&url);
    let name = decode_fragment(url.fragment().unwrap_or(""));

    let password = percent_decode_str(url.username())
        .decode_utf8_lossy()
        .to_string();
    if password.is_empty() {
        return Err(Error::BadLink("trojan link has no password".into()));
    }

    Ok(Node {
        id: new_id(),
        name: if name.is_empty() {
            fallback_name(&server, server_port)
        } else {
            name
        },
        server,
        server_port,
        protocol: Protocol::Trojan { password },
        // Trojan is TLS-only, so absence of `security` still means TLS.
        tls: parse_tls(&q, true),
        transport: parse_transport(&q),
        multiplex: Multiplex::default(),
        subscription_id: None,
        link: Some(link.to_string()),
        latency_ms: None,
        last_tested_at: None,
    })
}

fn parse_shadowsocks(link: &str) -> Result<Node> {
    let body = link.strip_prefix("ss://").unwrap_or_default();

    // Split off the fragment before any decoding: it is never base64.
    let (body, fragment) = match body.split_once('#') {
        Some((b, f)) => (b, f),
        None => (body, ""),
    };
    let name = decode_fragment(fragment);

    let (body, query) = match body.split_once('?') {
        Some((b, q)) => (b, q),
        None => (body, ""),
    };

    // SIP002 keeps `user@host:port` in the clear with only the userinfo
    // base64-encoded. The legacy form base64s the whole `method:pass@host:port`.
    let (userinfo, hostport) = match body.rsplit_once('@') {
        Some((u, h)) => (
            b64_decode_utf8(u).unwrap_or_else(|| {
                percent_decode_str(u).decode_utf8_lossy().to_string()
            }),
            h.to_string(),
        ),
        None => {
            let decoded = b64_decode_utf8(body)
                .ok_or_else(|| Error::BadLink("ss link is not valid base64".into()))?;
            let (u, h) = decoded
                .rsplit_once('@')
                .ok_or_else(|| Error::BadLink("ss link has no host".into()))?;
            (u.to_string(), h.to_string())
        }
    };

    let (method, password) = userinfo
        .split_once(':')
        .ok_or_else(|| Error::BadLink("ss userinfo is not method:password".into()))?;

    let (server, port_str) = hostport
        .rsplit_once(':')
        .ok_or_else(|| Error::BadLink("ss link has no port".into()))?;
    let server = server.trim_start_matches('[').trim_end_matches(']');
    let server_port: u16 = port_str
        .parse()
        .map_err(|_| Error::BadLink(format!("bad ss port {port_str}")))?;

    let q: HashMap<String, String> = query
        .split('&')
        .filter(|s| !s.is_empty())
        .filter_map(|pair| pair.split_once('='))
        .map(|(k, v)| {
            (
                k.to_ascii_lowercase(),
                percent_decode_str(v).decode_utf8_lossy().to_string(),
            )
        })
        .collect();

    // `plugin=obfs-local;obfs=tls;obfs-host=x` — keep name and options apart.
    let (plugin, plugin_opts) = match get(&q, "plugin") {
        Some(raw) => match raw.split_once(';') {
            Some((name, opts)) => (Some(name.to_string()), Some(opts.to_string())),
            None => (Some(raw.to_string()), None),
        },
        None => (None, None),
    };

    Ok(Node {
        id: new_id(),
        name: if name.is_empty() {
            fallback_name(server, server_port)
        } else {
            name
        },
        server: server.to_string(),
        server_port,
        protocol: Protocol::Shadowsocks {
            method: method.to_string(),
            password: password.to_string(),
            plugin,
            plugin_opts,
        },
        tls: TlsOptions::default(),
        transport: Transport::Tcp,
        multiplex: Multiplex::default(),
        subscription_id: None,
        link: Some(link.to_string()),
        latency_ms: None,
        last_tested_at: None,
    })
}

fn parse_hysteria2(link: &str) -> Result<Node> {
    let url = Url::parse(link).map_err(|e| Error::BadLink(e.to_string()))?;
    let (server, server_port) = host_port(&url, link)?;
    let q = query_map(&url);
    let name = decode_fragment(url.fragment().unwrap_or(""));

    // Hysteria2 puts the password in userinfo, sometimes as `user:pass`.
    let password = if url.password().is_some() {
        format!(
            "{}:{}",
            percent_decode_str(url.username()).decode_utf8_lossy(),
            percent_decode_str(url.password().unwrap()).decode_utf8_lossy()
        )
    } else {
        percent_decode_str(url.username())
            .decode_utf8_lossy()
            .to_string()
    };

    let mut tls = parse_tls(&q, true);
    tls.enabled = true; // QUIC transport is always TLS.

    Ok(Node {
        id: new_id(),
        name: if name.is_empty() {
            fallback_name(&server, server_port)
        } else {
            name
        },
        server,
        server_port,
        protocol: Protocol::Hysteria2 {
            password,
            obfs_password: get(&q, "obfs-password")
                .or_else(|| get(&q, "obfspassword"))
                .map(str::to_string),
            up_mbps: get(&q, "upmbps").and_then(|s| s.parse().ok()),
            down_mbps: get(&q, "downmbps").and_then(|s| s.parse().ok()),
        },
        tls,
        transport: Transport::Tcp,
        multiplex: Multiplex::default(),
        subscription_id: None,
        link: Some(link.to_string()),
        latency_ms: None,
        last_tested_at: None,
    })
}

fn parse_tuic(link: &str) -> Result<Node> {
    let url = Url::parse(link).map_err(|e| Error::BadLink(e.to_string()))?;
    let (server, server_port) = host_port(&url, link)?;
    let q = query_map(&url);
    let name = decode_fragment(url.fragment().unwrap_or(""));

    let uuid = percent_decode_str(url.username())
        .decode_utf8_lossy()
        .to_string();
    let password = url
        .password()
        .map(|p| percent_decode_str(p).decode_utf8_lossy().to_string())
        .unwrap_or_default();

    let mut tls = parse_tls(&q, true);
    tls.enabled = true;

    Ok(Node {
        id: new_id(),
        name: if name.is_empty() {
            fallback_name(&server, server_port)
        } else {
            name
        },
        server,
        server_port,
        protocol: Protocol::Tuic {
            uuid,
            password,
            congestion_control: get(&q, "congestion_control")
                .or_else(|| get(&q, "congestion"))
                .map(str::to_string),
            udp_relay_mode: get(&q, "udp_relay_mode").map(str::to_string),
        },
        tls,
        transport: Transport::Tcp,
        multiplex: Multiplex::default(),
        subscription_id: None,
        link: Some(link.to_string()),
        latency_ms: None,
        last_tested_at: None,
    })
}

fn parse_anytls(link: &str) -> Result<Node> {
    let url = Url::parse(link).map_err(|e| Error::BadLink(e.to_string()))?;
    let (server, server_port) = host_port(&url, link)?;
    let q = query_map(&url);
    let name = decode_fragment(url.fragment().unwrap_or(""));

    let password = percent_decode_str(url.username())
        .decode_utf8_lossy()
        .to_string();

    let mut tls = parse_tls(&q, true);
    tls.enabled = true;

    Ok(Node {
        id: new_id(),
        name: if name.is_empty() {
            fallback_name(&server, server_port)
        } else {
            name
        },
        server,
        server_port,
        protocol: Protocol::AnyTls { password },
        tls,
        transport: Transport::Tcp,
        multiplex: Multiplex::default(),
        subscription_id: None,
        link: Some(link.to_string()),
        latency_ms: None,
        last_tested_at: None,
    })
}

fn parse_socks(link: &str) -> Result<Node> {
    let url = Url::parse(link).map_err(|e| Error::BadLink(e.to_string()))?;
    let (server, server_port) = host_port(&url, link)?;
    let name = decode_fragment(url.fragment().unwrap_or(""));

    let username = Some(url.username())
        .filter(|u| !u.is_empty())
        .map(|u| percent_decode_str(u).decode_utf8_lossy().to_string());
    let password = url
        .password()
        .map(|p| percent_decode_str(p).decode_utf8_lossy().to_string());

    Ok(Node {
        id: new_id(),
        name: if name.is_empty() {
            fallback_name(&server, server_port)
        } else {
            name
        },
        server,
        server_port,
        protocol: Protocol::Socks { username, password },
        tls: TlsOptions::default(),
        transport: Transport::Tcp,
        multiplex: Multiplex::default(),
        subscription_id: None,
        link: Some(link.to_string()),
        latency_ms: None,
        last_tested_at: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vless_reality_link() {
        let node = parse_link(
            "vless://d0d1b4e3-0000-4000-8000-000000000001@example.com:443\
             ?type=tcp&security=reality&pbk=PUBKEY&sid=ab&fp=chrome&sni=www.microsoft.com\
             &flow=xtls-rprx-vision#Test%20RU",
        )
        .unwrap();

        assert_eq!(node.name, "Test RU");
        assert_eq!(node.server, "example.com");
        assert_eq!(node.server_port, 443);
        assert!(node.tls.is_reality());
        assert_eq!(node.tls.server_name, "www.microsoft.com");
        assert!(matches!(node.transport, Transport::Tcp));
        match node.protocol {
            Protocol::Vless { flow, .. } => assert_eq!(flow.as_deref(), Some("xtls-rprx-vision")),
            _ => panic!("wrong protocol"),
        }
    }

    #[test]
    fn vless_ws_early_data_in_path() {
        let node =
            parse_link("vless://uuid@h.com:443?type=ws&path=%2Fws%3Fed%3D2048&host=a.com&security=tls#n")
                .unwrap();
        match node.transport {
            Transport::Ws {
                path, early_data, ..
            } => {
                assert_eq!(path, "/ws");
                assert_eq!(early_data, 2048);
            }
            _ => panic!("expected ws"),
        }
    }

    #[test]
    fn vmess_base64_json() {
        let json = r#"{"v":"2","ps":"Node","add":"1.2.3.4","port":"443","id":"uuid",
                       "aid":"0","net":"ws","path":"/p","host":"a.com","tls":"tls","scy":"auto"}"#;
        let link = format!("vmess://{}", STANDARD.encode(json));
        let node = parse_link(&link).unwrap();
        assert_eq!(node.name, "Node");
        assert_eq!(node.server_port, 443);
        assert!(node.tls.enabled);
        assert!(matches!(node.transport, Transport::Ws { .. }));
    }

    #[test]
    fn shadowsocks_sip002_and_legacy() {
        let sip002 = parse_link(&format!(
            "ss://{}@1.2.3.4:8388#SS",
            STANDARD_NO_PAD.encode("aes-256-gcm:pass")
        ))
        .unwrap();
        let legacy = parse_link(&format!(
            "ss://{}#SS",
            STANDARD_NO_PAD.encode("aes-256-gcm:pass@1.2.3.4:8388")
        ))
        .unwrap();

        for node in [sip002, legacy] {
            assert_eq!(node.server, "1.2.3.4");
            assert_eq!(node.server_port, 8388);
            match node.protocol {
                Protocol::Shadowsocks {
                    method, password, ..
                } => {
                    assert_eq!(method, "aes-256-gcm");
                    assert_eq!(password, "pass");
                }
                _ => panic!("wrong protocol"),
            }
        }
    }

    #[test]
    fn hysteria2_link() {
        let node = parse_link("hy2://secret@h.com:443?sni=a.com&insecure=1#HY").unwrap();
        assert!(node.tls.enabled);
        assert!(node.tls.insecure);
        match node.protocol {
            Protocol::Hysteria2 { password, .. } => assert_eq!(password, "secret"),
            _ => panic!("wrong protocol"),
        }
    }

    #[test]
    fn xhttp_is_parsed_but_flagged() {
        let node = parse_link("vless://uuid@h.com:443?type=xhttp&path=/x&security=tls#X").unwrap();
        assert_eq!(node.unsupported_reason(), Some("transport.xhttp"));
    }

    #[test]
    fn parse_many_handles_base64_subscription() {
        let body = "vless://uuid@a.com:443#A\nvless://uuid@b.com:443#B";
        let nodes = parse_many(&STANDARD.encode(body));
        assert_eq!(nodes.len(), 2);
        assert_eq!(nodes[1].name, "B");
    }

    #[test]
    fn parse_many_skips_broken_lines() {
        let nodes = parse_many("vless://uuid@a.com:443#A\ngarbage\nnot://a/link");
        assert_eq!(nodes.len(), 1);
    }
}
