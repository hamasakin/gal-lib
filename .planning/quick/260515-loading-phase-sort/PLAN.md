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
