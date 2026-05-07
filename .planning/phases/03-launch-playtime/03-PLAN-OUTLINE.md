# Phase 3 Plan Outline

**Phase:** 03-launch-playtime
**Goal:** 用户能通过 LE 一键转区启动游戏，关掉游戏后自动记录本次会话时长，关闭主窗口后计时仍在后台持续
**Phase req IDs:** LAUNCH-01..05, TIME-01..05, TRAY-01..03 (13 IDs)

Plans are SERIAL (one per wave) per Phase 1/2 pattern.

| Plan | Objective | Wave | Depends On | Requirements |
|---|---|---|---|---|
| 03a | Schema v3 migration + new Rust crates (winreg, sysinfo, windows) + minimal Detail route placeholder | 1 | [] | (foundation) |
| 03b | LE detector (registry + path scan) + `launch::le::resolve_le_path` + Tauri command get_le_path / set_le_path | 2 | [03a] | LAUNCH-01 |
| 03c | Process tracking (process_track.rs with sysinfo + windows-rs WaitForSingleObject) + session lifecycle (start/end/cancel/launch_failed) | 3 | [03a, 03b] | LAUNCH-02, TIME-01, TIME-02, TIME-03 |
| 03d | Tauri commands (launch_game / end_active_session / get_active_session / list_sessions / update_game_launch_config) + lib.rs registration | 4 | [03a, 03b, 03c] | LAUNCH-03, LAUNCH-04, LAUNCH-05, TIME-04 |
| 03e | System tray (Tauri 2 TrayIconBuilder + close-to-tray + tray menu + tooltip update) + lib.rs setup hook | 5 | [03a] | TRAY-01, TRAY-02, TRAY-03, TIME-05 |
| 03f | Frontend: launchGame helper + ActiveSessionBar + GameCard launch button + Detail route (minimal: cover + title + total time + sessions list) + Settings LE path section | 6 | [03a, 03b, 03c, 03d, 03e] | LAUNCH-02..05, TIME-04, TRAY-01 |

## Coverage Map

| REQ-ID | Plan |
|---|---|
| LAUNCH-01 | 03b (detector + manual override) |
| LAUNCH-02 | 03c (LEProc spawn) + 03d (tauri command) + 03f (UI button) |
| LAUNCH-03 | 03d (update_game_launch_config) + 03f (Detail page profile select) |
| LAUNCH-04 | 03d (update_game_launch_config) + 03f (Detail page args/cwd input) |
| LAUNCH-05 | 03d (update_game_launch_config) + 03f (Detail page exe override) |
| TIME-01 | 03c (process tracking via sysinfo) |
| TIME-02 | 03c (LE-spawned process detection — orphan detection) |
| TIME-03 | 03c (session lifecycle: start_at / end_at / duration_sec / status / exit_code) |
| TIME-04 | 03d (list_sessions cmd) + 03f (Detail page sessions list) |
| TIME-05 | 03c (tokio task lifetime decoupled from webview) + 03e (tray keeps app alive after close) |
| TRAY-01 | 03e (TrayIconBuilder + icon.ico) |
| TRAY-02 | 03e (CloseRequested intercept + window.hide()) |
| TRAY-03 | 03e (tray menu: Show + Quit) |

All 13 IDs covered.

## Cross-cutting Truths

- 用户在 GameCard 卡片或详情页点"启动" → 后端拼 `LEProc -runas <profile> "<exe>"` + cwd → 拉起 LE → ActiveSessionBar 出现显示游戏名 + elapsed
- 关闭主窗口 → 隐藏到系统托盘（首次显示 toast「已最小化到系统托盘」+ "不再提示" 选项）；计时继续；托盘 tooltip 更新为 "gal-lib — 游玩中: {name} ({elapsed})"
- 游戏退出 → 自动写 sessions 行（status=completed, duration_sec, ended_at）+ 详情页"会话历史"列表 +1 条 + games.total_playtime_sec 累加
- 启动失败（30s 内未识别到目标进程）→ session.status=launch_failed + duration_sec=0 + ActiveSessionBar 退场 + toast.error
- 托盘右键 → "显示主窗口" / "退出应用"；左键单击 → 显示主窗口
- 退出应用 + active session → 先 graceful end session（写 elapsed 到 ended_at + status=cancelled）+ kill child process tree → app.exit(0)

## Cross-cutting Constraints

**File ownership zero conflict (per-wave):**
- `src-tauri/Cargo.toml`: 03a 一次性写入 (winreg, sysinfo, windows)；03e 不再动
- `src-tauri/src/db.rs`: 03a 追加 Migration v3
- `src-tauri/src/lib.rs`: 03d 追加 launch+session commands；03e 追加 tray + close interceptor；03d/03e 串行 wave 避免冲突
- `src/routes/Library.tsx`: 03f 追加 ActiveSessionBar 一行
- `src/routes/Settings.tsx`: 03f 追加 LE 路径 section
- `src/components/library/GameCard.tsx`: 03f 追加启动按钮
- `src/router.tsx`: 03f 追加 `/games/:id` 路由

## Schema v3 Diff

```sql
-- migration 0003_add_launch_and_session_status.sql
ALTER TABLE games ADD COLUMN le_profile TEXT NOT NULL DEFAULT 'Japanese';
ALTER TABLE games ADD COLUMN launch_args TEXT;
ALTER TABLE games ADD COLUMN cwd TEXT;
ALTER TABLE sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('starting','running','completed','launch_failed','cancelled'));
ALTER TABLE sessions ADD COLUMN exit_code INTEGER;
UPDATE app_meta SET value = '3' WHERE key = 'schema_version';
```

## OUTLINE COMPLETE
Plans: 03a, 03b, 03c, 03d, 03e, 03f
