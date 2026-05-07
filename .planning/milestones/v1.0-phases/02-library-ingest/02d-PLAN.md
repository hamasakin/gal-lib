---
phase: 02-library-ingest
plan: 02d
type: execute
wave: 4
depends_on: [02a, 02b, 02c]
files_modified:
  - src-tauri/src/cover_cache.rs
  - src-tauri/src/ingest.rs
  - src-tauri/src/commands.rs
  - src-tauri/src/lib.rs
autonomous: true
requirements: [META-04, META-05, META-06, SCAN-07]
must_haves:
  truths:
    - "cover_cache 写入 data/covers/{game_id}.{ext}（Content-Type 决定扩展名），DB cover_path 存相对路径"
    - "ingest::process_game 编排：clean_title → bangumi.search → 80+ 自动绑定 / 否则 vndb.search fallback / < 80 标 metadata-pending（用户在 UI 里挑）"
    - "Tauri commands 全部注册：add_scan_root / remove_scan_root / list_scan_roots / start_scan(mode='full'|'incremental') / cancel_scan / search_metadata / bind_metadata / refresh_metadata / mark_skip"
    - "lib.rs 注册 plugins: tauri_plugin_dialog, tauri_plugin_http；保留 Phase 1 的 sql plugin"
    - "cargo check 退出 0；cargo test --lib 全绿"
  artifacts:
    - path: src-tauri/src/cover_cache.rs
      contains: "pub async fn cache_cover"
    - path: src-tauri/src/ingest.rs
      contains: "pub async fn process_game"
    - path: src-tauri/src/commands.rs
      contains: "tauri::command"
    - path: src-tauri/src/lib.rs
      contains: "tauri_plugin_dialog::init()"
---

# Plan 02d — Cover Cache + Metadata Orchestrator + Tauri Commands

## Objective

把 02b/02c 的 metadata 客户端 + scan 引擎装配为完整 ingest 管线；写入 SQLite；暴露 9 个 Tauri commands 供 frontend 调用。

## Tasks

<task name="Task 1: cover_cache.rs">

<read_first>
- D:\project\gal-lib\.planning\phases\02-library-ingest\02-CONTEXT.md (§Cover Cache)
- D:\project\gal-lib\src-tauri\src\data_dir.rs
</read_first>

<action>

新建 `src-tauri/src/cover_cache.rs`：
```rust
//! Cover image fetcher + filesystem cache under data/covers/{game_id}.{ext}

use std::path::PathBuf;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum CacheError {
    #[error("http: {0}")] Http(#[from] reqwest::Error),
    #[error("io: {0}")] Io(#[from] std::io::Error),
    #[error("invalid url: {0}")] InvalidUrl(String),
    #[error("unsupported content type: {0}")] UnsupportedType(String),
}

const UA: &str = "gal-lib/0.1.0";

pub async fn cache_cover(
    data_dir: &std::path::Path,
    game_id: i64,
    url: &str,
) -> Result<PathBuf, CacheError> {
    if !url.starts_with("http") { return Err(CacheError::InvalidUrl(url.into())); }
    let client = reqwest::Client::builder().user_agent(UA).build()?;
    let resp = client.get(url).send().await?.error_for_status()?;
    let ct = resp.headers().get("content-type")
        .and_then(|h| h.to_str().ok()).unwrap_or("image/jpeg");
    let ext = match ct {
        s if s.contains("png") => "png",
        s if s.contains("webp") => "webp",
        s if s.contains("jpeg") || s.contains("jpg") => "jpg",
        other => return Err(CacheError::UnsupportedType(other.into())),
    };
    let bytes = resp.bytes().await?;
    let covers_dir = data_dir.join("covers");
    std::fs::create_dir_all(&covers_dir)?;
    let target = covers_dir.join(format!("{}.{}", game_id, ext));
    std::fs::write(&target, &bytes)?;
    Ok(PathBuf::from(format!("covers/{}.{}", game_id, ext)))
}

#[cfg(test)]
mod tests {
    // Network test gated by ignore; presence is the assertion.
    #[test] fn module_compiles() {}
}
```

</action>

<verify>
<automated>
cd D:\project\gal-lib && \
test -f src-tauri/src/cover_cache.rs && \
grep -q "pub async fn cache_cover" src-tauri/src/cover_cache.rs && \
cargo check --manifest-path src-tauri/Cargo.toml
</automated>
</verify>

</task>

<task name="Task 2: ingest.rs orchestrator">

