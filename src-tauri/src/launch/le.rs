//! Locale Emulator path detection and persistence.
//!
//! Detection order (per 03-CONTEXT § Locale Emulator Detection):
//!   1. Registry `HKEY_CURRENT_USER\Software\LocaleEmulator` (`Path` value).
//!   2. Four common install paths (LOCALAPPDATA + Program Files {x64,x86} + D:\).
//!   3. `PATH` environment variable scan for `LEProc.exe`.
//!
//! Persistence: detected/user-set path is written to `data/config.json`
//! under the `le_path` key. `resolve_le_path` is the high-level entry point —
//! prefer the existing config value, fall back to detect, and write the
//! result back so subsequent calls are O(1).
//!
//! `set_le_path` is the manual override (Settings page in 03e). It validates
//! existence and rewrites `config.json`.

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;
use winreg::enums::*;
use winreg::RegKey;

/// Common LE install locations checked in order. Raw strings include
/// `%LOCALAPPDATA%` which `expand_env` resolves at runtime.
const COMMON_PATHS: &[&str] = &[
    r"%LOCALAPPDATA%\LocaleEmulator\LEProc.exe",
    r"C:\Program Files\LocaleEmulator\LEProc.exe",
    r"C:\Program Files (x86)\LocaleEmulator\LEProc.exe",
    r"D:\Program Files\LocaleEmulator\LEProc.exe",
];

#[derive(Debug, thiserror::Error)]
pub enum LeError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("not found")]
    NotFound,
    #[error("invalid path: {0}")]
    InvalidPath(String),
}

