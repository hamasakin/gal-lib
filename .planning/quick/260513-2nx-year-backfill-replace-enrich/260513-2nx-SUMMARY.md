---
gsd_quick_version: 1.0
slug: year-backfill-replace-enrich
date: 2026-05-12
status: incomplete
---

# Quick 260513-2nx — `backfill_release_year` 替换 `backfill_metadata_enrichment`

## One-liner

新增 `backfill_release_year` 专用 IPC（仅回灌 `release_year`，按 source_id 直连 `fetch_detail`，对 manual 绑定零损伤）+ Settings 「补全发行年份」按钮；同时彻底删除旧 `backfill_metadata_enrichment` 全套代码（Rust fn + Tauri 注册 + TS wrapper + Settings handler/按钮/文案）。

## Files touched

| File | Δ Lines | Change |
| ---- | ------- | ------ |
| `src-tauri/src/commands.rs` | -209 / +49（净 -117 + 57 insertions / commit stat） | 删除 `backfill_metadata_enrichment` 整个 fn（~210 行）+ 新增 `backfill_release_year`（~110 行），并清除 3 处注释中的旧标识符提及 |
| `src-tauri/src/lib.rs` | -1 / +1 | invoke_handler! 注册行替换 |
| `src/lib/persons.ts` | -10 / +13 | wrapper 替换 + 顶部模块 doc-comment 同步 |
| `src/routes/Settings.tsx` | -7 / +7 | import + handler + 按钮 + lede + AlertDialog 文案全部更新 |

**Git diff stat (两次 commit 合并)：**
- Backend commit `db542f9`: 2 files changed, 57 insertions(+), 117 deletions(-)
- Frontend commit `dd06714`: 2 files changed, 20 insertions(+), 17 deletions(-)

## Commits

| Task | Commit | Message |
| ---- | ------ | ------- |
| Task 1 (backend) | `db542f9` | `quick(260513-2nx): backend — add backfill_release_year IPC, remove backfill_metadata_enrichment` |
| Task 2 (frontend) | `dd06714` | `quick(260513-2nx): frontend — replace 「补全简介…」按钮 with 「补全发行年份」` |

## Verification outputs

### Task 1 — `cargo check` (cd src-tauri)

```
warning: `gal-lib` (lib) generated 5 warnings (run `cargo fix --lib -p gal-lib` to apply 2 suggestions)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 1.92s
```

0 error。5 个 warning 全在本次未触及的文件中（`src/metadata/mod.rs` unused import、`src/title_clean.rs` unused_mut、`src/ingest.rs` IngestResult.executable_path、`src/launch/orchestrator.rs` OrchError::AlreadyActive、`src/metadata/types.rs` MetadataError::RateLimited），与本次改动无关 — pre-existing tech debt（Rule 4 范围外，未触碰）。

### Task 1 — grep 校验

```text
$ grep -rn "backfill_metadata_enrichment" src-tauri/src/
(no matches — fn + 注册行 + 所有注释引用均消失)

$ grep -rn "backfill_release_year" src-tauri/src/
src-tauri\src\lib.rs:253:            commands::backfill_release_year,
src-tauri\src\commands.rs:72:/// `backfill_release_year`) fire-and-forgets a single tokio task; the
src-tauri\src\commands.rs:3038:// `backfill_release_year` migration helper (quick 260513-2nx — replaced the
src-tauri\src\commands.rs:3499:pub async fn backfill_release_year(
src-tauri\src\commands.rs:3637:/// running (flag just sits true until the next `backfill_release_year`

$ grep -n "commands::cancel_backfill" src-tauri/src/lib.rs
258:            commands::cancel_backfill,        # 保留未动 ✓
```

### Task 2 — `pnpm tsc --noEmit`

```
(zero output — 零 error)
```

### Task 2 — grep 校验

