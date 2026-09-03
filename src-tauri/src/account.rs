//! The user's account with the Vlyne service.
//!
//! The bot already exposes a small JSON API for its Telegram mini app. Rather
//! than restating that schema here, requests are passed through and the answers
//! are handed to the interface as-is: the shop lives in one place, and adding a
//! pack there does not mean editing three layers in this client.
//!
//! Authentication differs from the mini app's. Telegram signs `initData` for
//! pages it opens itself, which a desktop application cannot obtain, so the
//! user takes a one-time code from the bot and exchanges it for a device token.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::error::{Error, Result};

/// Where the service lives.
///
/// The mini app's own public address: the desktop client speaks to exactly the
/// same endpoints Telegram opens, so anything reachable there is reachable
/// here. Overridable, which is what lets a test deployment be pointed at.
pub const DEFAULT_API_BASE: &str = "https://vlessconf.ru:8444";

const TIMEOUT: Duration = Duration::from_secs(20);
const USER_AGENT: &str = concat!("Vlyne/", env!("CARGO_PKG_VERSION"));

/// Persisted link between this installation and a Telegram account.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    /// Device token from the pairing exchange. Absent until the user links up.
    #[serde(default)]
    pub token: Option<String>,
    #[serde(default)]
    pub user_id: Option<i64>,
    #[serde(default)]
    pub linked_at: Option<i64>,
    /// Empty means [`DEFAULT_API_BASE`].
    #[serde(default)]
    pub api_base: String,
}

impl Account {
    pub fn is_linked(&self) -> bool {
        self.token.as_deref().is_some_and(|t| !t.is_empty())
    }

    pub fn base(&self) -> &str {
        let trimmed = self.api_base.trim().trim_end_matches('/');
        if trimmed.is_empty() {
            DEFAULT_API_BASE
        } else {
            trimmed
        }
    }
}

/// Whether a host is this machine, where plain HTTP is nobody else's business.
fn is_loopback(host: &str) -> bool {
    let host = host.split(':').next().unwrap_or(host);
    matches!(host, "localhost" | "127.0.0.1" | "::1" | "[::1]")
}

/// Clean up an address the user typed, or explain why it cannot be used.
///
/// Every request to this address carries the device token, so plain HTTP to
/// anything but this machine is refused outright rather than quietly downgraded:
/// the token is a credential, and one typed "s" should not be what stands
/// between it and the open network.
pub fn normalise_base(raw: &str) -> Result<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(String::new());
    }

    // A bare host is the common way to type this, and https is the only scheme
    // worth assuming. Slashes are trimmed from the parsed result rather than
    // the input, so trimming cannot destroy the scheme it is meant to keep.
    let with_scheme = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };

    let parsed = url::Url::parse(&with_scheme)
        .map_err(|e| Error::Account(format!("{trimmed} is not a valid address: {e}")))?;

    let host = parsed.host_str().unwrap_or_default();
    if host.is_empty() {
        return Err(Error::Account(format!("{trimmed} names no host")));
    }

    match parsed.scheme() {
        "https" => {}
        "http" if is_loopback(host) => {}
        "http" => {
            return Err(Error::Account(format!(
                "{trimmed} would send your sign-in token unencrypted; use https://"
            )))
        }
        other => {
            return Err(Error::Account(format!(
                "{other}:// is not an address this client can use"
            )))
        }
    }

    Ok(parsed.as_str().trim_end_matches('/').to_string())
}

/// What the interface is allowed to know about the link. Never the token.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountInfo {
    pub linked: bool,
    pub user_id: Option<i64>,
    pub linked_at: Option<i64>,
    pub api_base: String,
}

impl From<&Account> for AccountInfo {
    fn from(a: &Account) -> Self {
        Self {
            linked: a.is_linked(),
            user_id: a.user_id,
            linked_at: a.linked_at,
            api_base: a.base().to_string(),
        }
    }
}