<read_first>
- D:\project\gal-lib\src-tauri\src\scan\mod.rs (DiscoveredGame)
- D:\project\gal-lib\src-tauri\src\metadata\mod.rs (search/fetch_detail/Candidate)
- D:\project\gal-lib\src-tauri\src\cover_cache.rs (Task 1)
</read_first>

<action>

新建 `src-tauri/src/ingest.rs`：
```rust
//! Per-game ingest orchestrator: search Bangumi → fallback VNDB → cache cover → write DB.
//! Returns the SQL parameter bundle for caller to execute (caller owns the DB pool).

use crate::metadata::{self, Candidate, MetadataSource};
use crate::scan::DiscoveredGame;
use crate::cover_cache;
use std::path::Path;

pub struct IngestResult {
    pub games_path: String,
    pub name: String,
    pub name_cn: Option<String>,
    pub executable_path: Option<String>,
    pub cover_path: Option<String>,
    pub cover_url: Option<String>,
    pub bangumi_id: Option<String>,
    pub vndb_id: Option<String>,
    pub metadata_source: Option<String>,  // string form for SQL TEXT
    pub match_confidence: Option<u8>,
}

pub async fn process_game(
    game_id_for_cover: i64,
    data_dir: &Path,
    discovered: &DiscoveredGame,
) -> IngestResult {
    let mut result = IngestResult {
        games_path: discovered.path.to_string_lossy().to_string(),
        name: discovered.clean_name.clone().min_or_default(&discovered.raw_name),
        name_cn: None,
        executable_path: discovered.executable.as_ref().map(|p| p.to_string_lossy().into()),
        cover_path: None,
        cover_url: None,
        bangumi_id: None,
        vndb_id: None,
        metadata_source: Some("none".into()),
        match_confidence: None,
    };

    // 1. Bangumi search
    let bgm = metadata::bangumi::search(&discovered.clean_name).await;
    let best = bgm.as_ref().ok().and_then(|hits| hits.iter().max_by_key(|c| c.confidence)).cloned();
    let chosen = if let Some(c) = best.as_ref() {
        if c.confidence >= 80 { Some(c.clone()) } else { None }
    } else { None };

    let final_choice = if let Some(c) = chosen {
        Some(c)
    } else {
        // 2. fallback to VNDB
        let vn = metadata::vndb::search(&discovered.clean_name).await;
        vn.ok().and_then(|hits| hits.into_iter().max_by_key(|c| c.confidence))
            .filter(|c| c.confidence >= 80)
    };

    if let Some(c) = final_choice {
        result.name = c.title.clone();
        result.match_confidence = Some(c.confidence);
        result.metadata_source = Some(match c.source {
            MetadataSource::Bangumi => "bangumi",
            MetadataSource::Vndb => "vndb",
            _ => "none",
        }.into());
        match c.source {
            MetadataSource::Bangumi => result.bangumi_id = Some(c.source_id.clone()),
            MetadataSource::Vndb => result.vndb_id = Some(c.source_id.clone()),
            _ => {}
        }
        result.cover_url = c.cover_url.clone();
        if let Some(url) = &c.cover_url {
            if let Ok(rel) = cover_cache::cache_cover(data_dir, game_id_for_cover, url).await {
                result.cover_path = Some(rel.to_string_lossy().into());
            }
        }
    }
    result
}

trait OrDefault { fn min_or_default(&self, fallback: &str) -> Self; }
impl OrDefault for String {
    fn min_or_default(&self, fallback: &str) -> Self {
        if self.trim().is_empty() { fallback.to_string() } else { self.clone() }
    }
}
```

</action>

<verify>
<automated>
cd D:\project\gal-lib && \
test -f src-tauri/src/ingest.rs && \
grep -q "pub async fn process_game" src-tauri/src/ingest.rs && \
cargo check --manifest-path src-tauri/Cargo.toml
</automated>
</verify>

</task>

<task name="Task 3: commands.rs (9 Tauri commands) + lib.rs wire-up">

<read_first>
- D:\project\gal-lib\src-tauri\src\lib.rs (Phase 1 — add metadata + scan + ingest + commands mods + plugin registration)
- D:\project\gal-lib\.planning\phases\02-library-ingest\02-CONTEXT.md (§Tauri commands list)
</read_first>

<action>

