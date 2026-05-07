# Phase 2 Plan Outline

**Phase:** 02-library-ingest
**Goal:** 用户能将本地杂乱 galgame 目录扫描进库，每款游戏自动匹配封面和元数据，以封面网格呈现
**Phase req IDs:** SCAN-01..08, META-01..07, LIB-02, LIB-06 (17 IDs)

Plans are SERIAL (one per wave, like Phase 1) to avoid `package.json` / `Cargo.toml` / `lib.rs` / `Library.tsx` / `Settings.tsx` write races. CONTEXT.md and UI-SPEC.md already lock most decisions; plans are concise execution scripts.

| Plan | Objective | Wave | Depends On | Requirements |
|---|---|---|---|---|
| 02a | Schema v2 migration + dependency lockup (Rust crates + npm packages + 9 new shadcn blocks + Tauri plugins) | 1 | [] | (foundation) |
| 02b | Title cleaning + Bangumi client + VNDB client + rate limiter (Rust backend isolated module) | 2 | [02a] | META-01, META-02, META-03, META-07 |
| 02c | Scan engine + exe heuristic + scan progress events + cancel | 3 | [02a, 02b] | SCAN-01, SCAN-02, SCAN-03, SCAN-04, SCAN-05, SCAN-06, SCAN-08 |
| 02d | Cover cache + metadata orchestrator (per-game pipeline) + Tauri commands + register everything in lib.rs | 4 | [02a, 02b, 02c] | META-04, META-05, META-06, SCAN-07 |
| 02e | Settings page (scan_roots CRUD UI + scan trigger) + frontend Tauri invoke helpers + Zustand library store | 5 | [02a, 02d] | SCAN-01, SCAN-02 |
| 02f | Library route (GameGrid + GameCard + virtualization) + ScanProgressBar + MetadataPicker modal | 6 | [02a, 02d, 02e] | LIB-02, LIB-06, SCAN-03, SCAN-07, META-05, META-06 |

## Coverage Map

| REQ-ID | Plan |
|---|---|
| SCAN-01 (root dir add/remove) | 02e |
| SCAN-02 (per-root depth 1/2/3) | 02e (UI), 02c (apply during scan) |
| SCAN-03 (real-time progress) | 02c (emit), 02f (display) |
| SCAN-04 (Nth subdir = game) | 02c |
| SCAN-05 (exe heuristic) | 02c |
| SCAN-06 (skip/retry per dir) | 02c (skip during scan), 02f (retry per game card) |
| SCAN-07 (low-confidence picker) | 02d (decision logic), 02f (modal UI) |
| SCAN-08 (incremental skip) | 02c |
| META-01 (Bangumi) | 02b (client), 02d (orchestrator) |
| META-02 (VNDB fallback) | 02b (client), 02d (orchestrator) |
| META-03 (title clean) | 02b |
| META-04 (cover cache) | 02d |
| META-05 (manual ID bind) | 02d (Tauri cmd), 02f (modal) |
| META-06 (single re-fetch) | 02d (Tauri cmd), 02f (modal trigger) |
| META-07 (rate limit + retry) | 02b |
| LIB-02 (cover grid) | 02f |
| LIB-06 (virtualized grid) | 02f |

All 17 IDs covered.

## Cross-cutting Truths

- 用户在 Settings 添加 1+ 根目录 → "全量扫描" → 主区切到 GameGrid，扫描中顶部 ScanProgressBar 显示进度（current/total + 当前目录）；扫描完成卡片陆续出现，每张卡显示封面 + 标题 + 状态徽章；卡片支持右键"重新匹配元数据"
- 元数据低置信度（< 80）的卡片显示 `元数据获取中` 标记 + 重试按钮；点击或右键打开 MetadataPicker 显示候选 + 直接 ID 绑定
- 增量扫描跳过已存在的 `games.path`；SCAN-06 的"跳过本目录"立即生效不再处理
- portable 不变量延续：所有数据（DB、covers/、config）在 exe 同级 `data/`
- 单 exe 体积上涨预期 +5-10MB（reqwest+sqlx+walkdir 等 Rust 依赖）；仍 < 30MB 上限

## Cross-cutting Constraints

**File ownership zero conflict (per-wave):**
- `src-tauri/Cargo.toml`: 02a 一次性写入全部依赖（reqwest, walkdir, regex, governor, image, tokio）；后续 plan 不再动
- `package.json` / `pnpm-lock.yaml`: 02a 一次性写入全部新依赖（@tanstack/react-virtual、@tauri-apps/plugin-dialog、9 个 shadcn block deps）；后续 plan 不再动
- `src-tauri/capabilities/default.json`: 02a 一次性写入（dialog:default、http:default 内部 host scope）；后续 plan 不再动
- `src-tauri/src/lib.rs`: 02d 一次性写入所有 Tauri commands 注册（add_scan_root, remove_scan_root, get_scan_roots, start_full_scan, start_incremental_scan, cancel_scan, search_metadata, bind_metadata, refresh_metadata）；其他 plan 仅新增 mod 声明
- `src/routes/Settings.tsx`: 02e 完整覆写（包含 scan trigger）
- `src/routes/Library.tsx`: 02f 完整覆写（GameGrid + ScanProgressBar 嵌入）
- `tailwind.config.ts`: 02f 一次性追加 `aspect-cover` + `text-h3`；其他 plan 不动

## Schema v2 Diff (locked)

```sql
-- migration 0002_add_scan_and_metadata.sql

CREATE TABLE scan_roots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL UNIQUE,
  depth INTEGER NOT NULL DEFAULT 1 CHECK(depth IN (1, 2, 3)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE games ADD COLUMN cover_url TEXT;
ALTER TABLE games ADD COLUMN metadata_source TEXT;  -- 'bangumi' | 'vndb' | 'manual' | 'none'
ALTER TABLE games ADD COLUMN match_confidence INTEGER;  -- 0-100
ALTER TABLE games ADD COLUMN last_scanned_at TEXT;

UPDATE app_meta SET value = '2' WHERE key = 'schema_version';
```

## OUTLINE COMPLETE
Plans: 02a, 02b, 02c, 02d, 02e, 02f
