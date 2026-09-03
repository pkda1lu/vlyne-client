//! The IPC surface exposed to the frontend.

use std::sync::Arc;

use tauri::State;

use crate::core;
use crate::error::{Error, Result};
use crate::link;
use crate::model::{AppData, Node, Settings, Status, Subscription, Traffic, TunnelMode};
use crate::state::AppState;
use crate::subs;

type App<'a> = State<'a, Arc<AppState>>;

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bootstrap {
    data: AppData,
    status: Status,
    traffic: Traffic,
    app_version: String,
    core_version: String,
    elevated: bool,
    logs: Vec<core::LogLine>,
}

#[tauri::command]
pub async fn bootstrap(state: App<'_>) -> Result<Bootstrap> {
    let core_version = match state.core_binary() {
        Ok(binary) => core::core_version(&binary)
            .await
            .unwrap_or_else(|_| "unknown".into()),
        Err(_) => "missing".into(),
    };

    let data = state.store.snapshot();
    tracing::info!(
        nodes = data.nodes.len(),
        subscriptions = data.subscriptions.len(),
        active_node_id = ?data.active_node_id,
        "handing the profile to the interface"
    );

    Ok(Bootstrap {
        data,
        status: state.status(),
        traffic: state.traffic(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        core_version,
        elevated: crate::elevation::is_elevated(),
        logs: state.logs.snapshot(),
    })
}

#[tauri::command]
pub fn get_status(state: App<'_>) -> Status {
    state.status()
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn connect(state: App<'_>, node_id: Option<String>) -> Result<()> {
    state.inner().connect(node_id).await
}

#[tauri::command]
pub async fn disconnect(state: App<'_>) -> Result<()> {
    state.disconnect().await
}

#[tauri::command]
pub async fn select_node(state: App<'_>, node_id: String) -> Result<()> {
    state.inner().select_node(&node_id).await
}

#[tauri::command]
pub async fn select_auto(state: App<'_>) -> Result<()> {
    state.select_auto().await
}

#[tauri::command]
pub async fn test_latency(state: App<'_>, node_ids: Option<Vec<String>>) -> Result<()> {
    state.inner().test_latency(node_ids).await
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

/// Import one or many share links. Returns how many nodes were added.
#[tauri::command]
pub async fn import_links(state: App<'_>, text: String) -> Result<usize> {
    let parsed = link::parse_many(&text);
    if parsed.is_empty() {
        // A single malformed link deserves its specific error, not "none found".
        if text.trim().lines().count() == 1 {
            link::parse_link(text.trim())?;
        }
        return Err(Error::BadLink("no readable links in the input".into()));
    }

    let added = state.store.write(|d| {
        let before = d.nodes.len();
        for node in parsed {
            // Re-importing the same endpoint should not multiply it.
            if !d.nodes.iter().any(|n| n.dedup_key() == node.dedup_key()) {
                d.nodes.push(node);
            }
        }
        if d.active_node_id.is_none() {
            d.active_node_id = d.nodes.first().map(|n| n.id.clone());
        }
        d.nodes.len() - before
    })?;

    state.emit_data_changed();
    Ok(added)
}

#[tauri::command]
pub async fn update_node(state: App<'_>, node: Node) -> Result<()> {
    state.store.write(|d| {
        if let Some(slot) = d.nodes.iter_mut().find(|n| n.id == node.id) {
            *slot = node;
        }
    })?;
    state.emit_data_changed();
    Ok(())
}

#[tauri::command]
pub async fn delete_nodes(state: App<'_>, node_ids: Vec<String>) -> Result<()> {
    state.store.write(|d| {
        d.nodes.retain(|n| !node_ids.contains(&n.id));
        if d
            .active_node_id
            .as_ref()
            .is_some_and(|id| node_ids.contains(id))
        {
            d.active_node_id = d.nodes.first().map(|n| n.id.clone());
        }
    })?;
    state.emit_data_changed();
    Ok(())
}

#[tauri::command]
pub fn export_node_link(state: App<'_>, node_id: String) -> Result<String> {
    state
        .store
        .read(|d| {
            d.nodes
                .iter()
                .find(|n| n.id == node_id)
                .and_then(|n| n.link.clone())
        })
        .ok_or_else(|| Error::NodeNotFound(node_id))
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn add_subscription(state: App<'_>, url: String, name: Option<String>) -> Result<String> {
    let id = uuid::Uuid::new_v4().to_string();
    let subscription = Subscription {
        id: id.clone(),
        name: name.unwrap_or_else(|| "…".into()),
        url,
        enabled: true,
        update_interval_hours: 12,
        last_updated_at: None,
        last_error: None,
        usage: None,
        node_count: 0,
    };

    state.store.write(|d| d.subscriptions.push(subscription))?;
    state.emit_data_changed();

    // A failed first refresh leaves the subscription in place with its error
    // recorded, so the user can fix the URL instead of re-adding it.
    let _ = refresh_subscription(state.clone(), id.clone()).await;
    Ok(id)
}

#[tauri::command]
pub async fn refresh_subscription(state: App<'_>, id: String) -> Result<usize> {
    let (url, connected) = {
        let url = state
            .store
            .read(|d| d.subscriptions.iter().find(|s| s.id == id).map(|s| s.url.clone()))
            .ok_or_else(|| Error::Subscription(format!("subscription {id} not found")))?;
        (url, state.status().state == crate::model::ConnectionState::Connected)
    };

    let via_proxy = connected.then(|| state.settings().inbound.socks_port);
    let now = chrono::Utc::now().timestamp();

    let result = match subs::fetch(&url, via_proxy).await {
        Ok(result) => result,
        Err(e) => {
            let message = e.to_string();
            state.store.write(|d| {
                if let Some(s) = d.subscriptions.iter_mut().find(|s| s.id == id) {
                    s.last_error = Some(message);
                    s.last_updated_at = Some(now);
                }
            })?;
            state.emit_data_changed();
            return Err(e);
        }
    };

    let count = state.store.write(|d| {
        let merged = subs::merge_refreshed(&d.nodes, result.nodes, &id);
        let count = merged.len();

        d.nodes.retain(|n| n.subscription_id.as_deref() != Some(id.as_str()));
        d.nodes.extend(merged);

        if let Some(s) = d.subscriptions.iter_mut().find(|s| s.id == id) {
            if let Some(title) = result.title.filter(|t| !t.is_empty()) {
                // Only adopt the panel's title while the user has not renamed it.
                if s.name == "…" || s.name.is_empty() {
                    s.name = title;
                }
            }
            s.usage = result.usage;
            s.node_count = count;
            s.last_updated_at = Some(now);
            s.last_error = None;
        }

        if d.active_node_id.is_none() {
            d.active_node_id = d.nodes.first().map(|n| n.id.clone());
        }
        count
    })?;

    state.emit_data_changed();
    Ok(count)
}

#[tauri::command]
pub async fn update_subscription(state: App<'_>, subscription: Subscription) -> Result<()> {
    state.store.write(|d| {
        if let Some(slot) = d.subscriptions.iter_mut().find(|s| s.id == subscription.id) {
            *slot = subscription;
        }
    })?;
    state.emit_data_changed();
    Ok(())
}

#[tauri::command]
pub async fn delete_subscription(state: App<'_>, id: String, keep_nodes: bool) -> Result<()> {
    state.store.write(|d| {
        d.subscriptions.retain(|s| s.id != id);
        if keep_nodes {
            // Detach them so they survive as manual nodes.
            for node in d.nodes.iter_mut() {
                if node.subscription_id.as_deref() == Some(id.as_str()) {
                    node.subscription_id = None;
                }
            }
        } else {
            d.nodes
                .retain(|n| n.subscription_id.as_deref() != Some(id.as_str()));
            if d
                .active_node_id
                .as_ref()
                .is_some_and(|id| !d.nodes.iter().any(|n| &n.id == id))
            {
                d.active_node_id = d.nodes.first().map(|n| n.id.clone());
            }
        }
    })?;
    state.emit_data_changed();
    Ok(())
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn save_settings(state: App<'_>, settings: Settings) -> Result<bool> {
    let previous = state.settings();
    let needs_restart = state.status().state == crate::model::ConnectionState::Connected
        && requires_core_restart(&previous, &settings);

    state.store.write(|d| d.settings = settings)?;
    state.emit_data_changed();
    Ok(needs_restart)
}

/// Which settings the running core cannot pick up without being restarted.
fn requires_core_restart(a: &Settings, b: &Settings) -> bool {
    a.mode.0 != b.mode.0
        || a.inbound.socks_port != b.inbound.socks_port
        || a.inbound.http_port != b.inbound.http_port
        || a.inbound.clash_port != b.inbound.clash_port
        || a.inbound.allow_lan != b.inbound.allow_lan
        || a.routing.preset != b.routing.preset
        || a.routing.block_ads != b.routing.block_ads
        || a.routing.block_quic_for_direct != b.routing.block_quic_for_direct
        || serde_json::to_string(&a.routing.rules).ok()
            != serde_json::to_string(&b.routing.rules).ok()
        || a.routing.bypass_processes != b.routing.bypass_processes
        || a.dns.remote != b.dns.remote
        || a.dns.direct != b.dns.direct
        || a.dns.enable_fakeip != b.dns.enable_fakeip
        || a.dns.disable_cache != b.dns.disable_cache
        || a.tun.mtu != b.tun.mtu
        || a.tun.strict_route != b.tun.strict_route
        || a.tun.auto_route != b.tun.auto_route
        || a.tun.ipv6 != b.tun.ipv6
        || a.probe.url != b.probe.url
        || a.probe.interval_s != b.probe.interval_s
        || a.core.log_level != b.core.log_level
        || a.core.config_override != b.core.config_override
        || a.core.multiplex != b.core.multiplex
}

/// Switch between system-proxy and TUN.
///
/// Returns `true` when the app must be relaunched with administrator rights
/// before TUN can be used; the UI turns that into an explicit prompt rather
/// than a surprise UAC dialog.
#[tauri::command]
pub async fn set_mode(state: App<'_>, mode: TunnelMode) -> Result<bool> {
    let needs_elevation = mode == TunnelMode::Tun && !crate::elevation::is_elevated();

    state.store.write(|d| d.settings.mode.0 = mode)?;
    state.emit_data_changed();
    Ok(needs_elevation)
}

#[tauri::command]
pub async fn restart_elevated(state: App<'_>) -> Result<()> {
    // Leave the machine in a clean state before handing over to the new instance.
    state.disconnect().await?;
    crate::elevation::relaunch_elevated()?;
    state.app.exit(0);
    Ok(())
}

// ---------------------------------------------------------------------------
// Account and shop
// ---------------------------------------------------------------------------

/// Reach the service through the tunnel only when one is up.
fn shop_detour(state: &App<'_>) -> Option<u16> {
    (state.status().state == crate::model::ConnectionState::Connected)
        .then(|| state.settings().inbound.socks_port)
}

#[tauri::command]
pub fn account_info(state: App<'_>) -> crate::account::AccountInfo {
    state.store.read(|d| (&d.account).into())
}

/// Exchange a one-time code from the bot for a device token.
#[tauri::command]
pub async fn account_link(state: App<'_>, code: String) -> Result<crate::account::AccountInfo> {
    let base = state.store.read(|d| d.account.base());
    let device = format!("Vlyne {} / Windows", env!("CARGO_PKG_VERSION"));

    let linked = crate::account::pair(&base, code.trim(), &device, shop_detour(&state)).await?;

    let info = state.store.write(|d| {
        // Preserve a custom base across relinking; only the credential changes.
        let api_base = d.account.api_base.clone();
        d.account = crate::account::Account { api_base, ..linked };
        (&d.account).into()
    })?;

    state.emit_data_changed();
    Ok(info)
}

#[tauri::command]
pub async fn account_unlink(state: App<'_>) -> Result<()> {
    let account = state.store.read(|d| d.account.clone());

    // Tell the service if we can, but never let its answer strand the user on
    // a device they asked to sign out of.
    if account.is_linked() {
        if let Err(e) = crate::account::forget(&account, shop_detour(&state)).await {
            tracing::warn!("the service did not confirm the unlink: {e}");
        }
    }

    state.store.write(|d| {
        let api_base = d.account.api_base.clone();
        d.account = crate::account::Account {
            api_base,
            ..Default::default()
        };
    })?;
    state.emit_data_changed();
    Ok(())
}

/// Point the client at another deployment. Empty restores the default.
#[tauri::command]
pub async fn account_set_api_base(state: App<'_>, base: String) -> Result<String> {
    let normalised = crate::account::normalise_base(&base)?;
    state.store.write(|d| d.account.api_base = normalised)?;
    state.emit_data_changed();

    // Hand back what was actually stored, so the field shows the address that
    // will be used rather than whatever was typed.
    Ok(state.store.read(|d| d.account.base()))
}

/// Quota, packs and referral programme, passed through from the service.
#[tauri::command]
pub async fn account_state(state: App<'_>) -> Result<serde_json::Value> {
    let account = state.store.read(|d| d.account.clone());
    crate::account::state(&account, shop_detour(&state)).await
}

#[tauri::command]
pub async fn account_quote(
    state: App<'_>,
    pack: String,
    promo: Option<String>,
) -> Result<serde_json::Value> {
    let account = state.store.read(|d| d.account.clone());
    crate::account::quote(&account, &pack, promo.as_deref(), shop_detour(&state)).await
}

/// Start a purchase. The answer carries the payment page for the browser.
///
/// Payment details are never entered here: the service hands back a URL and the
/// user completes the payment with their bank or wallet, as they would from the
/// Telegram mini app.
#[tauri::command]
pub async fn account_buy(
    state: App<'_>,
    pack: String,
    method: String,
    promo: Option<String>,
) -> Result<serde_json::Value> {
    let account = state.store.read(|d| d.account.clone());
    crate::account::buy(&account, &pack, &method, promo.as_deref(), shop_detour(&state)).await
}

#[tauri::command]
pub async fn account_check(
    state: App<'_>,
    order_id: serde_json::Value,
) -> Result<serde_json::Value> {
    let account = state.store.read(|d| d.account.clone());
    crate::account::check(&account, &order_id, shop_detour(&state)).await
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

/// Which node is actually carrying traffic right now.
///
/// Differs from the stored selection whenever the automatic selector is in
/// charge, so the UI can highlight the node the core really chose.
#[tauri::command]
pub async fn active_outbound_node(state: App<'_>) -> Result<Option<String>> {
    state.active_outbound_node().await
}

/// Reveal the folder holding the profile, the generated config and the logs.
#[tauri::command]
pub fn open_data_folder(state: App<'_>) -> Result<()> {
    let path = state.paths.data_dir.clone();
    tauri_plugin_opener::open_path(&path, None::<&str>)
        .map_err(|e| Error::Other(format!("cannot open {}: {e}", path.display())))
}

#[tauri::command]
pub fn get_logs(state: App<'_>) -> Vec<core::LogLine> {
    state.logs.snapshot()
}

#[tauri::command]
pub fn clear_logs(state: App<'_>) {
    state.logs.clear();
}

/// Render the config that the current settings would produce, for inspection.
#[tauri::command]
pub fn preview_config(state: App<'_>) -> Result<String> {
    let data = state.store.snapshot();
    let (config, _) = crate::singbox::generate(crate::singbox::GenerateArgs {
        nodes: &data.nodes,
        active_id: data.active_node_id.as_deref(),
        settings: &data.settings,
        paths: &crate::singbox::CorePaths {
            rule_sets_dir: "<rules>".into(),
            cache_file: "<cache>".into(),
        },
        clash_secret: "<secret>",
            probe_base: None,
    })?;
    Ok(serde_json::to_string_pretty(&config)?)
}

/// Confirm that traffic really is leaving through the tunnel.
///
/// Fetches an IP echo service through the local proxy, so a green connection
/// badge can be checked rather than trusted.
#[tauri::command]
pub async fn check_connectivity(state: App<'_>) -> Result<String> {
    if state.status().state != crate::model::ConnectionState::Connected {
        return Err(Error::CoreNotRunning);
    }

    let port = state.settings().inbound.socks_port;
    let client = reqwest::Client::builder()
        .proxy(
            reqwest::Proxy::all(format!("socks5h://127.0.0.1:{port}"))
                .map_err(|e| Error::Other(e.to_string()))?,
        )
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| Error::Other(e.to_string()))?;

    let text = client
        .get(format!(
            "https://{}/?format=text",
            crate::singbox::CONNECTIVITY_HOST
        ))
        .send()
        .await
        .map_err(|e| Error::Other(format!("the tunnel did not answer: {e}")))?
        .text()
        .await
        .map_err(|e| Error::Other(e.to_string()))?;

    Ok(text.trim().to_string())
}
