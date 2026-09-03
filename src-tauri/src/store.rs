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
            Ok(raw) => match serde_json::from_str::<AppData>(&raw) {
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
