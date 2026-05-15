---
type: quick-task
slug: 260515-loading-phase-sort
date: 2026-05-15
status: complete
commits:
  - d96045b
  - 444c2ad
  - 27f74fc
  - c24c79b
---

# Quick 260515-loading-phase-sort — SUMMARY

## 用户报告

1. 第一批并发 loading 卡片完成后，就没有新的 Loading 状态了
2. loading 的卡片好像和正在匹配的游戏不一致
3. 刷新元数据的时候应该按照获取元数据的时间来排序

## 根因诊断

`quick(260515-loading-persist) e750c12` 在 `Library.tsx` 引入的 reconcile effect 监听 `games`：把已 bound 或 failed-terminal 的 id 从 `fetchingMetaIds` 移除。
初衷：finished 之后 loading 视觉撑到 row 真正到位再撤。

但对 `refresh_metadata_smart`：所有 row refresh 前就是 bound，`games[id].metadata_source` 早就是 `"bangumi"`/`"vndb"`。
backend `started` 刚到 → `addFetchingMetaId(id)` → reconcile 立刻看 row 已 bound → 立刻 remove → loading 视觉撑不到一帧。

→ 症状 1：第一波偶尔能撑到 reconcile 还没跟上前的几帧；之后所有 started 都被瞬间清掉
→ 症状 2：撑下来的少数 loading 卡片是 reconcile 还没处理的存量，与 backend 当前对象错位

对 `start_scan`：placeholder row `metadata_source=NULL`，不是 bound，reconcile 不误清——所以 scan 不显这两个 bug，但 refresh 显。

## 修复

### A. fetchingMetaIds 加 phase（`src/store/library.ts`）

值类型 `Record<number, true>` → `Record<number, "in_flight" | "awaiting_refetch">`：

- `addFetchingMetaId(id)` 写 `"in_flight"`（backend started）
- `markFetchingMetaFinished(id)` 写 `"awaiting_refetch"`（backend finished）
- `removeFetchingMetaId(id)` 仍删除（reconcile 清理）
- `clearFetchingMetaIds()` 仍清空（scan-progress 终态兜底）

### B. listener 改写 phase（`src/main.tsx`）

`finished` 不再 no-op，调 `markFetchingMetaFinished(id)`。

### C. reconcile gate `awaiting_refetch`（`src/routes/Library.tsx`）

```ts
if (fetchingMetaIds[id] !== "awaiting_refetch") continue;
```

`"in_flight"` 阶段永远保留 loading 视觉，不管 row 是否 bound。
`"awaiting_refetch"` 阶段沿用 260515-loading-persist 语义：等 row bound / failed-terminal 再清。

### D. 刷新期按 last_scanned_at DESC（`src/routes/Library.tsx`）

`visibleGames` memo 里：

```ts
if (scanRunning) {
  rest.sort((a, b) => {
    const at = a.last_scanned_at ?? "";
    const bt = b.last_scanned_at ?? "";
    if (at === bt) return 0;
    if (at === "") return 1;   // null 沉底
    if (bt === "") return -1;
    return at > bt ? -1 : 1;   // DESC
  });
}
```

loading 卡片仍浮顶；下面是按刷新时间倒序的"鲜度墙"。

### E. 视觉判定 `!= null`（GameCard / GameList）

`fetchingMetaIds[g.id] === true` → `!= null`。两种 phase 都触发 loading 视觉（pulse-ring + 中央 spinner + 角标 spinner）。

## 改动文件

| 文件 | 变更 |
|------|------|
| `src/store/library.ts` | 类型 + 注释 + `addFetchingMetaId` 改为写 `"in_flight"` + 新增 `markFetchingMetaFinished` |
| `src/main.tsx` | finished 调 `markFetchingMetaFinished`；注释更新 |
| `src/routes/Library.tsx` | reconcile gate `"awaiting_refetch"`；visibleGames 在 scanRunning 时按 last_scanned_at DESC 排序 rest |
| `src/components/library/GameCard.tsx` | `!= null` 判定 |
| `src/components/library/GameList.tsx` | `!= null` 判定 |