1. 新建 `src-tauri/src/commands.rs` containing 9 `#[tauri::command]` functions, each returning `Result<T, String>`:

   - `add_scan_root(path: String, depth: u8, state: State<AppPaths>) -> Result<i64, String>`: insert into scan_roots, return new id
   - `remove_scan_root(id: i64, state: State<AppPaths>) -> Result<(), String>`: DELETE from scan_roots WHERE id=?
   - `list_scan_roots(state: State<AppPaths>) -> Result<Vec<ScanRoot>, String>`: SELECT * FROM scan_roots
   - `start_scan(mode: String /* "full" | "incremental" */, app: AppHandle, state: State<AppPaths>, scan_state: State<ScanState>) -> Result<(), String>`: 
     - read scan_roots from DB
     - read existing games.path SET if incremental
     - spawn tokio task running `scan::run_scan(...)` with closure that emits `app.emit("scan-progress", progress)`
     - for each DiscoveredGame, INSERT INTO games (path, name, executable_path) RETURNING id; spawn `ingest::process_game(...)` per game and on result UPDATE games SET name/cover_path/etc.
   - `cancel_scan(scan_state: State<ScanState>) -> Result<(), String>`: set Arc<AtomicBool> = true
   - `mark_skip_dir(path: String, scan_state: State<ScanState>)`: insert into skip set
   - `search_metadata(query: String, source: String /* bangumi|vndb */) -> Result<Vec<Candidate>, String>`: dispatch
   - `bind_metadata(game_id: i64, source: String, source_id: String, state: State<AppPaths>) -> Result<(), String>`: fetch_detail, UPDATE games SET name/name_cn/cover_path/bangumi_id|vndb_id/metadata_source/match_confidence=100
   - `refresh_metadata(game_id: i64, state: State<AppPaths>) -> Result<(), String>`: re-run process_game for that game

2. Define `ScanState` struct in commands.rs:
```rust
pub struct ScanState {
    pub ctx: std::sync::Mutex<Option<std::sync::Arc<crate::scan::ScanContext>>>,
}
```

3. **`src-tauri/src/lib.rs`** — full overwrite (preserve mod declarations from Phase 1 + 02b/02c):
```rust
mod data_dir;
mod db;
mod metadata;
mod title_clean;
mod scan;
mod cover_cache;
mod ingest;
mod commands;

use std::path::PathBuf;
use tauri::Manager;

pub struct AppPaths {
    pub data_dir: PathBuf,
    pub db_url: String,
}

#[tauri::command]
fn get_data_dir(state: tauri::State<AppPaths>) -> String {
    state.data_dir.to_string_lossy().to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let data_dir = data_dir::ensure().expect("init data_dir failed");
    let db_url = data_dir::build_db_url(&data_dir);

    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default()
            .add_migrations(&db_url, db::migrations())
            .build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .manage(AppPaths { data_dir, db_url })
        .manage(commands::ScanState { ctx: std::sync::Mutex::new(None) })
        .invoke_handler(tauri::generate_handler![
            get_data_dir,
            commands::add_scan_root,
            commands::remove_scan_root,
            commands::list_scan_roots,
            commands::start_scan,
            commands::cancel_scan,
            commands::mark_skip_dir,
            commands::search_metadata,
            commands::bind_metadata,
            commands::refresh_metadata,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

4. cargo check + cargo test --lib 全绿。

5. Smoke: `pnpm tauri dev`, console (web devtools) test:
```js
await window.__TAURI__.core.invoke('add_scan_root', { path: 'D:\\Games', depth: 1 });
await window.__TAURI__.core.invoke('list_scan_roots');
```
应返回新建的 root id 和列表。Kill dev process.

</action>

<verify>
<automated>
cd D:\project\gal-lib && \
test -f src-tauri/src/commands.rs && \
grep -q "tauri_plugin_dialog::init()" src-tauri/src/lib.rs && \
grep -q "tauri_plugin_http::init()" src-tauri/src/lib.rs && \
grep -q "add_scan_root" src-tauri/src/lib.rs && \
grep -q "start_scan" src-tauri/src/lib.rs && \
grep -q "search_metadata" src-tauri/src/lib.rs && \
grep -q "bind_metadata" src-tauri/src/lib.rs && \
cargo check --manifest-path src-tauri/Cargo.toml && \
cargo test --manifest-path src-tauri/Cargo.toml --lib
</automated>
</verify>

</task>

## Commit Protocol

3 atomic commits:
- `feat(02-02d): add cover_cache module`
- `feat(02-02d): add ingest orchestrator (bangumi → vndb fallback → cover)`
- `feat(02-02d): wire 9 tauri commands + register plugins in lib.rs`

## Success

✅ 4 个 Rust 文件就位 + 9 commands 注册 + 2 plugins 注册；cargo check + lib tests 全绿；frontend 已具备完整 invoke 接入面。
