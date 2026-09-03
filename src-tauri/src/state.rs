//! Application state and the connection lifecycle.

use std::path::PathBuf;
use std::sync::Arc;

use parking_lot::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{mpsc, Mutex as AsyncMutex};

use crate::clash::{ClashClient, TrafficSample};
use crate::core::{self, CoreHandle, LogBuffer, UnexpectedExit};
use crate::error::{Error, Result};
use crate::model::{ConnectionState, Node, Settings, Status, Traffic, TunnelMode};
use crate::singbox::{self, CorePaths, GenerateArgs, TagMap, TAG_AUTO, TAG_PROXY};
use crate::store::Store;
use crate::sysproxy::SystemProxyGuard;

/// Events pushed to the UI. Kept as constants so the two sides cannot drift.
pub mod event {
    pub const STATUS: &str = "vlyne://status";
    pub const TRAFFIC: &str = "vlyne://traffic";
    pub const LOG: &str = "vlyne://log";
    pub const DATA: &str = "vlyne://data";
    pub const LATENCY: &str = "vlyne://latency";
}

/// Filesystem layout resolved once at startup.
pub struct Paths {
    pub data_dir: PathBuf,
    pub resource_dir: PathBuf,
    pub config_file: PathBuf,
    pub profile_file: PathBuf,
    pub proxy_backup: PathBuf,
    pub cache_file: PathBuf,
    pub rule_sets_dir: PathBuf,
}

impl Paths {
    pub fn resolve(app: &AppHandle) -> Result<Self> {
        let data_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| Error::Other(format!("no application data directory: {e}")))?;
        let resource_dir = app
            .path()
            .resource_dir()
            .map_err(|e| Error::Other(format!("no resource directory: {e}")))?;

        std::fs::create_dir_all(&data_dir)?;

        Ok(Self {
            config_file: data_dir.join("sing-box.json"),
            profile_file: data_dir.join("profile.json"),
            proxy_backup: data_dir.join("proxy-backup.json"),
            cache_file: data_dir.join("cache.db"),
            rule_sets_dir: resource_dir.join("core").join("rules"),
            data_dir,
            resource_dir,
        })
    }

    fn core_paths(&self) -> CorePaths {
        CorePaths {
            // sing-box reads these from JSON, where a backslash would need
            // escaping; forward slashes work on Windows and avoid the issue.
            rule_sets_dir: self.rule_sets_dir.display().to_string().replace('\\', "/"),
            cache_file: self.cache_file.display().to_string().replace('\\', "/"),
        }
    }
}

/// The pieces that only exist while a connection is up.
struct Session {
    clash: ClashClient,
    tags: TagMap,
    /// Base port of the probe lanes, when the core was given a free range.
    probe_base: Option<u16>,
    /// Dropping this stops the traffic stream task.
    _traffic_stop: mpsc::UnboundedSender<()>,
}

pub struct AppState {
    pub app: AppHandle,
    pub paths: Paths,
    pub store: Store,
    pub logs: Arc<LogBuffer>,

    core: AsyncMutex<CoreHandle>,
    proxy: Mutex<SystemProxyGuard>,
    status: Mutex<Status>,
    traffic: Mutex<Traffic>,
    session: Mutex<Option<Session>>,
    clash_secret: Mutex<String>,
    /// Serialises connect/disconnect so two clicks cannot interleave.
    transition: AsyncMutex<()>,
}

impl AppState {
    pub fn new(app: AppHandle, paths: Paths) -> Self {
        let logs = Arc::new(LogBuffer::default());
        let store = Store::load(&paths.profile_file);

        let mut status = Status::default();
        status.mode = store.read(|d| d.settings.mode.0);
        status.elevated = crate::elevation::is_elevated();

        Self {
            core: AsyncMutex::new(CoreHandle::new(Arc::clone(&logs))),
            proxy: Mutex::new(SystemProxyGuard::new(&paths.proxy_backup)),
            status: Mutex::new(status),
            traffic: Mutex::new(Traffic::default()),
            session: Mutex::new(None),
            clash_secret: Mutex::new(String::new()),
            transition: AsyncMutex::new(()),
            logs,
            store,
            paths,
            app,
        }
    }

    // -----------------------------------------------------------------------
    // Status plumbing
    // -----------------------------------------------------------------------

    pub fn status(&self) -> Status {
        self.status.lock().clone()
    }

    pub fn traffic(&self) -> Traffic {
        *self.traffic.lock()
    }