#[derive(Debug, Deserialize)]
struct ApiEnvelope {
    #[serde(default)]
    ok: Option<bool>,
    #[serde(default)]
    error: Option<String>,
}

fn client(proxy_port: Option<u16>) -> Result<reqwest::Client> {
    let mut builder = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(TIMEOUT);

    builder = match proxy_port {
        Some(port) => builder.proxy(
            reqwest::Proxy::all(format!("socks5h://127.0.0.1:{port}"))
                .map_err(|e| Error::Account(e.to_string()))?,
        ),
        // Ignore any ambient proxy variables; the only detour we want is one
        // we chose deliberately.
        None => builder.no_proxy(),
    };

    builder.build().map_err(|e| Error::Account(e.to_string()))
}

/// POST a JSON body and unwrap the service's `{ok, error, ...}` envelope.
///
/// A direct attempt comes first, and the tunnel is tried only if that fails —
/// the shop has to stay reachable from a network that blocks the service, but
/// a working connection should not pay the tunnel's latency.
async fn post(
    base: &str,
    path: &str,
    token: Option<&str>,
    body: Value,
    via_proxy: Option<u16>,
) -> Result<Value> {
    let direct = post_once(base, path, token, &body, None).await;
    match (direct, via_proxy) {
        (Ok(value), _) => Ok(value),
        (Err(Error::Account(direct_err)), Some(port)) => {
            post_once(base, path, token, &body, Some(port))
                .await
                .map_err(|proxy_err| {
                    Error::Account(format!("{direct_err}; through the tunnel: {proxy_err}"))
                })
        }
        // A refusal from the service itself is final; retrying it through the
        // tunnel would only turn a clear message into a confusing one.
        (Err(e), _) => Err(e),
    }
}

async fn post_once(
    base: &str,
    path: &str,
    token: Option<&str>,
    body: &Value,
    proxy_port: Option<u16>,
) -> Result<Value> {
    let url = format!("{base}{path}");
    let mut request = client(proxy_port)?.post(&url).json(body);
    if let Some(token) = token {
        request = request.bearer_auth(token);
    }

    let response = request
        .send()
        .await
        .map_err(|e| Error::Account(format!("{url} is unreachable: {e}")))?;

    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|e| Error::Account(e.to_string()))?;

    // Name the address and quote the answer. An error that says only "bad
    // response" leaves no way to tell a wrong address from a broken service,
    // and the address is configurable, so getting it wrong is easy.
    let value: Value = serde_json::from_str(&text).map_err(|_| {
        let snippet: String = text.chars().take(160).collect();
        Error::Account(format!(
            "{url} answered {status}, and not with JSON: {}",
            if snippet.trim().is_empty() {
                "(empty body)".to_string()
            } else {
                snippet.replace(['\n', '\r'], " ")
            }
        ))
    })?;

    let envelope: ApiEnvelope = serde_json::from_value(value.clone()).unwrap_or(ApiEnvelope {
        ok: None,
        error: None,
    });

    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err(Error::AccountUnlinked);
    }
    if envelope.ok == Some(false) || !status.is_success() {
        return Err(Error::Account(
            envelope
                .error
                .unwrap_or_else(|| format!("{url} answered {status}")),
        ));
    }

    Ok(value)
}

/// Exchange a one-time code from the bot for a device token.
pub async fn pair(base: &str, code: &str, device: &str, via_proxy: Option<u16>) -> Result<Account> {
    let answer = post(
        base,
        "/api/device/claim",
        None,
        json!({ "code": code, "device": device }),
        via_proxy,
    )
    .await?;

    let token = answer
        .get("token")
        .and_then(Value::as_str)
        .filter(|t| !t.is_empty())
        .ok_or_else(|| Error::Account("the service returned no token".into()))?;

    Ok(Account {
        token: Some(token.to_string()),
        user_id: answer.get("user_id").and_then(Value::as_i64),
        linked_at: Some(chrono::Utc::now().timestamp()),
        api_base: String::new(),
    })
}

