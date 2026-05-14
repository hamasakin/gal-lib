---
type: quick-task
slug: 260515-loading-phase-sort
date: 2026-05-15
status: planned
---

# Quick 260515-loading-phase-sort — fetchingMetaIds 加 phase + 刷新期按 last_scanned_at 排序

## 用户反馈

1. **第一批并发 loading 卡片完成后，就没有新的 Loading 状态了**
2. **loading 的卡片好像和正在匹配的游戏不一致**
3. **刷新元数据的时候应该按照获取元数据的时间来排序**

## 根因

`quick(260515-loading-persist) e750c12` 在 Library.tsx 引入了 reconcile effect：
监听 `games` 变化，把已经 `bound` 或 `failed-terminal` 的 row 从 `fetchingMetaIds` 里移除。
初衷是：finished 事件之后保持 loading 视觉，直到 row 真正 bound 才撤掉。

但这套逻辑没区分两种 phase：
- `started` 刚到（backend 正在跑这条）
- `finished` 已到（backend 跑完，等前端 refetch 反映出 cover/元数据）

对 **`refresh_metadata_smart`**：所有 row 都是已 bound 的，refresh 开始前 `games` 数组里 row 状态就是 bound。
backend emit `started` → frontend addFetchingMetaId → reconcile 立刻看到 row 已 bound → 立刻 remove → loading 视觉死活闪不出来。

→ **症状 1**：第一波偶尔能撑到 reconcile 跟上前的几帧；之后所有 started 都被瞬间清掉
→ **症状 2**：撑下来的少数 loading 卡片对应的不是"现在 backend 在处理的"，而是"reconcile 还没来得及处理的存量"

对 `start_scan`：placeholder row 是真未 bound（metadata_source=NULL），reconcile 不会误清，所以 scan 不显这两个 bug，但 refresh 显。

## 修复方案

### 1. `fetchingMetaIds` 加 phase 区分

值类型 `Record<number, true>` → `Record<number, "in_flight" | "awaiting_refetch">`：

- `started` 事件 → `addFetchingMetaId(id)`（写 `"in_flight"`）
- `finished` 事件 → `markFetchingMetaFinished(id)`（写 `"awaiting_refetch"`）

reconcile effect 只对 `phase === "awaiting_refetch"` 的 id 检查 bound 状态。
`phase === "in_flight"` 的 id 不管 row 是否已 bound，永远保留 loading 视觉，
确保 backend 处理期间用户 100% 看到 loading。

### 2. 所有视觉消费点改 `!= null` 判定

- `GameCard.tsx:137` `=== true` → `!= null`
- `GameList.tsx:116` `=== true` → `!= null`
- `Library.tsx:389` `=== true` → `!= null`

"in_flight" 和 "awaiting_refetch" 都是 loading 视觉。

### 3. 刷新期按 `last_scanned_at` DESC 排序

Library.tsx `visibleGames` memo：
- `scanRunning` 时，rest 分区按 `last_scanned_at DESC`（NULL 沉底）
- loading 分区仍浮在最前（既有逻辑）

这样：
- 顶部：当前正在抓元数据的卡（loading + 浮顶）
- 紧接着：刚刚刚刷新过的卡（last_scanned_at 最新）
- 越往下：刷新时间越老 / 尚未刷新

用户能直观看到刷新进度。

## 改动文件

- `src/store/library.ts` — 类型 + `addFetchingMetaId` + `markFetchingMetaFinished` + `removeFetchingMetaId`
- `src/main.tsx` — finished 改写 phase（而不是 no-op）
- `src/routes/Library.tsx` — reconcile gate + visibleGames 按 last_scanned_at 排序
- `src/components/library/GameCard.tsx` — 视觉判定 `!= null`
- `src/components/library/GameList.tsx` — 视觉判定 `!= null`

## 验证

