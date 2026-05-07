---
phase: 03-launch-playtime
plan: 03b
type: execute
wave: 2
depends_on: [03a]
files_modified:
  - src-tauri/src/launch/mod.rs
  - src-tauri/src/launch/le.rs
  - src-tauri/src/lib.rs
autonomous: true
requirements: [LAUNCH-01]
must_haves:
  truths:
    - "Locale Emulator 路径自动检测：注册表 + 4 常见路径 + PATH 搜索"
    - "le::resolve_le_path() 优先用 config.json 里的 le_path，否则触发 detect 并写回 config"
    - "cargo check + cargo test --lib 全绿"
  artifacts:
    - path: src-tauri/src/launch/mod.rs
      contains: "pub mod le"
    - path: src-tauri/src/launch/le.rs
      contains: "resolve_le_path"
---

# Plan 03b — LE Detector + le_path Resolver

## Tasks

<task name="Task 1: launch/le.rs LE detector + launch/mod.rs">

<read_first>
- D:\project\gal-lib\src-tauri\src\data_dir.rs (config.json read pattern from Phase 1)
- D:\project\gal-lib\.planning\phases\03-launch-playtime\03-CONTEXT.md (§Locale Emulator Detection)
</read_first>

<action>

1. **`src-tauri/src/launch/mod.rs`**:
```rust
//! LE-based launch + process tracking subsystem.
pub mod le;
// 03c will add `pub mod process_track;`
```

2. **`src-tauri/src/launch/le.rs`**:
```rust
use std::path::{Path, PathBuf};
use std::fs;
use serde_json::Value;
use winreg::enums::*;
use winreg::RegKey;

const COMMON_PATHS: &[&str] = &[
    r"%LOCALAPPDATA%\LocaleEmulator\LEProc.exe",
    r"C:\Program Files\LocaleEmulator\LEProc.exe",
    r"C:\Program Files (x86)\LocaleEmulator\LEProc.exe",
    r"D:\Program Files\LocaleEmulator\LEProc.exe",
];

#[derive(Debug, thiserror::Error)]
pub enum LeError {
    #[error("io: {0}")] Io(#[from] std::io::Error),
    #[error("not found")]
    NotFound,
    #[error("invalid path: {0}")] InvalidPath(String),
}

pub fn detect_le_path() -> Option<PathBuf> {
    // 1. Registry
    if let Ok(hklm) = RegKey::predef(HKEY_CURRENT_USER).open_subkey(r"Software\LocaleEmulator") {
        if let Ok(p) = hklm.get_value::<String, _>("Path") {
            let candidate = PathBuf::from(p).join("LEProc.exe");
            if candidate.exists() { return Some(candidate); }
        }
    }
    // 2. Common paths
    for raw in COMMON_PATHS {
        let expanded = expand_env(raw);
        let pb = PathBuf::from(expanded);
        if pb.exists() { return Some(pb); }
    }
    // 3. PATH search
    if let Ok(path_var) = std::env::var("PATH") {
        for p in path_var.split(';') {
            let candidate = Path::new(p).join("LEProc.exe");
            if candidate.exists() { return Some(candidate); }
        }
    }
    None
}

fn expand_env(s: &str) -> String {
    let mut out = s.to_string();
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        out = out.replace("%LOCALAPPDATA%", &local);
    }
    out
}

/// Resolve LE path: priority 1 = config.json's le_path, priority 2 = detect, write back.
pub fn resolve_le_path(data_dir: &Path) -> Result<PathBuf, LeError> {
    let cfg_path = data_dir.join("config.json");
    let cfg_str = fs::read_to_string(&cfg_path).unwrap_or_else(|_| "{}".into());
    let mut cfg: Value = serde_json::from_str(&cfg_str).unwrap_or_else(|_| Value::Object(Default::default()));
    if let Some(p) = cfg.get("le_path").and_then(|v| v.as_str()) {
        let pb = PathBuf::from(p);
        if pb.exists() { return Ok(pb); }
    }
    // Detect
    let detected = detect_le_path().ok_or(LeError::NotFound)?;
    cfg["le_path"] = Value::String(detected.to_string_lossy().into());
    fs::write(&cfg_path, serde_json::to_string_pretty(&cfg).unwrap())?;
    Ok(detected)
}

pub fn set_le_path(data_dir: &Path, path: &Path) -> Result<(), LeError> {
    if !path.exists() { return Err(LeError::InvalidPath(path.to_string_lossy().into())); }
    let cfg_path = data_dir.join("config.json");
    let cfg_str = fs::read_to_string(&cfg_path).unwrap_or_else(|_| "{}".into());
    let mut cfg: Value = serde_json::from_str(&cfg_str).unwrap_or_else(|_| Value::Object(Default::default()));
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
        let v = env::var("LOCALAPPDATA").unwrap_or_else(|_| "C:\\Users\\Default\\AppData\\Local".into());
        let r = expand_env(r"%LOCALAPPDATA%\LocaleEmulator\LEProc.exe");
        assert!(r.starts_with(&v));
    }

    #[test]
    fn set_le_path_writes_to_config() {
        let tmp = TempDir::new().unwrap();
        let dummy = tmp.path().join("LEProc.exe");
        fs::write(&dummy, b"\x00").unwrap();
        set_le_path(tmp.path(), &dummy).unwrap();
        let cfg: Value = serde_json::from_str(&fs::read_to_string(tmp.path().join("config.json")).unwrap()).unwrap();
        assert_eq!(cfg["le_path"].as_str().unwrap(), dummy.to_string_lossy());
    }
}
```

3. **`src-tauri/Cargo.toml`** — append to `[dev-dependencies]`:
```toml
tempfile = "3"
```

4. **`src-tauri/src/lib.rs`** — append `mod launch;` after existing mod declarations.

5. cargo check + cargo test --lib green.

</action>

<verify>
<automated>
cd D:\project\gal-lib && \
test -f src-tauri/src/launch/mod.rs && \
test -f src-tauri/src/launch/le.rs && \
grep -q "pub fn detect_le_path" src-tauri/src/launch/le.rs && \
grep -q "pub fn resolve_le_path" src-tauri/src/launch/le.rs && \
grep -q "winreg::RegKey" src-tauri/src/launch/le.rs && \
grep -q "tempfile" src-tauri/Cargo.toml && \
grep -q "mod launch" src-tauri/src/lib.rs && \
cargo check --manifest-path src-tauri/Cargo.toml && \
cargo test --manifest-path src-tauri/Cargo.toml --lib launch::le::tests
</automated>
</verify>

</task>

## Commit

`feat(03-03b): add LE detector + le_path resolver (registry + common paths + PATH search)`