/// Everything the shop needs: quota, packs, referral programme.
pub async fn state(account: &Account, via_proxy: Option<u16>) -> Result<Value> {
    authorised(account, "/api/state", json!({}), via_proxy).await
}

/// Price a pack, optionally with a promo code applied.
pub async fn quote(
    account: &Account,
    pack: &str,
    promo: Option<&str>,
    via_proxy: Option<u16>,
) -> Result<Value> {
    authorised(
        account,
        "/api/promo",
        json!({ "pack": pack, "promo": promo.unwrap_or_default() }),
        via_proxy,
    )
    .await
}

/// Start a purchase. The answer carries the payment page to open in a browser.
pub async fn buy(
    account: &Account,
    pack: &str,
    method: &str,
    promo: Option<&str>,
    via_proxy: Option<u16>,
) -> Result<Value> {
    authorised(
        account,
        "/api/buy",
        json!({ "pack": pack, "method": method, "promo": promo.unwrap_or_default() }),
        via_proxy,
    )
    .await
}

/// Ask whether a payment has gone through and the traffic been credited.
pub async fn check(
    account: &Account,
    order_id: &Value,
    via_proxy: Option<u16>,
) -> Result<Value> {
    authorised(
        account,
        "/api/check",
        json!({ "order_id": order_id }),
        via_proxy,
    )
    .await
}

/// Tell the service to forget this device.
pub async fn forget(account: &Account, via_proxy: Option<u16>) -> Result<()> {
    authorised(account, "/api/device/forget", json!({}), via_proxy).await?;
    Ok(())
}

async fn authorised(
    account: &Account,
    path: &str,
    body: Value,
    via_proxy: Option<u16>,
) -> Result<Value> {
    let token = account.token.as_deref().ok_or(Error::AccountUnlinked)?;
    post(account.base(), path, Some(token), body, via_proxy).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_empty_base_falls_back_to_the_service() {
        let account = Account::default();
        assert_eq!(account.base(), DEFAULT_API_BASE);
        assert!(!account.is_linked());
    }

    /// Every request to the service carries the device token, so a plain HTTP
    /// address to anything but this machine has to be refused, not fixed up.
    #[test]
    fn plain_http_to_a_remote_host_is_refused() {
        let err = normalise_base("http://vlessconf.ru:8444").unwrap_err();
        assert!(err.to_string().contains("https://"), "{err}");
    }

    #[test]
    fn plain_http_to_this_machine_is_allowed() {
        // A local test deployment has nothing to protect from the network.
        for base in ["http://127.0.0.1:8099", "http://localhost:8099"] {
            assert_eq!(normalise_base(base).unwrap(), base);
        }
    }

    #[test]
    fn a_bare_host_gains_https() {
        assert_eq!(
            normalise_base(" vlessconf.ru:8444/ ").unwrap(),
            "https://vlessconf.ru:8444"
        );
    }

    #[test]
    fn an_empty_address_means_the_default() {
        assert_eq!(normalise_base("   ").unwrap(), "");
    }

    #[test]
    fn nonsense_is_reported_rather_than_stored() {
        assert!(normalise_base("ftp://example.com").is_err());
        assert!(normalise_base("https://").is_err());
    }

    #[test]
    fn a_custom_base_loses_its_trailing_slash() {
        // Paths are joined verbatim, so a trailing slash would produce "//api".
        let account = Account {
            api_base: "https://staging.example.com/ ".into(),
            ..Account::default()
        };
        assert_eq!(account.base(), "https://staging.example.com");
    }

    /// The token is the credential; it must never travel to the interface.
    #[test]
    fn the_reported_info_omits_the_token() {
        let account = Account {
            token: Some("super-secret".into()),
            user_id: Some(42),
            linked_at: Some(1),
            api_base: String::new(),
        };

        let json = serde_json::to_string(&AccountInfo::from(&account)).unwrap();
        assert!(!json.contains("super-secret"));
        assert!(json.contains("\"linked\":true"));
    }
}
