//! Administrator rights, needed only for TUN mode.
//!
//! The app relaunches itself elevated rather than spawning an elevated child.
//! `ShellExecute` with the `runas` verb cannot redirect stdio, so an elevated
//! child would cost us the core's log output and reliable process supervision.
//! Elevating the whole app keeps one UAC prompt per launch and keeps the
//! supervisor intact.

use crate::error::{Error, Result};

#[cfg(windows)]
pub fn is_elevated() -> bool {
    use std::mem::size_of;
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::Security::{
        GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY,
    };
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    unsafe {
        let mut token = std::ptr::null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            return false;
        }

        let mut elevation = TOKEN_ELEVATION { TokenIsElevated: 0 };
        let mut size = size_of::<TOKEN_ELEVATION>() as u32;
        let ok = GetTokenInformation(
            token,
            TokenElevation,
            &mut elevation as *mut _ as *mut _,
            size,
            &mut size,
        );
        CloseHandle(token);

        ok != 0 && elevation.TokenIsElevated != 0
    }
}

#[cfg(not(windows))]
pub fn is_elevated() -> bool {
    false
}

/// Relaunch this executable with an elevation prompt.
///
/// On success the caller must exit: two instances would fight over the same
/// core, config and system proxy.
#[cfg(windows)]
pub fn relaunch_elevated() -> Result<()> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let exe = std::env::current_exe()?;
    let wide = |s: &OsStr| -> Vec<u16> {
        s.encode_wide().chain(std::iter::once(0)).collect::<Vec<_>>()
    };

    let verb = wide(OsStr::new("runas"));
    let file = wide(exe.as_os_str());
    let dir = exe
        .parent()
        .map(|p| wide(p.as_os_str()))
        .unwrap_or_else(|| vec![0]);

    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            verb.as_ptr(),
            file.as_ptr(),
            std::ptr::null(),
            dir.as_ptr(),
            SW_SHOWNORMAL as i32,
        )
    };

    // ShellExecuteW returns a fake HINSTANCE; anything above 32 means success.
    // The common failure is the user dismissing the UAC prompt.
    if result as isize <= 32 {
        return Err(Error::Other(
            "the elevation prompt was dismissed".to_string(),
        ));
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn relaunch_elevated() -> Result<()> {
    Err(Error::Other("elevation is only implemented on Windows".into()))
}
