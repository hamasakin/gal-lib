# Milestones

## v1.0 v1.0 MVP (Shipped: 2026-05-07)

**Phases completed:** 5 phases, 29 plans, 36 tasks

**Key accomplishments:**

- 前端：
- Task 1 产物：
- Task 1 产物：
- `src-tauri/tauri.conf.json`
- Task 1 产物：
- 一次性铺设 Phase 2 全部 Rust crates / npm packages / Tauri capabilities / 9 shadcn blocks / DB schema v2 迁移；Wave 2-6 plan 直接消费、零文件冲突。
- 落地 metadata 子系统纯逻辑层 — title 清洗 + Levenshtein 模糊评分 + Bangumi/VNDB 双源 client + governor 限速器 + 指数退避重试；02d 编排器消费这些模块。
- 落地 Rust 后端文件系统扫描引擎 — walkdir 严格深度遍历做"第 N 层 = 1 款游戏"边界识别 + 启发式 exe 打分 + 注入式进度回调 + cancel/skip/增量三件套；02d 包装为 Tauri command 即可上层消费。
- TBD — written incrementally; full one-liner appended after Task 3 lands.
- Frontend Tauri-invoke wrapper layer (scan.ts + metadata.ts) + Zustand library store + Phase 1 Settings placeholder replaced by UI-SPEC-compliant root-list CRUD page with scan-trigger buttons; Phase 2 frontend pipeline now end-to-end addressable from JS.
- Phase 2 frontend complete — Library route replaced with sticky ScanProgressBar + virtualized GameGrid (3:4 cover cards with right-click DropdownMenu) + MetadataPicker dialog (Bangumi/VNDB search with debounced 400ms input + direct-ID binding); 11th Tauri command `list_games` wired; global scan-progress event subscription in main.tsx feeds Zustand store; tailwind tokens `aspect-cover` + `text-h3` added per UI-SPEC.
- 1. [Rule 1 – Bug] Test assertion counted `ADD COLUMN` substring inside SQL comment
- Locale Emulator path discovery (registry → common paths → PATH) with config.json-backed persistence — provides `detect_le_path`, `resolve_le_path`, and `set_le_path` for 03d's command layer.
- Win32-async process watcher (`spawn_le` / `find_game_pid` / `wait_for_exit` / `kill_pid`) + SQLite session state machine (`start → running → {completed, cancelled, launch_failed}`) — provides the playtime accounting primitives 03d will compose into `launch_game`.
- 1. [Rule 3 - Blocking] Watcher task can't move `State<'_, ActiveSessionState>` into spawn
- Tauri 2 `TrayIconBuilder` registered in setup hook with 「显示主窗口」/「退出应用」 menu, left-click restores window, close-to-tray intercepts `WindowEvent::CloseRequested` (background timing preserved), graceful quit cancels active session before `app.exit(0)`.
- Wired the 7 launch/session Tauri commands + 2 lifecycle events into the React UI, surfacing a sticky ActiveSessionBar, per-card 启动/强制结束 affordances, a minimal /games/:id detail page (cover + total time + LE config + sessions list), Settings LE path override, and the first-time close-to-tray toast — completing the Phase 3 user-facing surface.
- Phase-4 lockup — SQLite migration 0004 adds `brand` / `release_year` / `is_favorite` to `games` (schema_version → 4), plus 4 new shadcn UI primitives (textarea, tabs, popover, command — pulling input-group transitively) and react-markdown + remark-gfm npm deps for downstream Detail/Library/Settings polish plans (04b–04f).
- Add 13 Tauri commands (search/sort/filter, tag CRUD, per-property game updates) and extend `Game` struct + `list_games` to serialize schema-v4 columns (brand, release_year, is_favorite); commands grow 19 → 32, all 37 lib tests still green.
- Wire the 13 new 04b Tauri commands into TS-side invoke wrappers across `src/lib/{search,tags,games}.ts`, extend the `Game` type with v4 fields (brand / release_year / is_favorite), and grow `useLibraryStore` with searchQuery/sortBy/filter/tags/sidebar slices — `pnpm typecheck` clean, no UI components touched (04d/04e/04f own UI).
- Build the Library top bar (SearchBar with 200ms debounce + SortSelect + FilterChip), fully rewrite the Sidebar with auto-categories (全部 / 收藏 / 通关状态 / 标签 / 品牌 / 年代) wired to `store.filter`, extend GameCard's right-click menu with 收藏 toggle + 通关状态 submenu, and refactor `Library.tsx` so a single effect re-runs `searchGames(query, sort, filter)` whenever the store changes — `pnpm typecheck` + `vite build` clean.
- [Plan-permitted] Theme switch implemented as disabled hint span, not Switch
- Land Phase 5 lockup — SQLite schema v5 (2 game columns + screenshots/save_backups tables w/ CASCADE FK), Rust capture/encode crates (screenshots 0.8, png 0.17), and recharts 2.15.4 — so 05b/05d/05e can implement stats, screenshot capture, and save backups without further dep churn.
- Wire the Phase 5 backend — `screenshot::capture_to_disk` (Screen→png crate stream), `save_backup::{create,restore,delete}` (walkdir recursive copy), launch-time tokio interval task that captures the screen every N seconds with an `Arc<AtomicBool>` cancel flag, and 12 new Tauri commands so 05c/05d/05e can build the Stats page + Detail screenshot/save tabs.
- `src/routes/Stats.tsx`
- Extended Detail.tsx from 5 to 7 tabs by adding ScreenshotsTab (3-col thumbnail grid + click-to-lightbox + hover export/delete) and SavesTab (save_path picker + backup-now + restorable backup table), plus a 截图间隔 Select in the 设置 tab.

---
