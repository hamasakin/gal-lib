---
gsd_quick_version: 1.0
slug: two-button-metadata-refresh
date: 2026-05-12
status: incomplete
---

# Quick 260513-3df — 两按钮统一刷新元数据入口

## One-liner

Settings「扫描操作」节 4 按钮（全量/增量/补全年份/强制刷新）合并为 2 按钮（全量扫描 + 刷新元数据），新建 IPC `refresh_metadata_smart`：未绑定行走模糊匹配、已绑定行按 source_id 直拉 detail（manual 安全）；同时彻底删除旧 `refresh_all_metadata` + `backfill_release_year`。

## Files Touched

| File | Δ |
|------|---|
| `src-tauri/src/commands.rs` | +305 / -241（净 +64：新 `refresh_metadata_smart` 函数体 ~310 行，删旧两函数 ~329 行，注释更新 ~3 处） |
| `src-tauri/src/lib.rs` | +3 / -2（invoke_handler 删 2 行旧注册，加 1 行新注册 + 注释） |
| `src/lib/scan.ts` | +9 / -9（refreshAllMetadata → refreshMetadataSmart + JSDoc 改写） |
| `src/lib/persons.ts` | +4 / -16（删 backfillReleaseYear export + 顶部 jsdoc 行；保留 cancelBackfill 加注释） |
| `src/routes/Settings.tsx` | +5 / -41（imports 改 1 行；2 handler → 1 handler；scan-ops Section 4 按钮 + AlertDialog → 2 按钮） |

## Commits

| Task | Subject | Hash |
|------|---------|------|
| 1 | quick(260513-3df): backend — add refresh_metadata_smart IPC, drop refresh_all_metadata + backfill_release_year | `429544d` |
| 2 | quick(260513-3df): frontend — 扫描操作节合并为 2 个按钮（全量扫描 + 刷新元数据） | `d2b4c41` |

## Verification

### Task 1 — `cd src-tauri && cargo check`

```
warning: `gal-lib` (lib) generated 5 warnings (run `cargo fix --lib -p gal-lib` to apply 2 suggestions)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 9.76s
```

0 errors. 5 warnings 全是预先存在（unused imports / dead code / unused mut，全在本次未触碰的文件）。

### Task 2 — `pnpm tsc --noEmit`

输出为空 → 0 errors。

### Grep gates（Task 1 done block）

```
pub async fn refresh_all_metadata count       → 0
pub async fn backfill_release_year count      → 0
pub async fn refresh_metadata_smart count     → 1
lib.rs commands::refresh_all_metadata, count  → 0
lib.rs commands::backfill_release_year, count → 0
lib.rs commands::refresh_metadata_smart, count → 1
```

### Grep gates（Task 2 done block）

```
scan.ts refreshAllMetadata count (no comments)         → 0
scan.ts refreshMetadataSmart count (no comments)       → 1   (function 定义；invoke 用 snake_case)
scan.ts refresh_metadata_smart count                   → 1   (invoke 字符串)
persons.ts backfillReleaseYear count (no comments)     → 1   (仅注释行，无 export)
Settings.tsx refreshAllMetadata count (no comments)    → 0
Settings.tsx backfillReleaseYear count (no comments)   → 0
Settings.tsx 增量扫描 count                            → 0
Settings.tsx 补全发行年份 count                        → 0
Settings.tsx 强制刷新全部元数据 count                  → 0
Settings.tsx onRefreshMetadata count (no comments)     → 2   (function 定义 + 调用)
Settings.tsx refreshMetadataSmart count (no comments)  → 2   (import + handler 内调用)
```

注：`scan.ts refreshMetadataSmart` 期望 ≥2 在 plan 写法上假定 invoke 也用 camelCase——但 Tauri IPC 命名约定 Rust 用 snake_case，所以实际是 `refreshMetadataSmart` 1 处（function）+ `refresh_metadata_smart` 1 处（invoke 字符串）。Plan 的 absent/contains artifact 检查（`export async function refreshMetadataSmart` / `invoke\("refresh_metadata_smart"`）全部命中。

`persons.ts backfillReleaseYear` 计数 1 是因为我在 `cancelBackfill` 的新 JSDoc 里用到了这个标识符做交叉引用（解释为什么 cancelBackfill 保留但 backfillReleaseYear 删掉）；这条 grep 用 `^//` 不过滤 JSDoc 的 ` *` 行所以会漏算。**实际没有 export**（`grep -nE "^export.*backfillReleaseYear" src/lib/persons.ts` → 0 hits）。

