//! Client for the sing-box Clash-compatible control API.
//!
//! This is what makes node switching instant: the running core exposes a
//! selector, so choosing another node is one HTTP call instead of a restart.
//! It also provides real end-to-end latency — an actual request through the
//! tunnel — rather than the bare TCP handshake the old client measured.

use std::time::Duration;

use futures_util::StreamExt;
use serde::Deserialize;
use tokio::sync::mpsc;

use crate::error::{Error, Result};

#[derive(Debug, Clone, Copy, Deserialize)]
pub struct TrafficSample {
    #[serde(default)]
    pub up: u64,
    #[serde(default)]
    pub down: u64,
}

#[derive(Debug, Deserialize)]
struct DelayResponse {
    #[serde(default)]
    delay: u32,
}

#[derive(Debug, Clone)]
pub struct ClashClient {
    base: String,
    secret: String,
    http: reqwest::Client,
}

impl ClashClient {
    pub fn new(addr: &str, secret: &str) -> Result<Self> {
        Ok(Self {
            base: format!("http://{addr}"),
            secret: secret.to_string(),
            // The control port is on loopback; never route it through whatever
            // proxy the environment happens to advertise.
            http: reqwest::Client::builder()
                .no_proxy()
                .build()
                .map_err(|e| Error::Other(e.to_string()))?,
        })
    }

    /// Point the selector at a node tag.
    pub async fn select(&self, selector: &str, tag: &str) -> Result<()> {
        let response = self
            .http
            .put(format!("{}/proxies/{}", self.base, urlencode(selector)))
            .bearer_auth(&self.secret)
            .json(&serde_json::json!({ "name": tag }))
            .timeout(Duration::from_secs(5))
            .send()
            .await
            .map_err(|e| Error::Other(format!("selector switch failed: {e}")))?;

        if !response.status().is_success() {
            return Err(Error::Other(format!(
                "the core refused to switch to {tag} ({})",
                response.status()
            )));
        }
        Ok(())
    }

    /// Ask which outbound a selector currently points at.
    pub async fn current_selection(&self, selector: &str) -> Result<String> {
        #[derive(Deserialize)]
        struct Proxy {
            now: String,
        }

        let proxy: Proxy = self
            .http
            .get(format!("{}/proxies/{}", self.base, urlencode(selector)))
            .bearer_auth(&self.secret)
            .timeout(Duration::from_secs(5))
            .send()
            .await
            .map_err(|e| Error::Other(format!("cannot read the selector: {e}")))?
            .json()
            .await
            .map_err(|e| Error::Other(e.to_string()))?;

        Ok(proxy.now)
    }

    /// Measure latency through one outbound by fetching `url` over it.
    ///
    /// Returns `None` when the node is unreachable, which the UI shows as a
    /// timeout rather than an error.
    pub async fn delay(&self, tag: &str, url: &str, timeout_ms: u32) -> Result<Option<u32>> {
        let response = self
            .http
            .get(format!("{}/proxies/{}/delay", self.base, urlencode(tag)))
            .bearer_auth(&self.secret)
            .query(&[
                ("url", url),
                ("timeout", &timeout_ms.to_string()),
            ])
            // Give the core a little longer than the probe itself, so a slow
            // node reads as slow rather than as a client-side failure.
            .timeout(Duration::from_millis(timeout_ms as u64 + 3000))
            .send()
            .await
            .map_err(|e| Error::Other(format!("latency probe failed: {e}")))?;

        if !response.status().is_success() {
            return Ok(None);
        }

        let body: DelayResponse = response
            .json()
            .await
            .map_err(|e| Error::Other(e.to_string()))?;
        Ok((body.delay > 0).then_some(body.delay))
    }

    /// Stream traffic samples until the connection drops or `stop` is dropped.
    ///
    /// sing-box emits one JSON object per line over a chunked response, so the
    /// body is consumed as a byte stream and split on newlines.
    pub async fn stream_traffic(&self, tx: mpsc::UnboundedSender<TrafficSample>) -> Result<()> {
        let response = self
            .http
            .get(format!("{}/traffic", self.base))
            .bearer_auth(&self.secret)
            .send()
            .await
            .map_err(|e| Error::Other(format!("cannot open the traffic stream: {e}")))?;

        let mut stream = response.bytes_stream();
        let mut buffer = Vec::new();

        while let Some(chunk) = stream.next().await {
            let Ok(chunk) = chunk else { break };
            buffer.extend_from_slice(&chunk);

            while let Some(pos) = buffer.iter().position(|&b| b == b'\n') {
                let line: Vec<u8> = buffer.drain(..=pos).collect();
                let line = &line[..line.len() - 1];
                if line.is_empty() {
                    continue;
                }
                if let Ok(sample) = serde_json::from_slice::<TrafficSample>(line) {
                    // A closed receiver means the connection ended; stop cleanly.
                    if tx.send(sample).is_err() {
                        return Ok(());
                    }
                }
            }

            // Guard against a peer that never sends a newline.
            if buffer.len() > 64 * 1024 {
                buffer.clear();
            }
        }

        Ok(())
    }
}

fn urlencode(s: &str) -> String {
    percent_encoding::utf8_percent_encode(s, percent_encoding::NON_ALPHANUMERIC).to_string()
}

/// Bare TCP handshake latency, used when the core is not running.
///
/// It is not a substitute for [`ClashClient::delay`] — it only proves the port
/// accepts connections — but it needs no tunnel and runs massively in parallel.
pub async fn tcp_latency(host: &str, port: u16, timeout_ms: u32) -> Option<u32> {
    use tokio::net::TcpStream;

    let started = tokio::time::Instant::now();
    let connect = TcpStream::connect((host, port));

    match tokio::time::timeout(Duration::from_millis(timeout_ms as u64), connect).await {
        Ok(Ok(_stream)) => Some(started.elapsed().as_millis().min(u32::MAX as u128) as u32),
        _ => None,
    }
}
