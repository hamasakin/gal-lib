---
quick_id: 260525-tw2
slug: register-v13-migration
status: complete
completed_at: "2026-05-25T13:50:00Z"
requirements:
  - QUICK-260525-tw2
tags:
  - bugfix
  - migration
  - tauri-plugin-sql
  - schema
files_modified:
  - src-tauri/src/db.rs
commits:
  - 3ec6fc5
duration_minutes: 5
tasks_total: 1
tasks_completed: 1
---

# Quick 260525-tw2 — Register v13 migration

## One-liner

补登记上一轮 Quick 260525-g1m 漏挂的 v13 migration（`0013_add_external_rating.sql`），让旧库启动时自动从 schema v12 升到 v13、把 `external_rating` 三列与索引创建出来。

## Root cause（来自上游已锁定的诊断）

v0.3.1 出包带了 `src-tauri/migrations/0013_add_external_rating.sql`，但 `src-tauri/src/db.rs::migrations()` 的 vec 漏注册 v13 entry。tauri-plugin-sql 只跑 vec 里登记过的 migration —— 旧库 schema_version 卡在 12，games 表缺三列；`search_games` 的 SELECT 触到缺失列直接 Err，前端 Library.tsx:340-343 catch 块只 console.error 不清空 store.games，于是用户看到「分类侧栏条目数正常但游戏列表全空」。

## Fix（一处文件、三处定向追加）

`src-tauri/src/db.rs`：

1. **module-doc 末段**：追加 v13 描述（3 行），与 v1-v12 同型；
2. **const 块末尾**：`const V13_SQL: &str = include_str!("../migrations/0013_add_external_rating.sql");`
3. **`migrations()` vec 末尾**（v12 entry 之后、`]` 之前）：
   ```rust
   Migration {
       version: 13,
       description: "add_external_rating",
       sql: V13_SQL,
       kind: MigrationKind::Up,
   },
   ```

SQL 文件、`commands.rs` 的 SELECT 列、前端 catch 行为、release 脚本均**未触碰**。

## Verification

| Gate | Result |
|------|--------|
| `grep -c "version: 13" src-tauri/src/db.rs` | 1 ✅ |
| `grep -c "V13_SQL" src-tauri/src/db.rs` | 2 ✅（const + Migration entry） |
| `grep -c "0013_add_external_rating.sql" src-tauri/src/db.rs` | 1 ✅ |
| `cd src-tauri && cargo check` | `Finished dev profile`，无 error；6 个 pre-existing warning 与本任务无关；`V13_SQL` 不在 unused 名单里（即被 Migration entry 真实引用）✅ |
| git diff scope | 唯一改动文件 `src-tauri/src/db.rs`，+10 lines / -0 lines，全部位于 module-doc 末段 / const 块末尾 / vec 末尾三处定向追加；v1-v12 const、v1-v12 vec entry、所有 `#[test]` 块未变 ✅ |

## GUI verification: PENDING USER

GUI behavior（列表恢复显示）not verified by executor — sub-agent cannot run the Tauri app.

User must restart the v0.3.2 build and confirm games list re-populates after the v13 migration auto-runs.

具体真机验证步骤（用户在新 build 出来后执行）：

1. 装新 build（覆盖装或新装均可），用一份已经在 v0.3.0/v0.3.1 跑过、schema_version=12 且有数据的旧库；
2. 启动应用 → tauri-plugin-sql 应自动跑 v13 migration（不可见，但 sqlite `app_meta.schema_version` 会从 12 变 13）；
3. 进入 Library 页 → 游戏列表应恢复显示（不再空数组）；
4. 进入 Settings → 点「刷新元数据」→ 等回填完成 → 回 Library 用 SortSelect 切到「评分」→ 列表按 external_rating DESC 排序生效；
5. 详情页顶部 Pill / 信息侧栏「官方评分」字段应在刷新过元数据后显示数值。

只有用户在真机走过 1-3 步并确认 Library 列表恢复，才能宣布根因被堵住、后续才走 `npm run release patch` 发 v0.3.2。

## Stance

- **本任务交付的是 code-level fix landed + cargo check green**；
- **不是** "fix verified end-to-end" / "已根治"；
- 不发版（v0.3.2 由主对话在用户真机验证 OK 后由用户/主对话执行 `npm run release patch`）。

## Self-Check: PASSED

- File `src-tauri/src/db.rs` exists with all 3 directed additions: FOUND
- Commit `3ec6fc5` exists in `git log`: FOUND
- SUMMARY file at `.planning/quick/260525-tw2-register-v13-migration/260525-tw2-SUMMARY.md`: WRITTEN
