---
phase: quick-260710-8le
plan: 01
subsystem: metadata
tags: [vndb, bangumi, title-fallback, ingest, ui]
requires:
  - games 表 name/name_cn 两列 + displayGameName 两级回退契约
provides:
  - VNDB titles[] 语言优先级选择器 pick_zh_title / pick_fallback_title
  - Candidate.title_cn 字段贯通后端 scan 路径与前端候选卡片
affects:
  - src-tauri/src/metadata/vndb.rs
  - src-tauri/src/metadata/bangumi.rs
  - src-tauri/src/metadata/types.rs
  - src-tauri/src/ingest.rs
  - src/lib/metadata.ts
  - src/components/library/MetadataPicker.tsx
  - src/components/library/ReviewQueue.tsx
tech-stack:
  added: []
  patterns:
    - "纯函数语言优先级选择器 + 引用先算后 move 规避所有权冲突"
key-files:
  created: []
  modified:
    - src-tauri/src/metadata/types.rs
    - src-tauri/src/metadata/vndb.rs
    - src-tauri/src/metadata/bangumi.rs
    - src-tauri/src/ingest.rs
    - src/lib/metadata.ts
    - src/components/library/MetadataPicker.tsx
    - src/components/library/ReviewQueue.tsx
decisions:
  - "回退顺序落地方式：不改 displayGameName 两级回退契约，改为 name_cn=中文、name=日文优先其次英文，两级回退天然得三级优先级"
  - "评分池保持不变（顶层 hit.title + 全部 titles 别名），展示 title 与打分解耦，confidence 不受影响"
  - "不做数据库迁移：老条目重绑定或重扫后才套用新顺序（refresh_metadata_smart 已绑定路径刻意不写 name/name_cn）"
metrics:
  duration: ~8min
  completed: 2026-07-10
---

# Quick 260710-8le: 标题语言回退顺序 中文>日文>英文 Summary

修正 VNDB 元数据抓取/匹配时标题回退顺序为 中文 > 日文 > 英文（此前 中文 > 英文，跳过日文原名直接用罗马字/英文 main title）；顺带统一 scan 自动入库与手动绑定两条写库路径的 name/name_cn 列语义。

## What Changed

### Task 1 — 后端语言优先级选择器 + title_cn 贯通 (commit 6ea6f24)

- **types.rs**：`Candidate` 新增 `pub title_cn: Option<String>`（中文名），语义与已有 `MetadataDetail.title_cn` 对齐。
- **vndb.rs**：新增两个纯函数（含单元测试）：
  - `pick_zh_title(&[TitleEntry]) -> Option<String>`：zh-Hans 优先，其次 zh-Hant，都无 None。
  - `pick_fallback_title(&[TitleEntry], main) -> String`：ja 优先，其次 en，都无回退顶层 `main`。
  - `search` / `fetch_detail` 接入 helper：`title=pick_fallback_title(...)`、`title_cn=pick_zh_title(...)`，删除 fetch_detail 内联的 title_cn find 块。所有权处理：按 `hit.titles.as_deref().unwrap_or(&[])` 引用先算好 title/title_cn，再让 titles move 进 alias / 让 hit.title 被 move。
- **bangumi.rs** `search`：拆分 `title=s.name`（原名/日文）+ `title_cn=s.name_cn.filter(非空)`（中文），与 fetch_detail 列语义对齐（此前把 `name_cn || name` 塞进单个 title、title_cn 为空，导致 scan 时中文落到 name 列、name_cn 空）。fetch_detail 不改（已正确）。
- **ingest.rs**：`process_game` 与 `process_game_cached` 两处 auto-bind 各补 `result.name_cn = c.title_cn.clone()`，让 scan 把中文写进 name_cn 列。

### Task 2 — 前端候选卡片中文优先显示 (commit 760e925)

- **metadata.ts**：`Candidate` 接口新增 `title_cn: string | null`（镜像后端 Option）。
- **MetadataPicker.tsx**：卡片标题、`title` tooltip、hover 聚合串、SafeImage `alt` 四处改为 `c.title_cn ?? c.title`（Task 1 后 title 变日文/罗马字，候选卡需优先中文才不回退 UX）。
- **ReviewQueue.tsx**：候选标题 `{candidate.title_cn ?? candidate.title}`。

## Verification

- `cargo test --lib metadata::vndb` — 3 passed（新增 `pick_zh_title_prefers_hans_then_hant`、`pick_fallback_title_prefers_ja_then_en_then_main` 全绿）。
- `cargo check` — 0 error（6 条 pre-existing dead-code warning，与本次无关）。
- `tsc --noEmit` — EXIT=0。
- `vite build` — built in 3.43s，0 error。

逻辑核对：VNDB 无中文有日文的条目 → name_cn=None、name=日文 → displayGameName 返回日文（此前返回英文/罗马字）。

## Deviations from Plan

None - plan executed exactly as written。

## Migration Note

已入库游戏标题不会自动更新：`refresh_metadata_smart` 已绑定路径刻意不写 name/name_cn（保住用户手改名字）。用户需对该游戏「重新绑定元数据」（走 bind_metadata）或删除后重扫，才套用新回退顺序。本计划不做数据库迁移。

## Self-Check: PASSED

- 文件存在：types.rs / vndb.rs / bangumi.rs / ingest.rs / metadata.ts / MetadataPicker.tsx / ReviewQueue.tsx 均已修改并提交。
- 提交存在：6ea6f24（Task 1）、760e925（Task 2）。
