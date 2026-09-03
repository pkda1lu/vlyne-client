use serde::{Serialize, Serializer};

/// Errors that cross the IPC boundary.
///
/// The frontend receives `{ code, message }` so it can localise the common
/// cases and still show the raw detail for the odd ones.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("core binary not found at {0}")]
    CoreMissing(String),

    #[error("the core exited before it was ready: {0}")]
    CoreStartFailed(String),

    #[error("the core is not running")]
    CoreNotRunning,

    #[error("no node selected")]
    NoNode,

    #[error("node {0} not found")]
    NodeNotFound(String),

    #[error("this node uses {0}, which sing-box cannot dial")]
    UnsupportedNode(String),

    #[error("TUN mode needs administrator rights")]
    ElevationRequired,

    #[error("port {0} is already in use")]
    PortInUse(u16),

    #[error("could not change the Windows proxy settings: {0}")]
    SystemProxy(String),

    #[error("could not parse the share link: {0}")]
    BadLink(String),

    #[error("subscription request failed: {0}")]
    Subscription(String),

    #[error("{0}")]
    Account(String),

    #[error("this device is not linked to an account")]
    AccountUnlinked,

    #[error("{0}")]
    Io(#[from] std::io::Error),

    #[error("{0}")]
    Json(#[from] serde_json::Error),

    #[error("{0}")]
    Other(String),
}

impl Error {
    /// Stable machine-readable code the UI switches on for localised copy.
    pub fn code(&self) -> &'static str {
        match self {
            Error::CoreMissing(_) => "core.missing",
            Error::CoreStartFailed(_) => "core.startFailed",
            Error::CoreNotRunning => "core.notRunning",
            Error::NoNode => "node.none",
            Error::NodeNotFound(_) => "node.notFound",
            Error::UnsupportedNode(_) => "node.unsupported",
            Error::ElevationRequired => "tun.elevationRequired",
            Error::PortInUse(_) => "port.inUse",
            Error::SystemProxy(_) => "proxy.failed",
            Error::BadLink(_) => "link.bad",
            Error::Subscription(_) => "subscription.failed",
            Error::Account(_) => "account.failed",
            Error::AccountUnlinked => "account.unlinked",
            Error::Io(_) => "io",
            Error::Json(_) => "json",
            Error::Other(_) => "unknown",
        }
    }
}

impl Serialize for Error {
    // Spelled out in full: this module's `Result` alias takes one parameter and
    // would shadow the two-parameter one the trait expects.
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut s = serializer.serialize_struct("Error", 2)?;
        s.serialize_field("code", self.code())?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}

impl From<anyhow::Error> for Error {
    fn from(e: anyhow::Error) -> Self {
        Error::Other(e.to_string())
    }
}

impl From<reqwest::Error> for Error {
    fn from(e: reqwest::Error) -> Self {
        Error::Subscription(e.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;
