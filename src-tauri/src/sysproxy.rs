//! Windows system proxy control.
//!
//! Talks to the registry directly rather than shelling out to PowerShell, and —
//! critically — notifies WinInet afterwards. Without `INTERNET_OPTION_SETTINGS_CHANGED`
//! many applications keep using the previous settings until they restart, which
//! is why the old client appeared to "connect" while traffic went nowhere.

use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

#[cfg(windows)]
use windows_sys::Win32::Networking::WinInet::{
    InternetSetOptionW, INTERNET_OPTION_REFRESH, INTERNET_OPTION_SETTINGS_CHANGED,
};
#[cfg(windows)]
use windows_sys::Win32::System::Registry::{
    RegCloseKey, RegDeleteValueW, RegOpenKeyExW, RegQueryValueExW, RegSetValueExW, HKEY,
    HKEY_CURRENT_USER, KEY_READ, KEY_WRITE, REG_DWORD, REG_SZ,
};

const SUBKEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Internet Settings";

/// Hosts that must never go through the proxy. Keeping the loopback and the
/// private ranges out avoids breaking local development servers and LAN devices.
const DEFAULT_BYPASS: &str = "localhost;127.*;10.*;172.16.*;172.17.*;172.18.*;172.19.*;172.20.*;\
172.21.*;172.22.*;172.23.*;172.24.*;172.25.*;172.26.*;172.27.*;172.28.*;172.29.*;172.30.*;\
172.31.*;192.168.*;<local>";

/// The three registry values that make up the Windows proxy configuration.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct ProxyState {
    pub enable: u32,
    pub server: String,
    pub bypass: String,
}

fn wide(s: &str) -> Vec<u16> {
    OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
}

// ---------------------------------------------------------------------------
// Registry access
// ---------------------------------------------------------------------------

#[cfg(windows)]
struct RegKey(HKEY);

#[cfg(windows)]
impl Drop for RegKey {
    fn drop(&mut self) {
        unsafe { RegCloseKey(self.0) };
    }
}

#[cfg(windows)]
fn open(access: u32) -> Result<RegKey> {
    let mut key: HKEY = std::ptr::null_mut();
    let status = unsafe {
        RegOpenKeyExW(
            HKEY_CURRENT_USER,
            wide(SUBKEY).as_ptr(),
            0,
            access,
            &mut key,
        )
    };
    if status != 0 {
        return Err(Error::SystemProxy(format!(
            "cannot open Internet Settings (code {status})"
        )));
    }
    Ok(RegKey(key))
}

