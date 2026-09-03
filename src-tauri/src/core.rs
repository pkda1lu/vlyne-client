//! Supervision of the sing-box process.
//!
//! The ordering here is the fix for the old client's worst bug. Previously the
//! system proxy was pointed at the core the instant the process was spawned; if
//! the config was bad the core died milliseconds later and the machine was left
//! with a proxy aimed at a closed port — no internet at all, with the UI still
//! showing "connected".
//!
//! Now the sequence is: validate the config, start the core, wait for it to
//! actually answer on its control port, and only then touch the system proxy.
//! Anything that goes wrong short of that leaves the network untouched.

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::mpsc;

use crate::error::{Error, Result};

/// Windows: keep the console window of the child process hidden.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// How long the core gets to answer on its control port before we give up.
const READY_TIMEOUT: Duration = Duration::from_secs(12);
const READY_POLL: Duration = Duration::from_millis(150);

/// Number of log lines kept in memory for the UI's log pane.
const LOG_BUFFER: usize = 400;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogLine {
    pub at: i64,
    pub text: String,
}

/// Rolling in-memory log shared with the UI.
#[derive(Default)]
pub struct LogBuffer(Mutex<VecDeque<LogLine>>);

impl LogBuffer {
    pub fn push(&self, text: String) {
        let mut buf = self.0.lock();
        if buf.len() == LOG_BUFFER {
            buf.pop_front();
        }
        buf.push_back(LogLine {
            at: chrono::Utc::now().timestamp_millis(),
            text,
        });
    }

    pub fn snapshot(&self) -> Vec<LogLine> {
        self.0.lock().iter().cloned().collect()
    }

    pub fn clear(&self) {
        self.0.lock().clear();
    }

    /// The last few lines, used to explain a startup failure to the user.
    fn tail(&self, n: usize) -> String {
        let buf = self.0.lock();
        buf.iter()
            .rev()
            .take(n)
            .map(|l| l.text.clone())
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join("\n")
    }
}

/// The core ended on its own — a crash, an outside kill, or a fatal runtime
/// error. A requested stop never travels this channel; the caller knows.
#[derive(Debug, Clone)]
pub struct UnexpectedExit {
    pub code: Option<i32>,
}

/// Refuse to start when a port the core needs is already taken.
///
/// Without this the core would fail deep inside its own startup with a message
/// the user cannot act on; here it becomes "port 10809 is already in use".
pub fn ensure_ports_free(ports: &[u16]) -> Result<()> {
    for &port in ports {
        if std::net::TcpListener::bind(("127.0.0.1", port)).is_err() {
            return Err(Error::PortInUse(port));
        }
    }
    Ok(())
}

pub struct CoreProcess {
    child: Child,
    config_path: PathBuf,
}

pub struct CoreHandle {
    process: Option<CoreProcess>,
    pub logs: Arc<LogBuffer>,
}

/// Locate the bundled sing-box binary.
pub fn core_binary(resource_dir: &Path) -> Result<PathBuf> {
    let candidate = resource_dir.join("core").join(if cfg!(windows) {
        "sing-box.exe"
    } else {
        "sing-box"
    });
    if !candidate.exists() {
        return Err(Error::CoreMissing(candidate.display().to_string()));
    }
    Ok(candidate)
}

fn command(binary: &Path) -> Command {
    let mut cmd = Command::new(binary);
    // sing-box resolves relative resource paths against its working directory.
    if let Some(dir) = binary.parent() {
        cmd.current_dir(dir);
    }
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

/// Ask sing-box to validate a config file. Returns its complaint on failure.
///
/// This runs before every start, so a malformed node produces a readable error
/// instead of a dead tunnel.
pub async fn check_config(binary: &Path, config_path: &Path) -> Result<()> {
    let output = command(binary)
        .arg("check")
        .arg("-c")
        .arg(config_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| Error::CoreStartFailed(format!("cannot run the core: {e}")))?;

    if output.status.success() {
        return Ok(());
    }

    let mut detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if detail.is_empty() {
        detail = String::from_utf8_lossy(&output.stdout).trim().to_string();
    }
    Err(Error::CoreStartFailed(if detail.is_empty() {
        "the core rejected the configuration".into()
    } else {
        detail
    }))
}

/// Report the bundled core's version string.
pub async fn core_version(binary: &Path) -> Result<String> {
    let output = command(binary)
        .arg("version")
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .await
        .map_err(|e| Error::CoreMissing(e.to_string()))?;

    let text = String::from_utf8_lossy(&output.stdout);
    Ok(text
        .lines()
        .next()
        .unwrap_or_default()
        .trim()
        .replace("sing-box version ", ""))
}

impl CoreHandle {
    pub fn new(logs: Arc<LogBuffer>) -> Self {
        Self {
            process: None,
            logs,
        }
    }

    pub fn is_running(&self) -> bool {
        self.process.is_some()
    }

    /// Write the config, validate it, start the core and wait until its control
    /// port answers.
    ///
    /// `on_exit` fires exactly once if the process ends while it was supposed to
    /// be running, so the caller can tear the system proxy back down.
    pub async fn start(
        &mut self,
        binary: &Path,
        config: &Value,
        config_path: &Path,
        clash_addr: &str,
        clash_secret: &str,
        on_exit: mpsc::UnboundedSender<UnexpectedExit>,
    ) -> Result<()> {
        if self.process.is_some() {
            return Err(Error::Other("the core is already running".into()));
        }

        if let Some(parent) = config_path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        tokio::fs::write(config_path, serde_json::to_vec_pretty(config)?).await?;

        // Catch bad configs here, while the network is still untouched.
        check_config(binary, config_path).await?;

        self.logs.clear();
        let mut child = command(binary)
            .arg("run")
            .arg("-c")
            .arg(config_path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| Error::CoreStartFailed(e.to_string()))?;

        // sing-box logs to stderr; stdout is drained too so the pipe never fills.
        if let Some(stdout) = child.stdout.take() {
            spawn_log_pump(stdout, Arc::clone(&self.logs));
        }
        if let Some(stderr) = child.stderr.take() {
            spawn_log_pump(stderr, Arc::clone(&self.logs));
        }

        match wait_until_ready(&mut child, clash_addr, clash_secret).await {
            Ok(()) => {}
            Err(e) => {
                // Never leave a half-started core behind.
                let _ = child.kill().await;
                let detail = self.logs.tail(6);
                return Err(match e {
                    Error::CoreStartFailed(msg) if !detail.is_empty() => {
                        Error::CoreStartFailed(format!("{msg}\n{detail}"))
                    }
                    other => other,
                });
            }
        }

        spawn_exit_watcher(&mut child, on_exit);

        self.process = Some(CoreProcess {
            child,
            config_path: config_path.to_path_buf(),
        });
        Ok(())
    }

    /// Stop the core. Safe to call when it is not running.
    pub async fn stop(&mut self) -> Result<()> {
        let Some(mut process) = self.process.take() else {
            return Ok(());
        };

        // On Windows the core may have spawned helpers for the TUN adapter, so
        // kill the whole tree rather than just the parent.
        #[cfg(windows)]
        if let Some(pid) = process.child.id() {
            let _ = Command::new("taskkill")
                .args(["/PID", &pid.to_string(), "/T", "/F"])
                .creation_flags(CREATE_NO_WINDOW)
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .await;
        }

        let _ = process.child.kill().await;
        let _ = process.child.wait().await;
        let _ = tokio::fs::remove_file(&process.config_path).await;
        Ok(())
    }
}

fn spawn_log_pump<R>(reader: R, logs: Arc<LogBuffer>)
where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            logs.push(line);
        }
    });
}