## 验证

- `pnpm tsc --noEmit` 全绿（无输出 = 无错误）
- `pnpm build` 全绿（1960 modules transformed）
- 实机 walkthrough 留 user 验收

## Commits

- `d96045b quick(260515-loading-phase): fetchingMetaIds 加 phase + 刷新期按 last_scanned_at 排序`（round-1）
- `444c2ad quick(260515-loading-phase): refresh 并发化 + metadata_fetched_at 列 + sort phase rank`（round-2）
- `27f74fc quick(260515-loading-phase): 全库刷新时排队卡片也显示 loading 态`（round-3）
- `c24c79b quick(260515-loading-phase): 刷新时不重排卡片，loading 原地显示`（round-4）

---

# Round 2 — 复盘后追加

## 用户复盘

1. 首批 4 个卡片 Loading 完后，后面都是在复用第一个卡片来走 loading 状态
2. 为什么只有首批是 4 个并发，后面都是等 4 个跑完后一个一个跑的
3. 加一个元数据获取时间的字段做排序，保证 loading 时和 loading 完后的顺序相对一致

## 根因（round-2）

- 用户看到的"首批 4 并发"其实是 round-1 修完后 phase=in_flight + 600ms throttle
  累积出来的视觉错觉。`refresh_metadata_smart` 后端是**真 serial for-loop**
  （commands.rs:1275 原版 `for (i, row) in rows.into_iter()`），从来没并发过。
  refetch 一到，所有 awaiting_refetch 同时清，后面就剩单 in_flight 卡在顶部"复用"。
- "loading 时和 loading 完后顺序一致"指的是位置稳定：用户希望卡片从 loading
  到 loading 完成的过程中不要跳来跳去，相邻 rank 平滑过渡即可。

## 修复（round-2）

### A. backend: refresh_metadata_smart 改并发（mirror start_scan）

JoinSet + `INGEST_CONCURRENCY=4` refill 模式：
- 4 个并发 task；任一完成立刻 refill 下一个；rows 耗尽 → 自然退出
- cancel flag 检查在 `set.spawn` 前和 task 内部 top 各一次
- cancel 时 `set.abort_all()` 立即中止 in-flight（mirror 260515-cancel 语义）
- `completed: Arc<AtomicUsize>` 原子推进 scan-progress
- 失败 / 数据不一致路径（bound 行 source_id 缺失等）不再 `continue`，而是
  跳过 UPDATE 后照常 emit finished + scan-progress + 推进 completed
  → 进度条不会卡在某个数字

### B. backend: 加 `metadata_fetched_at` 列（migration 0011）

```sql
ALTER TABLE games ADD COLUMN metadata_fetched_at TEXT;
UPDATE games SET metadata_fetched_at = last_scanned_at
WHERE last_scanned_at IS NOT NULL;
CREATE INDEX idx_games_metadata_fetched_at ON games(metadata_fetched_at DESC);
```

历史数据从 `last_scanned_at` 复制（initial bootstrap），避免老库重启时全 NULL
全沉底导致首屏视觉很乱。

5 个元数据写入站点同步更新：
- `apply_ingest_result`（start_scan / add_game enrich 共用 UPDATE）
- `bind_metadata`（手动绑定）
- `refresh_metadata`（单条刷新）
- `refresh_metadata_smart` unbound 路径
- `refresh_metadata_smart` bound 路径

`Game` struct + `row_to_game` + `list_games` / `search_games` / 人物聚合页
SELECT 全部加 `metadata_fetched_at` 列。

### C. frontend: visibleGames sort 重写

`scanRunning` 时整体按这套规则排：

```
phase rank: in_flight=2 > awaiting_refetch=1 > 普通=0   (DESC)
  → metadata_fetched_at DESC NULLS LAST
    → id ASC（稳定 tie-break）
```

