---
phase: 05-stats-media
plan: 05b
type: execute
wave: 2
depends_on: [05a]
files_modified:
  - src-tauri/src/screenshot.rs
  - src-tauri/src/save_backup.rs
  - src-tauri/src/launch/orchestrator.rs
  - src-tauri/src/commands.rs
  - src-tauri/src/lib.rs
autonomous: true
requirements: [STATS-01, STATS-02, SHOT-01, SAVE-01, SAVE-02, SAVE-03]
must_haves:
  truths:
    - "src/screenshot.rs: capture_to_disk(game_id, data_dir) using `screenshots` crate, save to data/screenshots/{game_id}/{unix_timestamp}.png + INSERT row"
    - "src/save_backup.rs: create_backup (recursive copy save_path → data/saves/{game_id}/{ts}/) + restore_backup (reverse) + list_backups + delete_backup"
    - "launch::orchestrator extension: spawn screenshot interval task (tokio::time::interval) when session starts; abort on session end"
    - "12 new Tauri commands: get_playtime_trend, get_top_games, get_screenshots, delete_screenshot, export_screenshot, set_screenshot_interval, set_save_path, list_save_backups, create_save_backup, restore_save_backup, delete_save_backup, get_screenshot_settings"
    - "lib.rs generate_handler! 共 44 项 (32 prior + 12 new)"
    - "cargo check + cargo test --lib 全绿"
---

# Plan 05b — Backend stats + screenshots + save backup

## Tasks

<task name="Task 1: screenshot.rs + save_backup.rs core modules">

<read_first>
- D:\project\gal-lib\src-tauri\Cargo.toml (verify screenshots + png + walkdir)
- D:\project\gal-lib\src-tauri\src\data_dir.rs (data_dir + screenshots/saves subdirs from P1)
- D:\project\gal-lib\.planning\phases\05-stats-media\05-CONTEXT.md (§Screenshot Capture, §Save Backup)
</read_first>

<action>

1. **`src-tauri/src/screenshot.rs`**:
```rust
use std::path::{Path, PathBuf};
use std::fs;
use screenshots::Screen;

#[derive(Debug, thiserror::Error)]
pub enum ScreenshotError {
    #[error("io: {0}")] Io(#[from] std::io::Error),
    #[error("no screen")] NoScreen,
    #[error("screenshot crate: {0}")] Capture(String),
    #[error("png encode: {0}")] Png(String),
}

/// Capture primary monitor; save to data/screenshots/{game_id}/{unix_timestamp}.png.
/// Returns the relative path string (e.g. "screenshots/42/1714723200.png").
pub fn capture_to_disk(data_dir: &Path, game_id: i64) -> Result<String, ScreenshotError> {
    let screens = Screen::all().map_err(|e| ScreenshotError::Capture(e.to_string()))?;
    let screen = screens.first().ok_or(ScreenshotError::NoScreen)?;
    let img = screen.capture().map_err(|e| ScreenshotError::Capture(e.to_string()))?;
    let dir = data_dir.join("screenshots").join(game_id.to_string());
    fs::create_dir_all(&dir)?;
    let ts = chrono::Utc::now().timestamp();
    let target = dir.join(format!("{ts}.png"));
    let bytes = img.to_png(None).map_err(|e| ScreenshotError::Png(e.to_string()))?;
    fs::write(&target, &bytes)?;
    Ok(format!("screenshots/{game_id}/{ts}.png"))
}
```