    fn set_status(&self, f: impl FnOnce(&mut Status)) {
        let snapshot = {
            let mut status = self.status.lock();
            f(&mut status);
            status.clone()
        };
        let _ = self.app.emit(event::STATUS, &snapshot);
    }

    pub fn emit_data_changed(&self) {
        let _ = self.app.emit(event::DATA, self.store.snapshot());
    }

    pub fn settings(&self) -> Settings {
        self.store.read(|d| d.settings.clone())
    }

    fn nodes(&self) -> Vec<Node> {
        self.store.read(|d| d.nodes.clone())
    }

    // -----------------------------------------------------------------------
    // Startup
    // -----------------------------------------------------------------------

    /// Undo a system proxy left behind by a previous run that died badly.
    pub fn recover_after_crash(&self) {
        match self.proxy.lock().recover() {
            Ok(true) => tracing::warn!("restored a system proxy left over from a previous run"),
            Ok(false) => {}
            Err(e) => tracing::error!("could not restore the system proxy: {e}"),
        }
    }

    pub fn core_binary(&self) -> Result<PathBuf> {
        core::core_binary(&self.paths.resource_dir)
    }

    // -----------------------------------------------------------------------
    // Connection lifecycle
    // -----------------------------------------------------------------------

    /// Bring the tunnel up on `node_id`, or on the stored active node.
    pub async fn connect(self: &Arc<Self>, node_id: Option<String>) -> Result<()> {
        let _guard = self.transition.lock().await;

        if self.core.lock().await.is_running() {
            return Ok(());
        }

        let settings = self.settings();
        let nodes = self.nodes();
        if nodes.is_empty() {
            return Err(Error::NoNode);
        }

        let active_id = node_id
            .or_else(|| self.store.read(|d| d.active_node_id.clone()))
            .filter(|id| nodes.iter().any(|n| &n.id == id));

        // A node the core cannot dial has to be reported now; it would
        // otherwise silently disappear from the generated config.
        if let Some(id) = &active_id {
            let node = nodes
                .iter()
                .find(|n| &n.id == id)
                .ok_or_else(|| Error::NodeNotFound(id.clone()))?;
            if let Some(reason) = node.unsupported_reason() {
                return Err(Error::UnsupportedNode(reason.to_string()));
            }
        }

        if settings.mode.0 == TunnelMode::Tun && !crate::elevation::is_elevated() {
            return Err(Error::ElevationRequired);
        }

        let active_node = active_id
            .as_ref()
            .and_then(|id| nodes.iter().find(|n| &n.id == id));
        self.set_status(|s| {
            s.state = ConnectionState::Connecting;
            s.mode = settings.mode.0;
            s.error = None;
            s.node_id = active_id.clone();
            s.node_name = active_node.map(|n| n.name.clone());
        });

        match self.start_core(&settings, &nodes, active_id.as_deref()).await {
            Ok(()) => Ok(()),
            Err(e) => {
                // Nothing was changed on the system, so a failure here is inert.
                self.set_status(|s| {
                    s.state = ConnectionState::Failed;
                    s.error = Some(e.to_string());
                    s.connected_since = None;
                });
                Err(e)
            }
        }
    }