- 顶部：当前并发的 4 张 in_flight 卡
- 紧接着：刚收到 finished、等 refetch 反映的 awaiting_refetch 卡
- 中段：本轮已经处理完、有 fresh metadata_fetched_at 的卡（DESC 排）
- 底部：本轮还没处理、metadata_fetched_at 较旧或 NULL 的卡

关键：单张卡的 lifecycle 是 `in_flight → awaiting_refetch → 处理完`，这三种
phase rank 相邻（2 → 1 → 0+ 但因为 metadata_fetched_at 是最新，仍排在 rank 0
最前段），位置是平滑下沉而不是跳跃 → 满足"loading 时和 loading 完后顺序相对
一致"。

非 scanRunning 时回到 round-1 行为：loading 浮顶（单条 refresh / bind 等
场景），rest 走用户排序偏好（last_played 等）。

## Round-2 改动文件

| 文件 | 变更 |
|------|------|
| `src-tauri/migrations/0011_add_metadata_fetched_at.sql` | 新建 — ADD COLUMN + 回填 + index |
| `src-tauri/src/db.rs` | 注册 V11_SQL migration |
| `src-tauri/src/commands.rs` | Game struct + row_to_game + 3 处 SELECT + 5 处 UPDATE + refresh_metadata_smart JoinSet 重写 |
| `src/lib/games.ts` | `Game.metadata_fetched_at: string \| null` |
| `src/routes/Library.tsx` | visibleGames sort 重写：scanRunning 时按 phase rank + metadata_fetched_at DESC |

## Round-2 验证

- `cargo check` 全绿（5 条预存在 warning，无 new error）
- `cargo test --lib` 80 passed
- `pnpm tsc --noEmit` 全绿
- `pnpm build` 全绿（1960 modules transformed）
- 实机 walkthrough 留 user 验收

---

# Round 3 — 复盘后追加

## 用户反馈

"为什么还是只有前四个有 LOADING"

## 根因（round-3）

并发=4 本身是对的——任一时刻确实只有 4 张在真正抓元数据。问题是
**已绑定、本轮还没轮到刷新的卡片完全没有视觉反馈**：

- `start_scan` 时 placeholder（metadata_source=NULL）会被 `getMetadataState`
  判为 "pending" → 一直 pulse，所以扫描时整个库都在动
- `refresh_metadata_smart` 处理的全是已绑定行（metadata_source 已是
  bangumi/vndb/manual）→ `getMetadataState` 返回 "ok" → bottomBadge=null
  → 除了当前并发的 4 张，其余 96 张完全静止

用户看到的"只有前四个有 loading"就是这个：4 张在抓 + 96 张静止。

## 修复（round-3）

### A. store: metaTouchedIds — 本轮处理过的 id 集合

- `addFetchingMetaId`（收到 `started` 时调）同步写 `metaTouchedIds[id]=true`
- `clearFetchingMetaIds`（终态 scan-progress）清空
- `removeFetchingMetaId` **不**动它——处理完的卡保持 touched（= 已刷新，
  不是排队中）

### B. store: metaRefreshActive — 全库刷新进行中标志

不能用 `scanProgress.status === "running"` 判断"排队中"：增量 `start_scan`
不会 re-enrich 已绑定游戏，那些卡永远收不到 `started` → 会无限 pulse。

- `Settings.onRefreshMetadata` 调 IPC 前 `setMetaRefreshActive(true)`；
  IPC 抛错（任务没 spawn 起来）catch 里复位
- `clearFetchingMetaIds`（终态）一并复位 false

### C. GameCard / GameList: isPendingRefresh 视觉

```
isPendingRefresh = metaRefreshActive && !isFetching && !metaTouched
```

- GameCard：映射到既有 "pending" bottomBadge → pulse-ring + 静态「获取中」
  角标（无中央大 spinner，避免 grid 一片黑）
- GameList：并入既有 `isLoading` → 行 tint + 缩略图 spinner + 标题旁 label

## 效果

