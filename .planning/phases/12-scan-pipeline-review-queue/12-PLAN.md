# Phase 12: Scan Pipeline & Review Queue — Plan

**Phase:** 12
**Goal:** 上线独立 `/scan` 复核页 + 持久化待复核队列 + Bangumi/VNDB 候选并排对比一键 rebind。
**Depends on:** v1.0 scan/ingest 主链路, v1.2 `search_metadata`/`bind_metadata`, v1.1 PageHeader/Sidebar 模式
**Requirements covered:** SCAN-01, SCAN-02, SCAN-03

## Plans (4)

执行顺序：12a → 12b → 12c → 12d。a/b 是后端基础，c/d 是前端组装。可在 12b 完成后并行 c/d，但单 contributor 顺序最稳。

---

### 12a — Schema v9 migration: scan_review_queue table

**Files:**
- `src-tauri/migrations/0009_add_scan_review_queue.sql` (new)
- `src-tauri/src/db.rs` — 注册 V9_SQL + 加 migration test

**SQL contents (locked):**
```sql
CREATE TABLE scan_review_queue (
  game_id INTEGER PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  game_path TEXT NOT NULL,
  current_confidence INTEGER NOT NULL DEFAULT 0,
  suggested_source TEXT,             -- 'bangumi' | 'vndb' | NULL
  suggested_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_scan_review_queue_created ON scan_review_queue(created_at DESC);

UPDATE app_meta SET value = '9' WHERE key = 'schema_version';
```

**Acceptance:**
- `cargo test migrations_v9_adds_scan_review_queue` 通过：assert table 存在 + 索引存在 + schema_version='9'
- 既有 1-8 migration test 不破坏

---

### 12b — Backend IPC commands + ingest integration

**Files:**
- `src-tauri/src/commands.rs` — 4 新 IPC + ingest 入队 + bind 出队 + clear_all_data 加 DELETE
- `src-tauri/src/lib.rs` — 注册 4 新 invoke_handler

**新 IPC：**

1. `get_scan_kpis() -> ScanKpis`
   - `ScanKpis { total: i64, bound: i64, review_pending: i64, unmatched: i64 }`
   - 4 个 COUNT 查询合并到 1 个 round-trip
   - `total = COUNT(*) FROM games`
   - `bound = COUNT(*) FROM games WHERE metadata_source IN ('bangumi','vndb','manual')`
   - `review_pending = COUNT(*) FROM scan_review_queue`
   - `unmatched = COUNT(*) FROM games WHERE metadata_source = 'none'`

2. `list_scan_review_queue() -> Vec<ReviewItem>`
   - `ReviewItem { game_id, game_path, name, current_confidence, current_source, current_source_id, suggested_source, suggested_id, created_at }`
   - SQL: `SELECT q.game_id, q.game_path, g.name, q.current_confidence, g.metadata_source AS current_source, g.metadata_source_id AS current_source_id, q.suggested_source, q.suggested_id, q.created_at FROM scan_review_queue q LEFT JOIN games g ON g.id = q.game_id ORDER BY q.created_at DESC`

3. `dismiss_review_item(game_id: i64) -> ()`
   - `DELETE FROM scan_review_queue WHERE game_id = ?`

4. `accept_review_candidate(game_id: i64, source: String, source_id: String) -> ()`
   - 复用 `bind_metadata` 内部逻辑（提炼成 `do_bind_metadata` 共享 helper 或直接 invoke），事务化
   - 末尾 `DELETE FROM scan_review_queue WHERE game_id = ?`

5. `fetch_review_candidates(game_id: i64) -> ReviewCandidates`
   - `ReviewCandidates { bangumi: Option<Candidate>, vndb: Option<Candidate> }`
   - 取 `games.name` → 调用既有 `search_metadata` 两次（Bangumi + VNDB）→ 各取 top-1
   - 限速器 `wait_bangumi`/`wait_vndb` 自动生效

**Ingest 改动：**

- `apply_ingest_result()` 末尾（在 metadata_source 写完后）增加：
```rust
if matches!(result.metadata_source.as_deref(), Some("none")) || result.match_confidence < 80 {
    sqlx::query(
        "INSERT OR REPLACE INTO scan_review_queue (game_id, game_path, current_confidence, suggested_source, suggested_id) \
         VALUES (?, ?, ?, ?, ?)"
    )
    .bind(game_id)
    .bind(&path_str)
    .bind(result.match_confidence)
    .bind(result.metadata_source.as_deref().filter(|s| *s != "none"))
    .bind(result.metadata_source_id.as_deref())
    .execute(pool).await?;
}
```
（注意 suggested_source 为 NULL 表示 ingest 完全没找到匹配；非 NULL 表示找到了但 confidence < 80）

- `bind_metadata` 成功路径末尾 + `accept_review_candidate` 内部：`DELETE FROM scan_review_queue WHERE game_id = ?`
- `clear_all_data` 加 `DELETE FROM scan_review_queue`（即使有 CASCADE，也显式列出）

**Acceptance:**
- `cargo build --lib` 绿
- `cargo test --lib` 不退化
- 启动 app + 扫一个低 confidence 游戏 → `SELECT * FROM scan_review_queue` 有行
- 调 `accept_review_candidate` 后 → 该行消失 + games.metadata_source 被 rebind

---

### 12c — Frontend invoke wrappers + types

**Files:**
- `src/lib/scanReview.ts` (new) — 4 invoke wrapper + types
- `src/lib/scan.ts` — 加 `getScanKpis` invoke + `ScanKpis` type（KPI 直接放 scan.ts 更合理）

