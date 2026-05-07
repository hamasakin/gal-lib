---
phase: 05-stats-media
status: human_needed
date: 2026-05-08
score: 7/7 must-haves automated coverage; manual GUI smoke deferred
---

# Phase 5 Verification Report

## Goal Achievement Summary

Phase 5 交付 stats + media 子系统：游玩时长趋势图 + Top games 排行 + 自动截图 + 存档备份/恢复。Schema 升到 v5；12 个新 Tauri commands（共 44）；2 个新前端组件 (ScreenshotsTab + SavesTab) + 1 新路由 (/stats)；Detail 页扩到 7 tabs。41/41 Rust 单元测试通过。

## Must-Have Coverage

| # | Requirement | Evidence | Status |
|---|---|---|---|
| 1 | **STATS-01** 每日/每周/每月游玩时长趋势图 | `commands::get_playtime_trend` SQL GROUP BY date/week/month；前端 Stats.tsx AreaChart with period select | ✅ |
| 2 | **STATS-02** 按游戏的总时长 Top N 分布 | `commands::get_top_games(limit)` ORDER BY total_playtime_sec DESC LIMIT；前端 Stats.tsx BarChart Top 15 | ✅ |
| 3 | **SHOT-01** 游戏运行期间自动收集截图 | `screenshot::capture_to_disk` (screenshots crate + png encoder)；`launch::orchestrator` 在 mark_running 后 spawn tokio interval task（每 N 秒，N=games.screenshot_interval_sec，默认 300s，最小 60s，0=禁用）；session 结束时 cancel flag flips, task aborts；图存 `data/screenshots/{game_id}/{ts}.png` + INSERT screenshots row | ✅ |
| 4 | **SHOT-02** 详情页查看 / 导出 / 删除截图 | `commands::get_screenshots/delete_screenshot/export_screenshot`；前端 ScreenshotsTab.tsx 3-col grid + lightbox Dialog + 导出 (save dialog) + 删除 (AlertDialog confirm) | ✅ |
| 5 | **SAVE-01** 用户可配置存档目录 | `commands::set_save_path/get_save_path`；前端 SavesTab.tsx 含存档目录 Input + "选择..." button (tauri-plugin-dialog directory mode) | ✅ |
| 6 | **SAVE-02** 触发存档备份（带时间戳） | `commands::create_save_backup` → `save_backup::create_backup` (walkdir + std::fs::copy 递归) → `data/saves/{game_id}/{ts}/` + INSERT save_backups (file_count + total_size_bytes) | ✅ |
| 7 | **SAVE-03** 历史备份列表 + 恢复 + 删除 | `commands::list_save_backups/restore_save_backup/delete_save_backup`；前端 SavesTab.tsx 4-col table (时间/文件数/大小/操作) + 恢复 confirm + 删除 confirm | ✅ |

**Score: 7/7 covered ✅**

## Cross-cutting Assertions

| Check | Result |
|---|---|
| `pnpm tsc --noEmit` | ✅ exit 0 |
| `pnpm vite build` | ✅ green (recharts + 7-tab Detail + 2 new tabs) |
| `cargo check` | ✅ exit 0 |
| `cargo test --lib` | ✅ 41/41 passed (38 prior + 3 new save_backup round-trip tests) |
| Schema v5 migration | ✅ 2 ALTER TABLE games + 2 CREATE TABLE + 2 INDEX; schema_version 4 → 5 |
| 44 Tauri commands registered | ✅ via grep on lib.rs (32 P1-P4 + 12 P5) |
| 2 new Rust crates (screenshots + png) + recharts npm | ✅ |
| Locked Chinese copy strings | ✅ all sections (CONTEXT) verbatim |

## Human Verification Items (deferred)

These need a real galgame + GUI interaction. None block phase progression.

| # | Item |
|---|---|
| 1 | Stats /stats route renders trend chart + top games chart with real data |
| 2 | Period select toggles daily/weekly/monthly aggregation |
| 3 | Game launch → screenshot interval task fires → screenshots accumulate in data/screenshots/{id}/ |
| 4 | Detail screenshots tab grid renders thumbnails; click → lightbox |
| 5 | Export screenshot to chosen path |
| 6 | Delete screenshot → AlertDialog confirm → file + DB row removed |
| 7 | Set save_path via directory dialog |
| 8 | 备份当前存档 button creates data/saves/{id}/{ts}/ with copied files |
| 9 | Backup list shows file_count + size; restore overwrites save_path |
| 10 | Delete backup removes both DB row and filesystem dir |

## Decision

🟡 **HUMAN-NEEDED** — 7/7 must-haves covered by code + tests; 10 GUI/integration items deferred.

This is the FINAL phase of the v1 milestone. Proceeding to milestone audit + complete-milestone + cleanup per autonomous mode.