点「刷新元数据」后：整个库立刻进入 loading 态 —— 4 张并发抓取（中央
spinner）+ 其余全部排队（pulse-ring）。处理过的卡逐步恢复正常，配合
round-2 的 phase-rank sort，顶部是当前并发、中段是刚处理完、底部是排队中。
全库可见刷新进度。

## Round-3 改动文件

| 文件 | 变更 |
|------|------|
| `src/store/library.ts` | 加 `metaTouchedIds` + `metaRefreshActive` + `setMetaRefreshActive`；`addFetchingMetaId` / `clearFetchingMetaIds` 联动 |
| `src/routes/Settings.tsx` | `onRefreshMetadata` 设/复位 `metaRefreshActive` |
| `src/components/library/GameCard.tsx` | `isPendingRefresh` → "pending" badge |
| `src/components/library/GameList.tsx` | `isPendingRefresh` 并入 `isLoading` |

## Round-3 验证

- `pnpm tsc --noEmit` 全绿
- `pnpm build` 全绿（1960 modules transformed）
- frontend-only，无 Rust 改动
- 实机 walkthrough 留 user 验收

## ⚠️ 给 user 的提醒

round-2 改了 Rust（`refresh_metadata_smart` 并发化 + migration 0011）。
若你只看到 webview 热更新、没重新编译 Rust，跑的还是旧的 **串行** 后端。
请完整重启 `pnpm tauri dev`（或重新 `cargo build`）让后端改动生效，
否则"4 并发"和"排队 pulse"都不会按预期表现。

---

# Round 4 — 最终修复（不重排）

## 用户反馈

"为什么后续抓取的就没有loading状态了"

## 根因（round-4）— 前几轮方向错了

前 3 轮一直在做"loading 浮顶 / phase-rank 排序"，**这正是病根**：

- round-2 的 phase-rank sort 把 in_flight 卡片排到列表最前
- 后果：后端处理到的卡片**全部被拽到顶部**前 ~4 个槽位
- 用户盯着网格里某张卡，它被处理的瞬间已经被挪走了 → 原位永远不显示 loading
- 用户视角："只有前 4 个有 loading""后续抓取的没有 loading"

跨 4 轮反复出现同一症状，就是因为浮顶把 loading 锁死在顶部 4 槽。

## 决策（AskUserQuestion）

向用户确认了三个选项：A 不重排原地显示 / B loading 浮顶 / C 按获取时间排。
**用户选 A —— 卡片永不移动位置，loading 原地点亮。**

## 修复（round-4）

`Library.tsx` 的 `visibleGames` 删掉所有重排逻辑（phase-rank sort +
loading-first 分区），直接 `= filteredGames`（server sort + advanced
filter）。loading 完全靠 per-card 视觉表达：

- 排队中（metaRefreshActive && !fetching && !touched）→ pulse-ring + 角标
- 抓取中（fetchingMetaIds[id] != null）→ spinner + pulse-ring + 中央 spinner
- 已完成 → 恢复正常

三种状态都在卡片**自己的网格位置**上切换，卡片永不移动。

移除 `useMemo` import（visibleGames 不再 memo）。`metadata_fetched_at` 列
保留（后端已写入，留作未来手动排序选项），但前端不再用它排序。

## 效果

点「刷新元数据」→ 整个网格立即进入排队 pulse → 4 张并发的 spinner 散布在
各自真实位置 → 处理完逐一恢复正常。loading 像扫描线原地扫过整个库，卡片
永不移动，loading 时与 loading 完后顺序完全一致。

## Round-4 改动文件

| 文件 | 变更 |
|------|------|
| `src/routes/Library.tsx` | `visibleGames` 删除所有重排 → `= filteredGames`；移除 `useMemo` import |

## Round-4 验证

- `pnpm tsc --noEmit` 全绿
- `pnpm build` 全绿（1960 modules transformed）
- frontend-only，无 Rust 改动
- 实机 walkthrough 留 user 验收（仍需确认 round-2 的 Rust 后端已重新编译）