2. **`src-tauri/src/save_backup.rs`**:
```rust
use std::path::{Path, PathBuf};
use std::fs;
use walkdir::WalkDir;

#[derive(Debug, thiserror::Error)]
pub enum SaveError {
    #[error("io: {0}")] Io(#[from] std::io::Error),
    #[error("walk: {0}")] Walk(#[from] walkdir::Error),
    #[error("save path not configured")] NotConfigured,
    #[error("source not found: {0}")] SourceMissing(String),
}

#[derive(Debug)]
pub struct BackupResult { pub backup_dir: String, pub file_count: i64, pub total_size_bytes: i64 }

/// Recursively copy `src` (game's save_path) to data/saves/{game_id}/{timestamp}/.
/// Returns relative backup_dir + counts.
pub fn create_backup(data_dir: &Path, game_id: i64, src: &Path) -> Result<BackupResult, SaveError> {
    if !src.exists() { return Err(SaveError::SourceMissing(src.to_string_lossy().into())); }
    let ts = chrono::Utc::now().timestamp();
    let rel = format!("saves/{game_id}/{ts}");
    let dst = data_dir.join(&rel);
    fs::create_dir_all(&dst)?;
    let mut count = 0i64;
    let mut bytes = 0i64;
    for entry in WalkDir::new(src) {
        let entry = entry?;
        let rel_path = entry.path().strip_prefix(src).unwrap();
        let target = dst.join(rel_path);
        if entry.file_type().is_dir() {
            fs::create_dir_all(&target)?;
        } else {
            if let Some(p) = target.parent() { fs::create_dir_all(p)?; }
            fs::copy(entry.path(), &target)?;
            count += 1;
            bytes += entry.metadata()?.len() as i64;
        }
    }
    Ok(BackupResult { backup_dir: rel, file_count: count, total_size_bytes: bytes })
}

pub fn restore_backup(data_dir: &Path, backup_rel: &str, dst: &Path) -> Result<(), SaveError> {
    let src = data_dir.join(backup_rel);
    if !src.exists() { return Err(SaveError::SourceMissing(src.to_string_lossy().into())); }
    fs::create_dir_all(dst)?;
    for entry in WalkDir::new(&src) {
        let entry = entry?;
        let rel_path = entry.path().strip_prefix(&src).unwrap();
        let target = dst.join(rel_path);
        if entry.file_type().is_dir() {
            fs::create_dir_all(&target)?;
        } else {
            if let Some(p) = target.parent() { fs::create_dir_all(p)?; }
            fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

pub fn delete_backup_dir(data_dir: &Path, backup_rel: &str) -> Result<(), SaveError> {
    let target = data_dir.join(backup_rel);
    if target.exists() { fs::remove_dir_all(&target)?; }
    Ok(())
}
```

3. **`src-tauri/src/lib.rs`** append `mod screenshot;` and `mod save_backup;`.

4. cargo check + cargo test --lib green.

</action>

<verify>
<automated>
cd D:\project\gal-lib && \
test -f src-tauri/src/screenshot.rs && \
test -f src-tauri/src/save_backup.rs && \
grep -q "capture_to_disk" src-tauri/src/screenshot.rs && \
grep -q "create_backup" src-tauri/src/save_backup.rs && \
grep -q "restore_backup" src-tauri/src/save_backup.rs && \
grep -q "mod screenshot" src-tauri/src/lib.rs && \
grep -q "mod save_backup" src-tauri/src/lib.rs && \
cargo check --manifest-path src-tauri/Cargo.toml
</automated>
</verify>

</task>

<task name="Task 2: orchestrator screenshot interval + 12 Tauri commands + lib.rs">

<read_first>
- D:\project\gal-lib\src-tauri\src\launch\orchestrator.rs (extend launch_game to spawn screenshot interval task)
- D:\project\gal-lib\src-tauri\src\commands.rs (existing 32 commands; APPEND 12 new)
- D:\project\gal-lib\src-tauri\src\lib.rs (extend generate_handler!)
</read_first>

<action>

