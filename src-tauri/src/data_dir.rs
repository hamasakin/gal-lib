//! Portable data directory resolution and bootstrap.
//!
//! On release builds `current_exe()` returns the path to the bundled `gal-lib.exe`,
//! whose parent directory is the install location — `data/` lives there.
//!
//! On dev (`pnpm tauri dev`) `current_exe()` points at `target/debug/gal-lib.exe`,
//! so `data/` ends up at `src-tauri/target/debug/data/`. This is intentional
//! (per RESEARCH § Pitfall 2): we accept the dev/prod path divergence to avoid
//! `#[cfg(debug_assertions)]` branches that would mask production bugs.
//!
//! `dunce::canonicalize` strips the Windows `\\?\` UNC prefix that
//! `std::fs::canonicalize` adds (sqlx rejects UNC connection strings —
//! see RESEARCH § Pitfall 7).

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

const SUBDIRS: &[&str] = &["covers", "screenshots", "saves", "logs"];
const DEFAULT_CONFIG_JSON: &str = r#"{
  "schema_version": 1,
  "scan_roots": [],
  "default_locale": "ja-JP",
  "le_path": null
}
"#;

/// Resolve the portable `data/` directory next to the running executable.
/// Canonicalizes via `dunce` so the path is free of `\\?\` UNC prefix.
pub fn resolve_data_dir() -> io::Result<PathBuf> {
    let exe = std::env::current_exe()?;
    let exe_dir = exe.parent().ok_or_else(|| {
        io::Error::new(io::ErrorKind::NotFound, "current_exe has no parent")
    })?;
    // dunce::canonicalize falls back to the original path on failure (e.g. exe_dir
    // not yet realized in some sandboxed envs); join `data` to whichever we get.
    let canonical = dunce::canonicalize(exe_dir)
        .unwrap_or_else(|_| exe_dir.to_path_buf());
    Ok(canonical.join("data"))
}

/// Create the data dir and all required subdirectories. Idempotent.
pub fn ensure_subdirs(data_dir: &Path) -> io::Result<()> {
    fs::create_dir_all(data_dir)?;
    for sub in SUBDIRS {
        fs::create_dir_all(data_dir.join(sub))?;
    }
    Ok(())
}

/// Write `data/config.json` with default values **only if it does not yet exist**.
/// Existing user-edited config is never overwritten.
pub fn ensure_default_config(data_dir: &Path) -> io::Result<()> {
    let cfg = data_dir.join("config.json");
    if cfg.exists() {
        return Ok(());
    }
    fs::write(&cfg, DEFAULT_CONFIG_JSON)
}

/// One-shot bootstrap called from `tauri::Builder::setup`.
/// Returns the absolute, canonical `data/` path.
pub fn ensure() -> io::Result<PathBuf> {
    let data_dir = resolve_data_dir()?;
    ensure_subdirs(&data_dir)?;
    ensure_default_config(&data_dir)?;
    Ok(data_dir)
}

/// Build the sqlite connection URL for tauri-plugin-sql.
/// Forward-slashes the path because sqlx URL parsing rejects backslashes
/// on Windows (RESEARCH § Pitfall 7).
pub fn build_db_url(data_dir: &Path) -> String {
    let abs = data_dir.join("app.db");
    format!("sqlite:{}", abs.to_string_lossy().replace('\\', "/"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_db_url_uses_forward_slashes_and_absolute_path() {
        // Windows-style absolute input
        let p = PathBuf::from(r"C:\Users\foo\gal-lib\data");
        let url = build_db_url(&p);
        assert!(url.starts_with("sqlite:"), "url must start with sqlite:");
        assert!(!url.contains('\\'), "url must not contain backslashes (got {url})");
        assert!(url.ends_with("/app.db"), "url must end with /app.db (got {url})");
        assert!(
            url.contains("C:/Users/foo/gal-lib/data/app.db"),
            "url must preserve the absolute path forward-slashed (got {url})"
        );
    }

    #[test]
    fn ensure_creates_subdirs_and_default_config_idempotently() {
        let tmp = std::env::temp_dir().join(format!("gal-lib-test-{}", std::process::id()));
        // clean from previous test runs
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();

        // First call: creates everything
        ensure_subdirs(&tmp).unwrap();
        ensure_default_config(&tmp).unwrap();
        for sub in SUBDIRS {
            assert!(tmp.join(sub).is_dir(), "subdir {sub} should exist");
        }
        let cfg = tmp.join("config.json");
        assert!(cfg.is_file(), "config.json should exist");
        let original = fs::read_to_string(&cfg).unwrap();
        assert!(original.contains("\"schema_version\": 1"));
        assert!(original.contains("\"default_locale\": \"ja-JP\""));

        // Second call (with user-edited config): must NOT overwrite
        fs::write(&cfg, r#"{"schema_version":1,"scan_roots":["X:\\games"],"default_locale":"zh-CN","le_path":null}"#).unwrap();
        ensure_subdirs(&tmp).unwrap();
        ensure_default_config(&tmp).unwrap();
        let after = fs::read_to_string(&cfg).unwrap();
        assert!(after.contains("X:\\\\games"), "user config must be preserved");
        assert!(after.contains("zh-CN"), "user config must be preserved");

        let _ = fs::remove_dir_all(&tmp);
    }
}