**Types:**

```ts
// scan.ts
export interface ScanKpis {
  total: number;
  bound: number;
  review_pending: number;
  unmatched: number;
}
export async function getScanKpis(): Promise<ScanKpis> {
  return invoke<ScanKpis>("get_scan_kpis");
}

// scanReview.ts (new)
import { type Candidate } from "./metadata";

export interface ReviewItem {
  game_id: number;
  game_path: string;
  name: string | null;
  current_confidence: number;
  current_source: string | null;
  current_source_id: string | null;
  suggested_source: string | null;
  suggested_id: string | null;
  created_at: string;
}
export interface ReviewCandidates {
  bangumi: Candidate | null;
  vndb: Candidate | null;
}
export async function listScanReviewQueue(): Promise<ReviewItem[]> { ... }
export async function dismissReviewItem(gameId: number): Promise<void> { ... }
export async function acceptReviewCandidate(gameId: number, source: "bangumi"|"vndb", sourceId: string): Promise<void> { ... }
export async function fetchReviewCandidates(gameId: number): Promise<ReviewCandidates> { ... }
```

**Acceptance:**
- `pnpm tsc --noEmit` 绿

---

### 12d — `/scan` route + components

**Files:**
- `src/routes/Scan.tsx` (new)
- `src/components/library/ScanFeed.tsx` (new)
- `src/components/library/ReviewQueue.tsx` (new)
- `src/router.tsx` — 添加 `{ path: "scan", element: <Scan /> }`
- `src/components/layout/Sidebar.tsx` — 加 nav item「扫描复核」+ pulse dot showing review_pending

**Scan.tsx 结构：**
```
<ScanProgressBar />          ← 复用既有
<PageHeader title="扫描复核" sub="复核低置信度匹配 · 一键切换数据源">
  actions: 增量扫描 / 全量重扫 / 取消（active 时）
</PageHeader>
<KpiStrip>                    ← 4 列 grid
  KpiCard 已扫游戏  · {total}
  KpiCard 已绑定    · {bound}
  KpiCard 待复核    · {review_pending}   (highlighted if > 0)
  KpiCard 不匹配    · {unmatched}
</KpiStrip>
<TwoColumnFeed>               ← 12 列 grid → 5/7 拆分
  <ScanFeed />                ← 左 5 列：实时日志（rolling）
  <ReviewQueue />             ← 右 7 列：list of ReviewItem cards
</TwoColumnFeed>
```

**ScanFeed.tsx：**
- 本地 `useState<string[]>` rolling buffer (cap 200)
- mount 时订阅 `scan-progress` (每 Running event push 一行) + `meta-fetch-progress` (started/finished 各一行)
- 每行格式：`[hh:mm:ss] {action} — {path 或 game_id}`
- mono 小字 + 列表底部对齐（最新在上）
- 空状态："等待扫描..."

**ReviewQueue.tsx：**
- mount + 事件驱动 `listScanReviewQueue()`
- 每行卡片：50×66 缩略封面（从 games.cover_path 拼 convertFileSrc）+ 名称（粗）+ 路径（mono 小灰）+ 当前 confidence pill（red if 0, amber 否则）+ 折叠 chevron
- 展开后 2 列 Bangumi/VNDB 候选对比 + 「采用 Bangumi」「采用 VNDB」按钮 + 「手工 ID 绑定」（打开 MetadataPicker）+ 「不再提示」
- 候选拉取期间 skeleton；候选为 null = 灰底显示「未找到匹配」+ 提示用 MetadataPicker
- 接受/拒绝后从 list 中本地移除（乐观更新）+ refetch KPI

**Sidebar 增项：**
- 「扫描复核」nav，icon: SearchCheck (lucide)
- pulse-dot 显示 review_pending > 0（红点；hover tip 提示数量）
- mount 时调 getScanKpis；其他页面 meta-fetch-progress event 完成后也 refetch

**Acceptance:**
- `pnpm tsc --noEmit` 绿
- `pnpm build` 绿
- 视觉/交互真机验证延后到 Phase 15 VER 总验

---

## Out of Scope (this phase)

- AI 辅助评分
- 批量 accept
- restored dismissed 列表
- /scan 自带 sidebar 隐藏（layout-route 直接 share Sidebar 即可）
- 性能虚拟化（< 50 项不需要）

## Risks

- ingest `apply_ingest_result` 内部签名可能需要 pool 参数：当前已经接受 `&SqlitePool`，按需调整
- `bind_metadata` 是公共 IPC + 内部 helper 共享路径要小心；推荐提炼一个非 `#[tauri::command]` 的 `do_bind_metadata(pool, game_id, source, source_id) -> Result<()>` 内部 fn 供两处调用
- `scan_review_queue` ON DELETE CASCADE 已能保证 games delete 时联动；clear_all_data 显式 DELETE 是双保险
- ReviewQueue 一次 fetch 双源候选可能 ~1-2s（Bangumi 限速 1 req/s + VNDB 不限）；前端 skeleton + 单卡片 expanded 只 fetch 一次（缓存到 component-local state）

## Verification

- Backend：cargo test migrations + `cargo build --lib` 绿
- Frontend：`pnpm tsc --noEmit` + `pnpm build` 绿
- 自动化测试不要求新增（Tauri E2E 在 v1.0 即未配置）
- 真机 smoke 推迟到 Phase 15