- `pnpm tsc --noEmit` 全绿
- `pnpm build` 全绿
- 真机 walkthrough（手动）：点设置→刷新元数据，观察：
  - 每张卡都能持续显示 loading 视觉
  - loading 卡片与 backend 当前处理对象一致
  - 刚处理完的卡片按 last_scanned_at 顺序在 loading 卡片之下

---

# Round 2 — 用户复盘后追加

## 新反馈

1. 首批 4 个卡片 Loading 完后，后面都是在复用第一个卡片来走 loading 状态
2. 为什么只有首批是 4 个并发，后面都是等 4 个跑完后一个一个跑的
3. 给卡片加一个元数据获取时间的字段做排序，全量扫描和刷新元数据时默认按这个时间排，保证 loading 时和 loading 完后的顺序相对一致

## 根因（round-2）

- 症状 1、2 来自 `refresh_metadata_smart` 后端是**串行 for loop**（commands.rs:1271 `for (i, row) in rows.into_iter().enumerate()`），不是 4 并发。
  用户首批看到 4 个并发其实是 round-1 修完后 phase=in_flight + 600ms throttle 累积出来的视觉错觉：refetch 还没到，前几个串行处理完的卡片都在 awaiting_refetch 状态，看起来像并发。refetch 一到全部清空，后面就剩单卡一个个滚（实际 backend 一直是一个个跑）。
- 症状 3 是位置一致性问题：用户希望 loading 中的卡片在列表里的位置和它 loading 完之后的位置相对稳定，不要让卡片在 loading 时跳来跳去。

## 修复（round-2）

### A. backend: 加 `metadata_fetched_at` 列（migration 0011）

`last_scanned_at` 现在虽然只被元数据写入路径更新，但语义模糊。新增 `metadata_fetched_at TEXT` 专门给元数据获取时间做排序锚点。

5 个 UPDATE 站点同步写入：
- `apply_ingest_result` (start_scan / add_game)
- `bind_metadata`
- `refresh_metadata` (单条)
- `refresh_metadata_smart` 已绑定路径
- `refresh_metadata_smart` 未绑定路径

Game struct 加字段；list_games / search_games / 任何 SELECT 同步加列。

### B. backend: `refresh_metadata_smart` 改并发

复刻 `start_scan` 的 JoinSet + INGEST_CONCURRENCY=4 refill 模式：
- 4 个并发 task；任一完成立刻 refill 新 task
- cancel flag 在 spawn 前和 task 内部 top 各检查一次
- completed 用 `Arc<AtomicUsize>` 原子推进 scan-progress
- 失败/cancel 时仍 emit finished + scan-progress（保留 in-flight 计数正确性）

### C. frontend: visibleGames sort 重写

scanRunning 时整体按这套规则排：

```
phase rank (in_flight=2, awaiting_refetch=1, none=0) DESC
  → metadata_fetched_at DESC NULLS LAST
    → id ASC（稳定 tie-break）
```

不再用 round-1 的 "loading 浮顶 + rest 按 last_scanned_at" 双段拼接；改为一次全量 sort，因为 in_flight 卡片 phase rank 最高会自然到顶。

非 scanRunning 时回到 round-1 行为：loading 浮顶（保留单条 refresh / bind 等场景），rest 走用户排序偏好。

## 改动文件（round-2）

- `src-tauri/migrations/0011_add_metadata_fetched_at.sql` — ALTER TABLE
- `src-tauri/src/commands.rs` — Game struct + row_to_game + 2 处 SELECT + 5 处 UPDATE + refresh_metadata_smart JoinSet 重写
- `src/lib/games.ts` — Game.metadata_fetched_at
- `src/routes/Library.tsx` — visibleGames sort 重写

## 验证

- `cargo check` 全绿
- `pnpm tsc --noEmit` 全绿
- `pnpm build` 全绿
- 真机 walkthrough：刷新元数据时 4 个卡片持续并发，刚处理完的卡按时间倒序紧跟在 loading 之下
