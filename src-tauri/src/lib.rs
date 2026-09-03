//! Vlyne — a sing-box based proxy client for Windows.

mod clash;
mod commands;
mod core;
mod elevation;
mod error;
mod link;
mod model;
mod singbox;
mod state;
mod store;
mod subs;
mod sysproxy;
mod tray;

use std::sync::Arc;

use tauri::{Emitter, Listener, Manager, WindowEvent};

use state::{event, AppState, Paths};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(windows)]
    {
        // Two instances would fight over the core, the config file and the
        // system proxy, so a second launch just reveals the first window.
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            tray::reveal_window(app);
        }));
        builder = builder
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_autostart::init(
                tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                Some(vec!["--minimized"]),
            ));
    }

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            commands::bootstrap,
            commands::get_status,
            commands::connect,
            commands::disconnect,
            commands::select_node,
            commands::select_auto,
            commands::test_latency,
            commands::import_links,
            commands::update_node,
            commands::delete_nodes,
            commands::export_node_link,
            commands::add_subscription,
            commands::refresh_subscription,
            commands::update_subscription,
            commands::delete_subscription,
            commands::save_settings,
            commands::set_mode,
            commands::restart_elevated,
            commands::active_outbound_node,
            commands::open_data_folder,
            commands::get_logs,
            commands::clear_logs,
            commands::preview_config,
            commands::check_connectivity,
        ])
        .setup(|app| {
            init_logging(app.handle());

            let paths = Paths::resolve(app.handle())?;
            let state = Arc::new(AppState::new(app.handle().clone(), paths));

            // Before anything else: if the last run died with the system proxy
            // engaged, the machine currently has no internet. Fix that first.
            state.recover_after_crash();

            app.manage(Arc::clone(&state));
            tray::build(app.handle())?;

            // Keep the tray menu in step with the connection state.
            let tray_handle = app.handle().clone();
            app.listen(event::STATUS, move |e| {
                if let Ok(status) = serde_json::from_str::<model::Status>(e.payload()) {
                    tray::sync_label(&tray_handle, status.state);
                }
            });

            let settings = state.settings();
            if settings.general.start_minimized || std::env::args().any(|a| a == "--minimized") {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }

            if settings.general.auto_connect {
                let state = Arc::clone(&state);
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = state.connect(None).await {
                        tracing::error!("auto-connect failed: {e}");
                        let _ = state.app.emit(event::STATUS, state.status());
                    }
                });
            }

            spawn_subscription_scheduler(Arc::clone(&state));

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                let close_to_tray = app
                    .try_state::<Arc<AppState>>()
                    .map(|s| s.settings().general.close_to_tray)
                    .unwrap_or(true);

                if close_to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                } else if let Some(state) = app.try_state::<Arc<AppState>>() {
                    // Closing for real: hand the system proxy back.
                    state.teardown_blocking();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("failed to start Vlyne")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit = event {
                if let Some(state) = app.try_state::<Arc<AppState>>() {
                    state.teardown_blocking();
                }
            }
        });
}

/// Refresh subscriptions whose interval has elapsed.
fn spawn_subscription_scheduler(state: Arc<AppState>) {
    tauri::async_runtime::spawn(async move {
        // A short initial delay keeps startup responsive.
        tokio::time::sleep(std::time::Duration::from_secs(20)).await;

        loop {
            let now = chrono::Utc::now().timestamp();
            let due: Vec<String> = state.store.read(|d| {
                d.subscriptions
                    .iter()
                    .filter(|s| s.enabled && s.update_interval_hours > 0)
                    .filter(|s| match s.last_updated_at {
                        Some(at) => now - at >= (s.update_interval_hours as i64) * 3600,
                        None => true,
                    })
                    .map(|s| s.id.clone())
                    .collect()
            });

            for id in due {
                if let Err(e) = refresh_one(&state, &id).await {
                    tracing::warn!("scheduled refresh of {id} failed: {e}");
                }
            }

            tokio::time::sleep(std::time::Duration::from_secs(900)).await;
        }
    });
}

async fn refresh_one(state: &Arc<AppState>, id: &str) -> error::Result<()> {
    let url = state
        .store
        .read(|d| d.subscriptions.iter().find(|s| s.id == id).map(|s| s.url.clone()))
        .ok_or_else(|| error::Error::Subscription("subscription vanished".into()))?;

    let connected = state.status().state == model::ConnectionState::Connected;
    let via_proxy = connected.then(|| state.settings().inbound.socks_port);
    let result = subs::fetch(&url, via_proxy).await?;
    let now = chrono::Utc::now().timestamp();

    state.store.write(|d| {
        let merged = subs::merge_refreshed(&d.nodes, result.nodes, id);
        let count = merged.len();
        d.nodes.retain(|n| n.subscription_id.as_deref() != Some(id));
        d.nodes.extend(merged);

        if let Some(s) = d.subscriptions.iter_mut().find(|s| s.id == id) {
            s.node_count = count;
            s.last_updated_at = Some(now);
            s.last_error = None;
        }
    })?;

    state.emit_data_changed();
    Ok(())
}

fn init_logging(app: &tauri::AppHandle) {
    use tracing_subscriber::{fmt, prelude::*, EnvFilter};

    let filter = EnvFilter::try_from_env("VLYNE_LOG").unwrap_or_else(|_| EnvFilter::new("info"));
    let registry = tracing_subscriber::registry().with(filter);

    // A file appender keeps diagnostics available for a bug report; failing to
    // open it must never stop the app from starting.
    match app.path().app_log_dir().and_then(|dir| {
        std::fs::create_dir_all(&dir)?;
        Ok(dir)
    }) {
        Ok(dir) => {
            let appender = tracing_appender::rolling::daily(dir, "vlyne.log");
            let _ = registry
                .with(fmt::layer().with_ansi(false).with_writer(appender))
                .try_init();
        }
        Err(_) => {
            let _ = registry.with(fmt::layer()).try_init();
        }
    }
}