/// Probe registry, common paths, then PATH for `LEProc.exe`.
/// Returns `None` if all three strategies miss; callers (`resolve_le_path`)
/// translate that into `LeError::NotFound`.
pub fn detect_le_path() -> Option<PathBuf> {
    // 1. Registry — LE installer (when run with admin) writes
    //    HKCU\Software\LocaleEmulator\Path to the install dir.
    if let Ok(key) = RegKey::predef(HKEY_CURRENT_USER).open_subkey(r"Software\LocaleEmulator") {
        if let Ok(p) = key.get_value::<String, _>("Path") {
            let candidate = PathBuf::from(p).join("LEProc.exe");
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }
    // 2. Common install paths (incl. %LOCALAPPDATA% expansion).
    for raw in COMMON_PATHS {
        let expanded = expand_env(raw);
        let pb = PathBuf::from(expanded);
        if pb.exists() {
            return Some(pb);
        }
    }
    // 3. PATH search — last resort for users who put LE on $PATH manually.
    if let Ok(path_var) = std::env::var("PATH") {
        for p in path_var.split(';') {
            if p.is_empty() {
                continue;
            }
            let candidate = Path::new(p).join("LEProc.exe");
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }
    None
}

/// Expand `%LOCALAPPDATA%` (and only that token — the only env var used by
/// `COMMON_PATHS`). Kept tiny on purpose; broader expansion would invite
/// unintended substitutions.
fn expand_env(s: &str) -> String {
    let mut out = s.to_string();
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        out = out.replace("%LOCALAPPDATA%", &local);
    }
    out
}

/// Resolve the LE path with cache-first semantics.
///
/// Order:
///   1. `data/config.json::le_path` — if set AND the file still exists.
///   2. `detect_le_path` — write result back to `config.json`.
///   3. `LeError::NotFound` — surfaced to UI to prompt manual override.
///
/// `data_dir` is the portable data directory (see `data_dir::resolve_data_dir`).
/// `config.json` is created with default Phase 1 contents on app boot, so it
/// is expected to exist by the time this runs in production. Tests pass a
/// fresh `TempDir` and rely on the `unwrap_or_else("{}")` fallback.
pub fn resolve_le_path(
    data_dir: &Path,
    bundled_le_proc: Option<&Path>,
) -> Result<PathBuf, LeError> {
    let cfg_path = data_dir.join("config.json");
    let cfg_str = fs::read_to_string(&cfg_path).unwrap_or_else(|_| "{}".into());
    let mut cfg: Value =
        serde_json::from_str(&cfg_str).unwrap_or_else(|_| Value::Object(Default::default()));

    // 1. Manual override — user explicitly picked a launcher path via the
    // Settings page. Honor it as long as the file still exists.
    if let Some(p) = cfg.get("le_path").and_then(|v| v.as_str()) {
        let pb = PathBuf::from(p);
        if pb.exists() {
            eprintln!("[launch] LE resolved from manual override: {:?}", pb);
            return Ok(pb);
        }
        eprintln!("[launch] LE override path stale (file gone): {}", p);
    }

    // 2. Bundled LEProc that ships with the app — the default for users who
    // never configure anything. Resolved at setup time in lib.rs.
    if let Some(bundled) = bundled_le_proc {
        if bundled.exists() {
            eprintln!("[launch] LE resolved from bundled resources: {:?}", bundled);
            return Ok(bundled.to_path_buf());
        }
    }

    // 3. Last-ditch detection — user-installed LE via registry / common paths
    // / PATH. Hits when the bundle is somehow missing AND no override is set.
    match detect_le_path() {
        Some(detected) => {
            eprintln!("[launch] LE detected on system: {:?}", detected);
            cfg["le_path"] = Value::String(detected.to_string_lossy().into());
            fs::write(&cfg_path, serde_json::to_string_pretty(&cfg).unwrap())?;
            Ok(detected)
        }
        None => {
            eprintln!("[launch] LE not found anywhere (override / bundled / detected)");
            Err(LeError::NotFound)
        }
    }
}

/// Manual override: write `path` to `data/config.json::le_path`.
/// Errors with `LeError::InvalidPath` if `path` does not exist on disk —
/// we never persist a path the launcher will fail on later.
pub fn set_le_path(data_dir: &Path, path: &Path) -> Result<(), LeError> {
    if !path.exists() {
        return Err(LeError::InvalidPath(path.to_string_lossy().into()));
    }
    let cfg_path = data_dir.join("config.json");
    let cfg_str = fs::read_to_string(&cfg_path).unwrap_or_else(|_| "{}".into());
    let mut cfg: Value =
        serde_json::from_str(&cfg_str).unwrap_or_else(|_| Value::Object(Default::default()));
    cfg["le_path"] = Value::String(path.to_string_lossy().into());
    fs::write(&cfg_path, serde_json::to_string_pretty(&cfg).unwrap())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use tempfile::TempDir;

    #[test]
    fn expand_env_resolves_localappdata() {
        // We don't assume LOCALAPPDATA is set in CI — fall back to a sane
        // synthetic value so the assertion is still meaningful.
        let v = env::var("LOCALAPPDATA")
            .unwrap_or_else(|_| "C:\\Users\\Default\\AppData\\Local".into());
        // Force-set so the test is deterministic across environments.
        env::set_var("LOCALAPPDATA", &v);
        let r = expand_env(r"%LOCALAPPDATA%\LocaleEmulator\LEProc.exe");
        assert!(
            r.starts_with(&v),
            "expanded path should begin with LOCALAPPDATA value (got {r})"
        );
        assert!(
            !r.contains("%LOCALAPPDATA%"),
            "token must be substituted (got {r})"
        );
    }

    #[test]
    fn set_le_path_writes_to_config() {
        let tmp = TempDir::new().unwrap();
        let dummy = tmp.path().join("LEProc.exe");
        // `set_le_path` requires the target to exist — write a placeholder byte.
        fs::write(&dummy, b"\x00").unwrap();

        set_le_path(tmp.path(), &dummy).expect("set_le_path should succeed");

        let cfg: Value = serde_json::from_str(
            &fs::read_to_string(tmp.path().join("config.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(
            cfg["le_path"].as_str().unwrap(),
            dummy.to_string_lossy(),
            "config.json le_path must equal the persisted dummy path"
        );

        // And: setting a non-existent path must error with InvalidPath.
        let bogus = tmp.path().join("does-not-exist.exe");
        let err = set_le_path(tmp.path(), &bogus).unwrap_err();
        assert!(
            matches!(err, LeError::InvalidPath(_)),
            "non-existent path should yield LeError::InvalidPath (got {err:?})"
        );
    }
}
