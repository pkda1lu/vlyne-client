//! Persistence of nodes, subscriptions and settings.
//!
//! Writes go through a temporary file and an atomic rename, so an interrupted
//! save can never leave the user with a truncated profile list.

use std::path::{Path, PathBuf};

use parking_lot::RwLock;

use crate::error::Result;
use crate::model::AppData;

pub struct Store {
    path: PathBuf,
    data: RwLock<AppData>,
}

impl Store {
    /// Load from disk, falling back to defaults when the file is missing or
    /// unreadable. A corrupt file is kept aside rather than silently discarded.
    pub fn load(path: impl AsRef<Path>) -> Self {
        let path = path.as_ref().to_path_buf();
        let data = match std::fs::read_to_string(&path) {
            Ok(raw) => match serde_json::from_str::<AppData>(strip_bom(&raw)) {
                Ok(data) => data,
                Err(e) => {
                    tracing::error!("profile file is corrupt, starting fresh: {e}");
                    let _ = std::fs::rename(&path, path.with_extension("json.corrupt"));
                    AppData::default()
                }
            },
            Err(_) => AppData::default(),
        };

        Self {
            path,
            data: RwLock::new(data),
        }
    }

    pub fn read<T>(&self, f: impl FnOnce(&AppData) -> T) -> T {
        f(&self.data.read())
    }

    pub fn snapshot(&self) -> AppData {
        self.data.read().clone()
    }

    /// Mutate and persist in one step. The write happens outside the lock so a
    /// slow disk cannot block readers.
    pub fn write<T>(&self, f: impl FnOnce(&mut AppData) -> T) -> Result<T> {
        let (result, snapshot) = {
            let mut guard = self.data.write();
            let result = f(&mut guard);
            (result, guard.clone())
        };
        self.persist(&snapshot)?;
        Ok(result)
    }

    fn persist(&self, data: &AppData) -> Result<()> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let tmp = self.path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(data)?)?;
        std::fs::rename(&tmp, &self.path)?;
        Ok(())
    }
}

/// Drop a leading byte order mark.
///
/// Plenty of Windows tools — PowerShell's `Set-Content`, Notepad, several
/// editors — write UTF-8 with a BOM by default. `serde_json` treats it as a
/// syntax error, so a profile touched by any of them would be filed away as
/// corrupt and the user would find their servers and subscriptions gone.
fn strip_bom(raw: &str) -> &str {
    raw.strip_prefix('\u{feff}').unwrap_or(raw)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_profile_written_with_a_bom_still_loads() {
        let dir = std::env::temp_dir().join(format!("vlyne-store-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("profile.json");

        std::fs::write(
            &path,
            "\u{feff}{\"activeNodeId\":\"n1\",\"settings\":{\"general\":{\"language\":\"en\"}}}",
        )
        .unwrap();

        let store = Store::load(&path);
        assert_eq!(store.read(|d| d.active_node_id.clone()).as_deref(), Some("n1"));
        assert_eq!(store.read(|d| d.settings.general.language.clone()), "en");
        // Nothing was filed away as corrupt.
        assert!(!path.with_extension("json.corrupt").exists());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_genuinely_broken_profile_is_kept_aside() {
        let dir = std::env::temp_dir().join(format!("vlyne-store-bad-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("profile.json");
        std::fs::write(&path, "{ this is not json").unwrap();

        let store = Store::load(&path);
        assert!(store.read(|d| d.nodes.is_empty()));
        assert!(path.with_extension("json.corrupt").exists());

        let _ = std::fs::remove_dir_all(&dir);
    }
}