fn spawn_exit_watcher(child: &mut Child, on_exit: mpsc::UnboundedSender<UnexpectedExit>) {
    // `Child::wait` would need ownership of the handle, which `CoreHandle` keeps
    // so it can kill the process later. So the watcher opens its own OS handle
    // once and polls that.
    let Some(pid) = child.id() else { return };
    let Some(watch) = ProcessWatch::open(pid) else {
        return;
    };

    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_millis(500)).await;
            if let Some(code) = watch.exit_code() {
                let _ = on_exit.send(UnexpectedExit { code });
                return;
            }
        }
    });
}

/// A handle to the core process that outlives its pid.
///
/// Holding the handle open keeps Windows from recycling the pid, so the watcher
/// can never mistake an unrelated new process for a core that is still running.
#[cfg(windows)]
struct ProcessWatch(windows_sys::Win32::Foundation::HANDLE);

#[cfg(windows)]
unsafe impl Send for ProcessWatch {}

#[cfg(windows)]
impl ProcessWatch {
    fn open(pid: u32) -> Option<Self> {
        use windows_sys::Win32::System::Threading::{
            OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
        };

        let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        (!handle.is_null()).then_some(Self(handle))
    }

    /// `None` while the process runs; `Some(code)` once it has exited.
    fn exit_code(&self) -> Option<Option<i32>> {
        use windows_sys::Win32::Foundation::STILL_ACTIVE;
        use windows_sys::Win32::System::Threading::GetExitCodeProcess;

        let mut code: u32 = 0;
        let ok = unsafe { GetExitCodeProcess(self.0, &mut code) };

        // A failed query means the handle is unusable; treat that as gone
        // rather than hanging on to a watcher that can never fire.
        if ok == 0 {
            return Some(None);
        }
        if code == STILL_ACTIVE as u32 {
            return None;
        }
        Some(Some(code as i32))
    }
}

#[cfg(windows)]
impl Drop for ProcessWatch {
    fn drop(&mut self) {
        unsafe { windows_sys::Win32::Foundation::CloseHandle(self.0) };
    }
}

#[cfg(not(windows))]
struct ProcessWatch;

#[cfg(not(windows))]
impl ProcessWatch {
    fn open(_pid: u32) -> Option<Self> {
        None
    }

    fn exit_code(&self) -> Option<Option<i32>> {
        None
    }
}

/// Poll the Clash control port until the core answers, the process dies, or the
/// timeout expires.
async fn wait_until_ready(child: &mut Child, clash_addr: &str, secret: &str) -> Result<()> {
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_millis(800))
        .build()
        .map_err(|e| Error::CoreStartFailed(e.to_string()))?;
    let url = format!("http://{clash_addr}/version");
    let deadline = tokio::time::Instant::now() + READY_TIMEOUT;

    loop {
        // A core that exited already will never become ready.
        if let Ok(Some(status)) = child.try_wait() {
            return Err(Error::CoreStartFailed(format!(
                "the core exited immediately (code {})",
                status.code().unwrap_or(-1)
            )));
        }

        if client
            .get(&url)
            .bearer_auth(secret)
            .send()
            .await
            .map(|r| r.status().is_success())
            .unwrap_or(false)
        {
            return Ok(());
        }

        if tokio::time::Instant::now() >= deadline {
            return Err(Error::CoreStartFailed(
                "the core did not become ready in time".into(),
            ));
        }
        tokio::time::sleep(READY_POLL).await;
    }
}