    async fn start_core(
        self: &Arc<Self>,
        settings: &Settings,
        nodes: &[Node],
        active_id: Option<&str>,
    ) -> Result<()> {
        let binary = self.core_binary()?;

        // Better to say "port 10809 is in use" than to let the core fail with
        // a message buried in its own startup log.
        let mut ports = vec![settings.inbound.socks_port, settings.inbound.clash_port];
        if settings.inbound.http_port != settings.inbound.socks_port {
            ports.push(settings.inbound.http_port);
        }
        core::ensure_ports_free(&ports)?;

        let secret = random_secret();
        let clash_addr = format!("127.0.0.1:{}", settings.inbound.clash_port);

        // Latency measurement is a convenience; a busy port range must never be
        // the reason the tunnel refuses to come up, so the lanes are simply
        // left out when no free run of ports can be found.
        let probe_base = singbox::find_probe_base(settings.inbound.probe_port);
        if probe_base.is_none() {
            tracing::warn!("no free port range for latency probes; falling back to TCP checks");
        }

        let (config, tags) = singbox::generate(GenerateArgs {
            nodes,
            active_id,
            settings,
            paths: &self.paths.core_paths(),
            clash_secret: &secret,
            probe_base,
        })?;

        let (exit_tx, mut exit_rx) = mpsc::unbounded_channel();

        self.core
            .lock()
            .await
            .start(
                &binary,
                &config,
                &self.paths.config_file,
                &clash_addr,
                &secret,
                exit_tx,
            )
            .await?;

        // From here on the core is confirmed listening, so it is finally safe
        // to redirect the machine's traffic at it.
        if settings.mode.0 == TunnelMode::SystemProxy {
            // Bind the guard's lifetime to this statement so no `parking_lot`
            // guard is alive across the awaits below.
            let engaged = self.proxy.lock().engage(settings.inbound.http_port);
            if let Err(e) = engaged {
                let _ = self.core.lock().await.stop().await;
                return Err(e);
            }
        }

        *self.clash_secret.lock() = secret.clone();
        let clash = ClashClient::new(&clash_addr, &secret)?;
        let (stop_tx, stop_rx) = mpsc::unbounded_channel();
        self.spawn_traffic_stream(clash.clone(), stop_rx);

        *self.session.lock() = Some(Session {
            clash,
            tags,
            probe_base,
            _traffic_stop: stop_tx,
        });

        *self.traffic.lock() = Traffic::default();
        self.set_status(|s| {
            s.state = ConnectionState::Connected;
            s.connected_since = Some(chrono::Utc::now().timestamp());
            s.system_proxy_active = settings.mode.0 == TunnelMode::SystemProxy;
            s.error = None;
        });

        // React to the core dying underneath us.
        let this = Arc::clone(self);
        tokio::spawn(async move {
            if let Some(UnexpectedExit { code }) = exit_rx.recv().await {
                this.handle_core_death(code).await;
            }
        });

        self.spawn_log_forwarder();
        Ok(())
    }

    /// The core stopped without being asked to. Undo everything it was granted.
    async fn handle_core_death(self: &Arc<Self>, code: Option<i32>) {
        // A user-initiated stop clears the session first, so an empty session
        // means this exit was already accounted for.
        if self.session.lock().is_none() {
            return;
        }

        tracing::error!("the core exited unexpectedly (code {code:?})");
        self.teardown().await;

        let detail = self
            .logs
            .snapshot()
            .last()
            .map(|l| l.text.clone())
            .unwrap_or_default();

        self.set_status(|s| {
            s.state = ConnectionState::Failed;
            s.connected_since = None;
            s.system_proxy_active = false;
            s.error = Some(if detail.is_empty() {
                "the core stopped unexpectedly".into()
            } else {
                detail
            });
        });
    }

    /// Release the system proxy and stop the core, in that order.
    ///
    /// The proxy goes first so that a core that refuses to die cannot leave the
    /// machine pointed at a port nothing is listening on.
    async fn teardown(&self) {
        // The synchronous locks are confined to a helper: holding a
        // `parking_lot` guard across an await would make this future `!Send`.
        self.release_proxy_and_session();

        if let Err(e) = self.core.lock().await.stop().await {
            tracing::error!("could not stop the core: {e}");
        }
    }

    fn release_proxy_and_session(&self) {
        *self.session.lock() = None;

        let mut proxy = self.proxy.lock();
        if proxy.is_active() {
            if let Err(e) = proxy.release() {
                tracing::error!("could not restore the system proxy: {e}");
            }
        }
    }

    pub async fn disconnect(&self) -> Result<()> {
        let _guard = self.transition.lock().await;

        self.set_status(|s| s.state = ConnectionState::Stopping);
        self.teardown().await;
        self.set_status(|s| {
            s.state = ConnectionState::Disconnected;
            s.connected_since = None;
            s.system_proxy_active = false;
            s.error = None;
        });
        Ok(())
    }

    /// Blocking teardown for the exit path, where no async runtime is available.
    pub fn teardown_blocking(&self) {
        let mut proxy = self.proxy.lock();
        if proxy.is_active() {
            let _ = proxy.release();
        }
    }

    // -----------------------------------------------------------------------
    // Node selection
    // -----------------------------------------------------------------------

