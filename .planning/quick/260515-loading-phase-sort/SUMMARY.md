---
type: quick-task
slug: 260515-loading-phase-sort
date: 2026-05-15
status: complete
commits:
  - d96045b
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

## Commit

- `d96045b quick(260515-loading-phase): fetchingMetaIds 加 phase + 刷新期按 last_scanned_at 排序`
