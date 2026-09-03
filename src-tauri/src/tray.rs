//! System tray icon and menu.

use std::sync::Arc;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Runtime};

use crate::model::ConnectionState;
use crate::state::AppState;

const ID_SHOW: &str = "show";
const ID_TOGGLE: &str = "toggle";
const ID_QUIT: &str = "quit";

fn toggle_label(state: ConnectionState) -> &'static str {
    match state {
        ConnectionState::Connected => "Отключить",
        ConnectionState::Connecting => "Подключение…",
        ConnectionState::Stopping => "Отключение…",
        _ => "Подключить",
    }
}

fn build_menu<R: Runtime>(app: &AppHandle<R>, state: ConnectionState) -> tauri::Result<Menu<R>> {
    let show = MenuItem::with_id(app, ID_SHOW, "Открыть Vlyne", true, None::<&str>)?;
    let toggle = MenuItem::with_id(app, ID_TOGGLE, toggle_label(state), true, None::<&str>)?;
    let quit = MenuItem::with_id(app, ID_QUIT, "Выход", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;

    Menu::with_items(app, &[&show, &toggle, &separator, &quit])
}

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let menu = build_menu(app, ConnectionState::Disconnected)?;

    TrayIconBuilder::with_id("main")
        .icon(
            app.default_window_icon()
                .cloned()
                .ok_or_else(|| tauri::Error::AssetNotFound("the window icon is missing".into()))?,
        )
        .tooltip("Vlyne")
        .menu(&menu)
        // The menu belongs on right-click; a left-click should just open the app.
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            ID_SHOW => reveal_window(app),
            ID_TOGGLE => toggle_connection(app),
            ID_QUIT => quit_app(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                reveal_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

pub fn reveal_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn toggle_connection<R: Runtime>(app: &AppHandle<R>) {
    let Some(state) = app.try_state::<Arc<AppState>>() else {
        return;
    };
    let state = Arc::clone(&state);

    tauri::async_runtime::spawn(async move {
        let result = match state.status().state {
            ConnectionState::Connected | ConnectionState::Connecting => state.disconnect().await,
            _ => state.connect(None).await,
        };
        if let Err(e) = result {
            tracing::error!("tray toggle failed: {e}");
        }
    });
}

fn quit_app<R: Runtime>(app: &AppHandle<R>) {
    if let Some(state) = app.try_state::<Arc<AppState>>() {
        // Restore the system proxy before the process goes away: this is the
        // last chance to avoid stranding the machine behind a dead proxy.
        state.teardown_blocking();
    }
    app.exit(0);
}

/// Keep the tray menu in step with the connection state.
///
/// `TrayIcon` does not hand its menu back, so the menu is rebuilt and swapped
/// in. The click handler lives on the icon rather than the menu, so it survives.
pub fn sync_label<R: Runtime>(app: &AppHandle<R>, state: ConnectionState) {
    let Some(tray) = app.tray_by_id("main") else {
        return;
    };
    if let Ok(menu) = build_menu(app, state) {
        let _ = tray.set_menu(Some(menu));
    }
}