    /// Switch the active node. While connected this is a selector call, so the
    /// tunnel never drops and existing connections migrate.
    pub async fn select_node(self: &Arc<Self>, node_id: &str) -> Result<()> {
        let exists = self.store.read(|d| d.nodes.iter().any(|n| n.id == node_id));
        if !exists {
            return Err(Error::NodeNotFound(node_id.to_string()));
        }

        self.store.write(|d| d.active_node_id = Some(node_id.to_string()))?;

        let session = {
            let session = self.session.lock();
            session.as_ref().map(|s| {
                (
                    s.clash.clone(),
                    s.tags.tag_of(node_id).map(str::to_string),
                )
            })
        };

        match session {
            // The usual case: the node is already an outbound, so switching is
            // one call and open connections migrate to it.
            Some((clash, Some(tag))) => clash.select(TAG_PROXY, &tag).await?,

            // The node was added after the core started, so it is absent from
            // the running configuration. Picking it has to take effect now,
            // not at some later reconnect, or the tunnel would quietly carry
            // on using the previous server.
            Some((_, None)) => {
                tracing::info!("reloading the core to reach a newly added server");
                self.disconnect().await?;
                self.connect(Some(node_id.to_string())).await?;
                return Ok(());
            }

            None => {}
        }

        let name = self.store.read(|d| {
            d.nodes
                .iter()
                .find(|n| n.id == node_id)
                .map(|n| n.name.clone())
        });
        self.set_status(|s| {
            s.node_id = Some(node_id.to_string());
            s.node_name = name;
        });
        self.emit_data_changed();
        Ok(())
    }

    /// Hand node choice to the core's latency-based selector.
    pub async fn select_auto(&self) -> Result<()> {
        let clash = self.session.lock().as_ref().map(|s| s.clash.clone());
        let Some(clash) = clash else {
            return Err(Error::CoreNotRunning);
        };

        clash.select(TAG_PROXY, TAG_AUTO).await?;
        self.store.write(|d| d.active_node_id = None)?;
        self.set_status(|s| {
            s.node_id = None;
            s.node_name = None;
        });
        self.emit_data_changed();
        Ok(())
    }

    /// Which node the core is currently sending traffic through.
    ///
    /// In automatic mode the selector picks a node on its own, so this is the
    /// only way for the UI to show what is actually carrying traffic.
    pub async fn active_outbound_node(&self) -> Result<Option<String>> {
        let session = self
            .session
            .lock()
            .as_ref()
            .map(|s| (s.clash.clone(), s.tags.clone()));
        let Some((clash, tags)) = session else {
            return Err(Error::CoreNotRunning);
        };

        let tag = clash.current_selection(TAG_PROXY).await?;
        // The selector may point at the automatic group, which in turn points
        // at a node; resolve one more level so the answer is always a node.
        let tag = if tag == TAG_AUTO {
            clash.current_selection(TAG_AUTO).await?
        } else {
            tag
        };

        Ok(tags.node_of(&tag).map(str::to_string))
    }

    // -----------------------------------------------------------------------
    // Latency
    // -----------------------------------------------------------------------

    /// Measure every node.
    ///
    /// While connected this is a real request through each outbound; otherwise
    /// it falls back to a TCP handshake, which at least proves reachability.
    pub async fn test_latency(self: &Arc<Self>, node_ids: Option<Vec<String>>) -> Result<()> {
        let settings = self.settings();
        let nodes: Vec<Node> = self
            .nodes()
            .into_iter()
            .filter(|n| {
                node_ids
                    .as_ref()
                    .map(|ids| ids.contains(&n.id))
                    .unwrap_or(true)
            })
            .filter(|n| n.unsupported_reason().is_none())
            .collect();

        let session = self
            .session
            .lock()
            .as_ref()
            .map(|s| (s.clash.clone(), s.tags.clone(), s.probe_base));
        let timeout = settings.probe.timeout_ms;
        let url = settings.probe.url.clone();

        // Both paths hand back batches of results so the collector below stays
        // the same shape whichever way the measurement was taken.
        type Batch = Vec<(String, Option<u32>)>;
        let mut tasks: Vec<tokio::task::JoinHandle<Batch>> = Vec::new();

        // Without a running core, or without probe lanes, the best available
        // signal is whether the endpoint accepts a TCP connection at all.
        let Some((clash, tags, Some(base))) = session else {
            for node in nodes {
                tasks.push(tokio::spawn(async move {
                    let latency =
                        crate::clash::tcp_latency(&node.server, node.server_port, timeout).await;
                    vec![(node.id, latency)]
                }));
            }
            return self.collect_latencies(tasks).await;
        };

        // Resolve the probe host once up front. The lanes resolve locally, so
        // without this the first node measured pays for a cold DNS lookup and
        // reads as a timeout no matter how good it is.
        if let Some(host) = url
            .split("://")
            .nth(1)
            .and_then(|rest| rest.split('/').next())
            .filter(|h| !h.is_empty())
        {
            let target = if host.contains(':') {
                host.to_string()
            } else {
                format!("{host}:80")
            };
            let _ = tokio::time::timeout(
                std::time::Duration::from_secs(5),
                tokio::net::lookup_host(target),
            )
            .await;
        }

        // Each lane owns a selector, so a lane measures its share of the nodes
        // one at a time while the lanes themselves run concurrently.
        let lanes = singbox::PROBE_LANES as usize;
        let mut buckets: Vec<Vec<Node>> = (0..lanes).map(|_| Vec::new()).collect();
        for (i, node) in nodes.into_iter().enumerate() {
            buckets[i % lanes].push(node);
        }

        for (lane, bucket) in buckets.into_iter().enumerate() {
            if bucket.is_empty() {
                continue;
            }
            let clash = clash.clone();
            let tags = tags.clone();
            let url = url.clone();
            let lane = lane as u16;

            tasks.push(tokio::spawn(async move {
                let selector = singbox::probe_selector_tag(lane);
                let port = singbox::probe_port(base, lane);
                let mut out = Vec::with_capacity(bucket.len());

                for node in bucket {
                    let latency = match tags.tag_of(&node.id) {
                        Some(tag) => match clash.select(&selector, tag).await {
                            Ok(()) => crate::clash::http_latency(port, &url, timeout).await,
                            Err(e) => {
                                tracing::warn!("probe lane {lane} could not switch: {e}");
                                None
                            }
                        },
                        None => None,
                    };
                    out.push((node.id, latency));
                }
                out
            }));
        }

        self.collect_latencies(tasks).await
    }