1. **`src-tauri/src/launch/orchestrator.rs`** — In `launch_game` after `mark_running`, spawn a 2nd tokio task:
```rust
// Read screenshot_interval_sec for this game
let interval_sec: i64 = sqlx::query_scalar(
    "SELECT screenshot_interval_sec FROM games WHERE id=?"
).bind(game_id).fetch_optional(&pool_for_screen).await?.unwrap_or(300);

if interval_sec > 0 {
    let pool_s = pool_for_screen.clone();
    let dd = data_dir.clone();
    let cancel = cancel_flag.clone(); // shared with primary wait task
    let g = game_id;
    tokio::spawn(async move {
        let mut iv = tokio::time::interval(std::time::Duration::from_secs(interval_sec.max(60) as u64));
        iv.tick().await; // skip immediate
        loop {
            iv.tick().await;
            if cancel.load(std::sync::atomic::Ordering::Relaxed) { break; }
            if let Ok(rel) = crate::screenshot::capture_to_disk(&dd, g) {
                let _ = sqlx::query("INSERT INTO screenshots (game_id, path) VALUES (?, ?)")
                    .bind(g).bind(&rel).execute(&pool_s).await;
            }
        }
    });
}
```
Use the same Arc<AtomicBool> cancel flag that the existing wait_for_exit logic flips when game exits. Ensure cancel is set when exit_code is captured (before end_session call).

2. **`src-tauri/src/commands.rs`** — append 12 new commands:
   - `get_playtime_trend(period: String, days: i32) -> Vec<TrendPoint>` — SQL GROUP BY `date(started_at)` (or week / month) with `SUM(duration_sec)/3600.0` as `hours`
   - `get_top_games(limit: i32) -> Vec<TopGame>` — SELECT id, name, name_cn, total_playtime_sec FROM games WHERE total_playtime_sec > 0 ORDER BY total_playtime_sec DESC LIMIT ?
   - `get_screenshots(game_id: i64) -> Vec<ScreenshotRow>` — SELECT * FROM screenshots WHERE game_id=? ORDER BY captured_at DESC
   - `delete_screenshot(id: i64) -> ()` — fs::remove_file + DELETE row
   - `export_screenshot(id: i64, target_path: String) -> ()` — fs::copy from data/<path> to target_path
   - `set_screenshot_interval(game_id: i64, interval_sec: i32) -> ()` — UPDATE games
   - `get_screenshot_settings(game_id: i64) -> i32` — SELECT screenshot_interval_sec
   - `set_save_path(game_id: i64, save_path: Option<String>) -> ()` — UPDATE games
   - `create_save_backup(game_id: i64, note: Option<String>) -> i64` — read save_path; call save_backup::create_backup; INSERT save_backups row; return id
   - `list_save_backups(game_id: i64) -> Vec<SaveBackupRow>` — SELECT * FROM save_backups WHERE game_id=? ORDER BY created_at DESC
   - `restore_save_backup(id: i64) -> ()` — read backup_dir + game.save_path; call save_backup::restore_backup
   - `delete_save_backup(id: i64) -> ()` — read backup_dir; call save_backup::delete_backup_dir; DELETE row

3. **`src-tauri/src/lib.rs`** — append 12 entries to generate_handler! (preserve all 32 prior). Total 44.

4. cargo check + cargo test --lib green.

</action>

<verify>
<automated>
cd D:\project\gal-lib && \
grep -q "get_playtime_trend" src-tauri/src/commands.rs && \
grep -q "get_top_games" src-tauri/src/commands.rs && \
grep -q "get_screenshots" src-tauri/src/commands.rs && \
grep -q "delete_screenshot" src-tauri/src/commands.rs && \
grep -q "create_save_backup" src-tauri/src/commands.rs && \
grep -q "restore_save_backup" src-tauri/src/commands.rs && \
grep -q "list_save_backups" src-tauri/src/commands.rs && \
grep -q "set_save_path" src-tauri/src/commands.rs && \
grep -q "commands::get_playtime_trend" src-tauri/src/lib.rs && \
grep -q "commands::create_save_backup" src-tauri/src/lib.rs && \
grep -q "screenshot::capture_to_disk" src-tauri/src/launch/orchestrator.rs && \
cargo check --manifest-path src-tauri/Cargo.toml && \
cargo test --manifest-path src-tauri/Cargo.toml --lib
</automated>
</verify>

</task>

## Commits

- `feat(05-05b): add screenshot + save_backup core modules`
- `feat(05-05b): wire 12 backend commands (stats / screenshots / save backups) + screenshot interval in orchestrator`