#[cfg(windows)]
fn read_dword(key: &RegKey, name: &str) -> Option<u32> {
    let mut data: u32 = 0;
    let mut size: u32 = std::mem::size_of::<u32>() as u32;
    let status = unsafe {
        RegQueryValueExW(
            key.0,
            wide(name).as_ptr(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut data as *mut u32 as *mut u8,
            &mut size,
        )
    };
    (status == 0).then_some(data)
}

#[cfg(windows)]
fn read_string(key: &RegKey, name: &str) -> Option<String> {
    let name_w = wide(name);
    let mut size: u32 = 0;

    // First call sizes the buffer; a missing value fails here and yields None.
    let status = unsafe {
        RegQueryValueExW(
            key.0,
            name_w.as_ptr(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut size,
        )
    };
    if status != 0 || size == 0 {
        return None;
    }

    let mut buf = vec![0u16; (size as usize + 1) / 2];
    let status = unsafe {
        RegQueryValueExW(
            key.0,
            name_w.as_ptr(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            buf.as_mut_ptr() as *mut u8,
            &mut size,
        )
    };
    if status != 0 {
        return None;
    }

    let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    Some(String::from_utf16_lossy(&buf[..end]))
}

#[cfg(windows)]
fn write_dword(key: &RegKey, name: &str, value: u32) -> Result<()> {
    let status = unsafe {
        RegSetValueExW(
            key.0,
            wide(name).as_ptr(),
            0,
            REG_DWORD,
            &value as *const u32 as *const u8,
            std::mem::size_of::<u32>() as u32,
        )
    };
    if status != 0 {
        return Err(Error::SystemProxy(format!(
            "cannot write {name} (code {status})"
        )));
    }
    Ok(())
}

#[cfg(windows)]
fn write_string(key: &RegKey, name: &str, value: &str) -> Result<()> {
    let data = wide(value);
    let status = unsafe {
        RegSetValueExW(
            key.0,
            wide(name).as_ptr(),
            0,
            REG_SZ,
            data.as_ptr() as *const u8,
            (data.len() * 2) as u32,
        )
    };
    if status != 0 {
        return Err(Error::SystemProxy(format!(
            "cannot write {name} (code {status})"
        )));
    }
    Ok(())
}

#[cfg(windows)]
fn delete_value(key: &RegKey, name: &str) {
    // A missing value is the desired end state, so failure is not an error.
    unsafe { RegDeleteValueW(key.0, wide(name).as_ptr()) };
}

/// Tell WinInet — and through it every application that asks Windows for proxy
/// settings — that the configuration changed.
#[cfg(windows)]
fn notify_changed() {
    unsafe {
        InternetSetOptionW(
            std::ptr::null_mut(),
            INTERNET_OPTION_SETTINGS_CHANGED,
            std::ptr::null_mut(),
            0,
        );
        InternetSetOptionW(
            std::ptr::null_mut(),
            INTERNET_OPTION_REFRESH,
            std::ptr::null_mut(),
            0,
        );
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

#[cfg(windows)]
pub fn read_state() -> Result<ProxyState> {
    let key = open(KEY_READ)?;
    Ok(ProxyState {
        enable: read_dword(&key, "ProxyEnable").unwrap_or(0),
        server: read_string(&key, "ProxyServer").unwrap_or_default(),
        bypass: read_string(&key, "ProxyOverride").unwrap_or_default(),
    })
}

#[cfg(windows)]
pub fn apply_state(state: &ProxyState) -> Result<()> {
    {
        let key = open(KEY_WRITE)?;
        write_dword(&key, "ProxyEnable", state.enable)?;

        if state.server.is_empty() {
            delete_value(&key, "ProxyServer");
        } else {
            write_string(&key, "ProxyServer", &state.server)?;
        }

        if state.bypass.is_empty() {
            delete_value(&key, "ProxyOverride");
        } else {
            write_string(&key, "ProxyOverride", &state.bypass)?;
        }
    }
    notify_changed();
    Ok(())
}

#[cfg(not(windows))]
pub fn read_state() -> Result<ProxyState> {
    Ok(ProxyState::default())
}

#[cfg(not(windows))]
pub fn apply_state(_state: &ProxyState) -> Result<()> {
    Ok(())
}

/// Owns the system proxy for the lifetime of a connection.
///
/// The pre-existing state is written to disk before anything is changed, so a
/// crash or a power cut cannot strand the machine behind a dead proxy: the next
/// launch restores it from the backup file.
pub struct SystemProxyGuard {
    backup_path: PathBuf,
    active: bool,
}

impl SystemProxyGuard {
    pub fn new(backup_path: impl AsRef<Path>) -> Self {
        Self {
            backup_path: backup_path.as_ref().to_path_buf(),
            active: false,
        }
    }

    pub fn is_active(&self) -> bool {
        self.active
    }

    /// Point the system proxy at `127.0.0.1:port`.
    pub fn engage(&mut self, port: u16) -> Result<()> {
        if !self.active {
            let current = read_state()?;
            // Only snapshot a state we did not create ourselves.
            if !current.server.starts_with("127.0.0.1:") {
                let json = serde_json::to_string(&current)?;
                if let Some(parent) = self.backup_path.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                std::fs::write(&self.backup_path, json)?;
            }
        }

        apply_state(&ProxyState {
            enable: 1,
            server: format!("127.0.0.1:{port}"),
            bypass: DEFAULT_BYPASS.to_string(),
        })?;
        self.active = true;
        Ok(())
    }

    /// Put back whatever was configured before `engage`.
    pub fn release(&mut self) -> Result<()> {
        let restored = match std::fs::read_to_string(&self.backup_path) {
            Ok(raw) => serde_json::from_str::<ProxyState>(&raw).unwrap_or_default(),
            // No backup means there was nothing to preserve: switch the proxy off.
            Err(_) => ProxyState::default(),
        };

        apply_state(&restored)?;
        let _ = std::fs::remove_file(&self.backup_path);
        self.active = false;
        Ok(())
    }

    /// Called at startup: if a backup survived the last run, the previous
    /// process died with the proxy still engaged. Undo it.
    pub fn recover(&mut self) -> Result<bool> {
        if !self.backup_path.exists() {
            return Ok(false);
        }
        self.release()?;
        Ok(true)
    }
}

impl Drop for SystemProxyGuard {
    fn drop(&mut self) {
        if self.active {
            let _ = self.release();
        }
    }
}