## Decisions Made

1. **已绑定行 release_year 用直接 `?` 覆盖，不走 COALESCE。** 与 quick 260513-2nx 的 `backfill_release_year`（仅在 `release_year IS NULL` 上填值）的 COALESCE 策略明确分道扬镳——用户主动点「刷新元数据」就期望拿到新值；summary 同理。brand/age_rating/cover_url 仍走 COALESCE 保护 manual 修改。
2. **已绑定行不动 cover_path。** 已绑定行的本地封面是 cover_cache 流程下载的本地路径；这里只 COALESCE 更新 cover_url（远端 url 可能换），把本地图保住——避免每次刷新都触发重新下载。未绑定行仍走 `ingest::refresh_for_query` → process_game → cover_cache 完整路径。
3. **已绑定行不动 bangumi_id / vndb_id / metadata_source / match_confidence / name / name_cn。** 这保住 manual 标记和用户改过的名字——「主动点刷新」预期是「更新内容」而不是「重置绑定」。
4. **`BackfillState` + `cancel_backfill` IPC 保留。** 当前没有 IPC 消费 BackfillState 的 cancel flag（refresh_metadata_smart 走 ScanState），但作为 Phase 13 资产 + 潜在未来 backfill 任务的前向兼容点保留；JSDoc / Rust doc 注释都明确了现状。
5. **`onScan` 函数保留通用 `"full" | "incremental"` 签名。** 即使 UI 只调用 `"full"`，函数本身没简化——便于未来重新加增量入口（如果需要的话）成本最小。

## Known Stubs

None.

## Task 3 — 人工 smoke pending

**状态：未执行（按 GSD orchestrator 约定，checkpoint:human-verify 留给用户手动验证）。**

### 验证步骤

1. `cd D:/project/gal-lib && pnpm tauri dev` 启动 app
2. 打开 Settings → 滚到「扫描操作」节，确认：
   - 只有 2 个按钮：**全量扫描**（primary 蓝） + **刷新元数据**
   - 没有「增量扫描」「补全发行年份」「强制刷新全部元数据」
   - 没有任何确认 AlertDialog（点「刷新元数据」直接执行，不弹框）
   - lede 文案：「全量扫描发现并匹配新游戏；刷新元数据对已收录游戏重抓元数据（已绑定的按 ID 直拉、未绑定的走模糊匹配）」
3. 点击「全量扫描」→ 跳到主页，ScanProgressBar 出现（旧路径未坏）
4. 回 Settings → 点「刷新元数据」：
   - toast「刷新元数据已启动」
   - 自动跳主页，ScanProgressBar / BackfillProgressBar 出现进度
   - 单卡片 meta-fetch 脉冲高亮（与旧 refresh_all_metadata 同 UX）
5. **挑一张 manual 绑定的游戏**（如果有的话）：
   - 刷新前后 SQL 比对：`SELECT id, name, bangumi_id, vndb_id, metadata_source FROM games WHERE metadata_source = 'manual';` 这 5 列**未变**
6. **挑一张已绑定但年份缺失**的游戏（260513-2nx 之前的历史绑定）：
   - 刷新后 `release_year` 已填上、`summary` 是新内容（直接覆盖）
7. 刷新中途点 ScanProgressBar 取消按钮（共享 cancel_scan）→ 进度条停止、显示 Cancelled
8. 再跑一次 `cd src-tauri && cargo check` + `pnpm tsc --noEmit` 都绿

### 预期结果

- Settings 仅剩 2 按钮（截图回复）
- manual 行的 metadata_source/bangumi_id/vndb_id/name 在刷新后未变（SQL 比对）
- 历史无年份行刷新后 release_year 填上
- 取消按钮工作

Resume signal：回复 "approved" + 2 按钮截图 + manual 不变的 SQL 比对（或描述）；或描述发现的问题。

## Self-Check

- 文件存在 — 全部 5 个修改的源文件存在于工作树（git status 已确认 clean）
- 提交存在：
  - `429544d` — backend (Task 1)
  - `d2b4c41` — frontend (Task 2)
- cargo check 0 errors / tsc 0 errors
- grep 检查全部通过（注：plan 中 2 项 grep 阈值与 Tauri snake_case IPC 命名约定不完全对齐，实际语义满足，已在 Verification 节解释）

## Self-Check: PASSED