```text
$ grep -rn "backfillMetadataEnrichment|onBackfillEnrichment|补全简介" src/
(no matches — 全部三处旧标识符 / 文案绝迹)

$ grep -rn "backfillReleaseYear|补全发行年份" src/
src\routes\Settings.tsx:58:import { backfillReleaseYear } from "@/lib/persons";
src\routes\Settings.tsx:271:      await backfillReleaseYear();
src\routes\Settings.tsx:272:      toast.info("已开始补全发行年份 — 后台运行，受 API 限速影响可能耗时数分钟");
src\routes\Settings.tsx:495:            lede="…· 补全发行年份只对历史绑定但缺年份的游戏拉取（不改其它字段）"
src\routes\Settings.tsx:506:                补全发行年份
src\routes\Settings.tsx:518:                      …请使用「补全发行年份」按钮。
src\lib\persons.ts:9: *   - `backfill_release_year()` — 补全发行年份（仅 release_year，对 manual 绑定无损）
src\lib\persons.ts:171:export async function backfillReleaseYear(): Promise<void> {
```

`补全发行年份` 在 Settings.tsx 命中 4 处（lede / 按钮 / toast / AlertDialog） — done 标准要求 ≥2 满足。

## Done criteria checklist

Task 1 done:
- [x] cargo check 通过（0 error）
- [x] `grep backfill_metadata_enrichment src-tauri/src/` 完全为空
- [x] `grep "pub async fn backfill_release_year" src-tauri/src/commands.rs` 命中 1 行
- [x] `grep "commands::backfill_release_year" src-tauri/src/lib.rs` 命中 1 行
- [x] `grep "commands::cancel_backfill" src-tauri/src/lib.rs` 仍命中 1 行（未误删）
- [x] 新函数体 SQL UPDATE 只有一条且仅写 `release_year` + `last_scanned_at`

Task 2 done:
- [x] `pnpm tsc --noEmit` 通过
- [x] `grep "backfillMetadataEnrichment|onBackfillEnrichment|补全简介" src/` 完全为空
- [x] `grep backfillReleaseYear src/lib/persons.ts` 命中（导出存在）
- [x] `grep backfillReleaseYear src/routes/Settings.tsx` 命中（import + handler 调用）
- [x] `grep 补全发行年份 src/routes/Settings.tsx` 命中 4 处（≥2 满足）

Task 3 (checkpoint:human-verify):
- [ ] **PENDING** — 启动 `pnpm tauri dev` 进 Settings 页人工验证（按钮可见 + BackfillProgressBar 工作 + DB 历史 NULL 行被回灌 + manual 绑定其它字段未动）

## Status

`incomplete` — Task 1 + Task 2 自动化全绿、提交完毕；Task 3 是 `checkpoint:human-verify`，已按指令不执行，留给用户进行真机 smoke。

**下一步：** 用户运行 `pnpm tauri dev`，按 PLAN Task 3 的 `<how-to-verify>` 7 步流程确认旧按钮消失 / 新按钮工作 / DB 回灌生效 / manual 绑定无副作用 → 通过后回复 `approved` 关闭此 quick 任务。

## Deviations

None — 严格按 PLAN 执行：
- 后端新 fn 签名、SQL filter、事件协议、cancel 复用均与 PLAN 完全一致
- 旧 fn 完整删除（连同 3 处注释中的字面引用，确保 grep 完全为空 — PLAN done 标准强要求）
- 前端 wrapper / handler / 按钮 / lede / AlertDialog 4 处文案逐一替换

## Self-Check: PASSED

- [x] `db542f9` 存在（`git log --oneline | grep db542f9` 命中）
- [x] `dd06714` 存在
- [x] `src-tauri/src/commands.rs` 包含 `pub async fn backfill_release_year`
- [x] `src-tauri/src/lib.rs:253` 含 `commands::backfill_release_year,`
- [x] `src/lib/persons.ts:171` 含 `export async function backfillReleaseYear`
- [x] `src/routes/Settings.tsx` 含 「补全发行年份」按钮文案
- [x] cargo check 0 error；pnpm tsc 0 error