    /// Await measurement batches, persist them and tell the UI.
    async fn collect_latencies(
        &self,
        tasks: Vec<tokio::task::JoinHandle<Vec<(String, Option<u32>)>>>,
    ) -> Result<()> {
        let mut results = Vec::new();
        for task in tasks {
            if let Ok(batch) = task.await {
                results.extend(batch);
            }
        }

        let now = chrono::Utc::now().timestamp();
        self.store.write(|d| {
            for (id, latency) in &results {
                if let Some(node) = d.nodes.iter_mut().find(|n| &n.id == id) {
                    node.latency_ms = *latency;
                    node.last_tested_at = Some(now);
                }
            }
        })?;

        let _ = self.app.emit(event::LATENCY, &results);
        self.emit_data_changed();
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Background streams
    // -----------------------------------------------------------------------

    fn spawn_traffic_stream(
        self: &Arc<Self>,
        clash: ClashClient,
        mut stop: mpsc::UnboundedReceiver<()>,
    ) {
        let this = Arc::clone(self);
        tokio::spawn(async move {
            let (tx, mut rx) = mpsc::unbounded_channel::<TrafficSample>();

            let streamer = tokio::spawn(async move {
                if let Err(e) = clash.stream_traffic(tx).await {
                    tracing::warn!("the traffic stream ended: {e}");
                }
            });

            loop {
                tokio::select! {
                    sample = rx.recv() => {
                        let Some(sample) = sample else { break };
                        let snapshot = {
                            let mut traffic = this.traffic.lock();
                            traffic.up = sample.up;
                            traffic.down = sample.down;
                            traffic.total_up = traffic.total_up.saturating_add(sample.up);
                            traffic.total_down = traffic.total_down.saturating_add(sample.down);
                            *traffic
                        };
                        let _ = this.app.emit(event::TRAFFIC, snapshot);
                    }
                    // The sender lives in the session; dropping it ends this task.
                    _ = stop.recv() => break,
                }
            }

            streamer.abort();
        });
    }

    /// Forward core logs to the UI at a fixed cadence rather than per line, so
    /// a chatty debug level cannot flood the IPC channel.
    fn spawn_log_forwarder(self: &Arc<Self>) {
        let this = Arc::clone(self);
        tokio::spawn(async move {
            let mut sent = 0usize;
            loop {
                tokio::time::sleep(std::time::Duration::from_millis(700)).await;
                if this.session.lock().is_none() {
                    return;
                }

                let lines = this.logs.snapshot();
                if lines.len() > sent {
                    let _ = this.app.emit(event::LOG, &lines[sent..]);
                    sent = lines.len();
                } else if lines.len() < sent {
                    // The buffer wrapped or was cleared; resynchronise.
                    sent = lines.len();
                }
            }
        });
    }
}

fn random_secret() -> String {
    use rand::Rng;
    let mut bytes = [0u8; 24];
    rand::thread_rng().fill(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
