---
id: 260515-prog
slug: prog-incremental-scan
description: 扫描流程区分"扫目录/抓元数据"两阶段 + 渐进式刷新游戏列表
date: 2026-05-15
status: complete
commits:
  - 08b7170
---

# Quick Task 260515-prog — SUMMARY

## 改了什么

### 1) `ScanProgress` 新增 `phase` 字段

**File:** `src-tauri/src/scan/types.rs`

加 `ScanPhase { Discovering, Enriching }` 枚举，`ScanProgress` 多带一个 `phase`。前端据此切文案——和 `ScanStatus` 正交：terminal 事件统一显示「扫描完成 — 共 N 款」，不再有「目录扫描完成 → 元数据获取完成」二段闪。

`scan/mod.rs::run_scan` 内部四个 emit 全部带 `Discovering`；测试 `scan::tests::*`（4 个）跑过。

### 2) `start_scan` 双阶段 + games-changed

**File:** `src-tauri/src/commands.rs`

- discovery 完成后，**先** emit Enriching transition 事件，再做 placeholder INSERT 循环；
- 每个 placeholder INSERT 成功后 emit `games-changed`（无 payload）；
- 并发 enrich 任务里 `apply_ingest_result` 之后 emit `games-changed`；
- 所有 enriching 阶段的 `scan-progress` 都带 `phase: Enriching`；终止事件 phase 继承上一次活动阶段（不影响 UI 行为）。

`refresh_metadata_smart` 同步：所有 scan-progress 带 `phase: Enriching`（这条路径只动元数据）+ 每条 UPDATE 后 emit `games-changed`。

### 3) 前端 lib/scan.ts 类型与订阅

**File:** `src/lib/scan.ts`

- `ScanProgress` 加 `phase: "discovering" | "enriching"`；
- 新增 `onGamesChanged(cb)` listener wrapper，payload 用 `unknown`（后端是 `()`）。

### 4) 进度条/实时日志区分文案

**Files:** `src/components/library/ScanProgressBar.tsx`、`src/components/library/ScanFeed.tsx`

- 进度条：`running + discovering` → `扫描目录中 — {dir}`；`running + enriching` → `获取元数据 — {dir}`；终止文案不变；
- ScanFeed 在 discovering→enriching 切换时 push 一条 `── 目录扫描完成 · 开始抓取元数据（共 N 款）`；
- enriching 阶段不再为 scan-progress 打 feed 行——meta-fetch-progress 自带友好游戏名，重复打反而把 200 行 buffer 灌满。

### 5) Library 渐进 refetch

**File:** `src/routes/Library.tsx`

新 useEffect 订阅 `games-changed`，600ms 节流（trailing fire 保最后一次落地）调 `refetchGrid + refreshSidebar`。原有 `running → completed` 边沿的完整 refresh（含 `refreshFilterOptions` + 扫描完成 toast）保留——节流路径只刷网格 + 侧栏，避免 toast 在扫描中途乱响。

### 实际效果

- 扫到一个 exe → placeholder INSERT → 600ms 内主界面卡片以「获取中」状态出现；
- 后台 enrich 完成一条 → UPDATE → 卡片标题/封面就近原地更新；
- 大目录场景从"等几分钟才看到东西"变成"开扫几秒就有内容"。

## 验证

- `cargo check`：通过（5 个原有 warning，零新增）；
- `cargo test --lib scan::`：**16/16 通过**；
- `pnpm tsc -p tsconfig.json --noEmit`：通过；
- 启动 `pnpm tauri dev` 跑一次全量重扫：进度条/日志阶段切换正确，卡片渐进出现。

## 提交

```
08b7170 quick(260515-prog): scan UI 区分两阶段 + 列表渐进刷新
```

## 未做

- 没改 `BackfillProgressBar`（年代回填走另一套 backfill-progress 通道，与本次诉求无关）；
- 没动 `bind_metadata` / `refresh_metadata` 单条路径——这俩只动一条游戏，UI 已经靠 `meta-fetch-progress` 走脉冲高亮，列表刷新由调用点显式 refetch 触发；
- 节流参数 600ms 是经验值（足够吸收 INSERT 风暴、又不至于让单条 enrich 完成的延迟很明显），后续如果觉得慢可以再调。
