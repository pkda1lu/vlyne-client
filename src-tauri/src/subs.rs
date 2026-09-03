//! Subscription fetching and refresh.

use std::time::Duration;

use crate::error::{Error, Result};
use crate::link;
use crate::model::{Node, SubscriptionUsage};

const USER_AGENT: &str = concat!("Vlyne/", env!("CARGO_PKG_VERSION"), " (sing-box)");
const FETCH_TIMEOUT: Duration = Duration::from_secs(25);

pub struct FetchResult {
    pub nodes: Vec<Node>,
    /// Title advertised by the panel, if any.
    pub title: Option<String>,
    pub usage: Option<SubscriptionUsage>,
}

/// Download and parse a subscription.
///
/// When `via_proxy` is set the request goes through the running tunnel, which
/// is what makes a blocked subscription URL still refreshable while connected.
/// A direct attempt is always tried first so a working link never pays the
/// tunnel's latency.
pub async fn fetch(url: &str, via_proxy: Option<u16>) -> Result<FetchResult> {
    let direct = request(url, None).await;

    let response = match (direct, via_proxy) {
        (Ok(r), _) => r,
        (Err(direct_err), Some(port)) => request(url, Some(port)).await.map_err(|proxy_err| {
            Error::Subscription(format!("{direct_err}; through the tunnel: {proxy_err}"))
        })?,
        (Err(e), None) => return Err(e),
    };

    Ok(response)
}

async fn request(url: &str, proxy_port: Option<u16>) -> Result<FetchResult> {
    let mut builder = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(FETCH_TIMEOUT);

    builder = match proxy_port {
        Some(port) => builder.proxy(
            reqwest::Proxy::all(format!("socks5h://127.0.0.1:{port}"))
                .map_err(|e| Error::Subscription(e.to_string()))?,
        ),
        // Ignore any ambient proxy environment variables: the only proxy we
        // ever want here is one we chose deliberately.
        None => builder.no_proxy(),
    };

    let client = builder
        .build()
        .map_err(|e| Error::Subscription(e.to_string()))?;

    let response = client.get(url).send().await?;
    let status = response.status();
    if !status.is_success() {
        return Err(Error::Subscription(format!("the server answered {status}")));
    }

    let headers = response.headers().clone();
    let body = response.text().await?;

    let nodes = link::parse_many(&body);
    if nodes.is_empty() {
        return Err(Error::Subscription(
            "the response contained no readable nodes".into(),
        ));
    }

    Ok(FetchResult {
        nodes,
        title: extract_title(&headers),
        usage: extract_usage(&headers),
    })
}

/// Panels announce their name either as `profile-title` (sometimes base64) or
/// through a `content-disposition` filename.
fn extract_title(headers: &reqwest::header::HeaderMap) -> Option<String> {
    if let Some(raw) = headers.get("profile-title").and_then(|v| v.to_str().ok()) {
        let value = raw.trim();
        let decoded = value
            .strip_prefix("base64:")
            .and_then(link::b64_decode)
            .and_then(|b| String::from_utf8(b).ok());
        let title = decoded.unwrap_or_else(|| value.to_string());
        if !title.is_empty() {
            return Some(title);
        }
    }

    let disposition = headers
        .get(reqwest::header::CONTENT_DISPOSITION)?
        .to_str()
        .ok()?;

    // Prefer the RFC 5987 form, which carries the encoding explicitly.
    if let Some(idx) = disposition.find("filename*=UTF-8''") {
        let raw = &disposition[idx + "filename*=UTF-8''".len()..];
        let raw = raw.split(';').next()?.trim();
        return percent_encoding::percent_decode_str(raw)
            .decode_utf8()
            .ok()
            .map(|s| s.trim_matches('"').to_string())
            .filter(|s| !s.is_empty());
    }

    let idx = disposition.find("filename=")?;
    let raw = disposition[idx + "filename=".len()..]
        .split(';')
        .next()?
        .trim()
        .trim_matches('"');
    (!raw.is_empty()).then(|| raw.to_string())
}

/// `subscription-userinfo: upload=1; download=2; total=3; expire=4`
fn extract_usage(headers: &reqwest::header::HeaderMap) -> Option<SubscriptionUsage> {
    let raw = headers
        .get("subscription-userinfo")?
        .to_str()
        .ok()?
        .to_ascii_lowercase();

    let field = |name: &str| -> Option<u64> {
        raw.split(';')
            .filter_map(|part| part.trim().split_once('='))
            .find(|(k, _)| k.trim() == name)
            .and_then(|(_, v)| v.trim().parse().ok())
    };

    Some(SubscriptionUsage {
        upload: field("upload").unwrap_or(0),
        download: field("download").unwrap_or(0),
        total: field("total").unwrap_or(0),
        expire: field("expire").unwrap_or(0) as i64,
    })
}

/// Replace a subscription's nodes with a freshly fetched set.
///
/// Latency measurements are carried across for endpoints that survived the
/// refresh, so a routine update does not blank out the whole latency column.
pub fn merge_refreshed(existing: &[Node], mut incoming: Vec<Node>, subscription_id: &str) -> Vec<Node> {
    let previous: Vec<&Node> = existing
        .iter()
        .filter(|n| n.subscription_id.as_deref() == Some(subscription_id))
        .collect();

    for node in &mut incoming {
        node.subscription_id = Some(subscription_id.to_string());

        if let Some(old) = previous.iter().find(|o| o.dedup_key() == node.dedup_key()) {
            // Keeping the id keeps the active selection pointing at the same
            // node across a refresh.
            node.id = old.id.clone();
            node.latency_ms = old.latency_ms;
            node.last_tested_at = old.last_tested_at;
        }
    }

    incoming
}

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::header::{HeaderMap, HeaderValue};

    #[test]
    fn parses_usage_header() {
        let mut headers = HeaderMap::new();
        headers.insert(
            "subscription-userinfo",
            HeaderValue::from_static("upload=100; download=200; total=1000; expire=1700000000"),
        );

        let usage = extract_usage(&headers).unwrap();
        assert_eq!(usage.download, 200);
        assert_eq!(usage.total, 1000);
        assert_eq!(usage.expire, 1_700_000_000);
    }

    #[test]
    fn parses_utf8_filename() {
        let mut headers = HeaderMap::new();
        headers.insert(
            reqwest::header::CONTENT_DISPOSITION,
            HeaderValue::from_static("attachment; filename*=UTF-8''%D0%9C%D0%BE%D1%8F"),
        );
        assert_eq!(extract_title(&headers).as_deref(), Some("Моя"));
    }

    #[test]
    fn refresh_preserves_latency_of_surviving_nodes() {
        let mut old = link::parse_link("vless://uuid@a.com:443?security=tls#A").unwrap();
        old.subscription_id = Some("s1".into());
        old.latency_ms = Some(42);
        let old_id = old.id.clone();

        let incoming = vec![
            link::parse_link("vless://uuid@a.com:443?security=tls#A").unwrap(),
            link::parse_link("vless://uuid@b.com:443?security=tls#B").unwrap(),
        ];

        let merged = merge_refreshed(&[old], incoming, "s1");
        assert_eq!(merged[0].id, old_id);
        assert_eq!(merged[0].latency_ms, Some(42));
        assert_eq!(merged[1].latency_ms, None);
        assert_eq!(merged[1].subscription_id.as_deref(), Some("s1"));
    }
}
