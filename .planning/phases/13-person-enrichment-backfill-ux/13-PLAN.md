# Phase 13: Person Enrichment & Backfill UX — Plan

**Phase:** 13
**Goal:** 把 `/persons/:id` 升级为 dedup + timeline + co-staff + portrait 头像聚合页；Library 加 Backfill 进度条。
**Depends on:** v1.2 (persons / game_staff / `/persons/:id` 基础)
**Requirements covered:** PER-01, PER-02, PER-03, PER-04, POL-03

## Plans (5)

执行顺序：13a → 13b → 13c → 13d → 13e。a 是查询层 dedup（最小风险），b/c/d 是 UI/IPC 加法，e 独立。

---

### 13a — PER-01 cross-source person dedup (query layer)

**Files:**
- `src-tauri/src/commands.rs` — `list_persons_for_game` 末尾增 dedup reduce；返回结构加 `sources` 字段
- `src/lib/persons.ts` — `GameStaffRow.sources` 字段；types 更新
- `src/routes/Persons.tsx` — identity 派生时读取 sources，UI 显示 "Bangumi + VNDB" 双源 chip

**SQL:** 不动；仅在 Rust 层合并 vec
**Reduce 算法:**
```rust
fn merge_persons(rows: Vec<GameStaffRow>) -> Vec<MergedRow> {
    use std::collections::HashMap;
    let mut by_key: HashMap<(String, String), MergedRow> = HashMap::new();
    for r in rows {
        let name_key = r.name.trim().to_lowercase();
        let cn_key = r.name_cn.as_deref().unwrap_or("").trim().to_lowercase();
        // 仅当 name 或 (name + name_cn) 都一致时合并；name_cn 为空忽略
        let key = (name_key.clone(), cn_key.clone());
        ...
    }
    // 排序时 Bangumi 优先（representative source）
}
```

**Acceptance:**
- `cargo build --lib` 绿
- `pnpm tsc --noEmit` 绿
- 一组 fixture 单元测试：name 相同 + 不同 source → 1 merged row + sources.len() == 2

---

### 13b — PER-02 PersonTimeline component

**Files:**
- `src/components/library/PersonTimeline.tsx` (new)
- `src/routes/Persons.tsx` — 在 PageHeader 下、4 role section 上插入 `<PersonTimeline games={mergedGames} />`

**Component spec:**
- 输入 games[]（已 dedup 跨 role）
- 计算每年份 group + 每作品气泡尺寸
- 横向 strip overflow-x-auto + scroll-snap-x
- 气泡: `<div style={{ width, height }} className="rounded-full bg-brand-soft" />`
- Hover tooltip 显示 game.name + playtime + 通关状态（reuse shadcn Tooltip）

**Acceptance:** `pnpm tsc --noEmit` 绿；空 games 数组渲染空状态文字

---

### 13c — PER-03 Co-staff IPC + CoStaffStrip

**Files:**
- `src-tauri/src/commands.rs` — 新 `list_co_staff_for_person(person_id, limit?) -> Vec<CoStaffRow>`
- `src-tauri/src/lib.rs` — 注册
- `src/lib/persons.ts` — 增 `listCoStaffForPerson`
- `src/components/library/CoStaffStrip.tsx` (new)
- `src/routes/Persons.tsx` — 4 role section 之后插入 `<CoStaffStrip personId={personId} />`

**CoStaffRow:**
```ts
{
  person_id: number;
  name: string;
  name_cn: string | null;
  source: "bangumi" | "vndb";
  source_id: string;
  coshare: number;
  role_hint: string | null;  // most common role in co-occurring games
}
```

**SQL (locked):** 见 CONTEXT.md PER-03 节

**Acceptance:** `cargo build --lib` 绿；`pnpm tsc --noEmit` 绿；空结果时 strip 隐藏

---

### 13d — PER-04 Portrait cache backend + UI

**Files:**
- `src-tauri/src/commands.rs` — 新 `get_or_fetch_portrait(source, source_id) -> Option<String>`
- `src-tauri/src/lib.rs` — 注册
- `src-tauri/src/commands.rs::clear_all_data` — 增 `portraits` 子目录删除
- `src/lib/persons.ts` — 增 `getOrFetchPortrait(source, sourceId)`
- `src/routes/Persons.tsx` — 头部展示自己 portrait + 同台伙伴 portrait
- `src/components/library/CoStaffStrip.tsx` — 显示 portrait 缩略

**Backend logic:**
```rust
async fn get_or_fetch_portrait(source: String, source_id: String, state: ...) -> Option<String> {
    let rel = format!("portraits/{}-{}.jpg", source, source_id);
    let abs = data_dir.join(&rel);
    if abs.exists() { return Some(rel); }
    // Bangumi: GET /v0/persons/:source_id → images.medium
    // VNDB: GraphQL person { image { url } }
    // Use limiter::wait_bangumi for Bangumi
    match fetch_portrait_url(...).await {
        Ok(Some(url)) => {
            let bytes = reqwest::get(url).await?.bytes().await?;
            std::fs::create_dir_all(abs.parent().unwrap())?;
            std::fs::write(&abs, &bytes)?;
            Some(rel)
        }
        _ => None,
    }
}
```

**Note:** Bangumi /v0/persons/{id} endpoint 已知；VNDB GraphQL query "person" 用 staff id 派生 image。本 phase 简化：只支持 Bangumi（v1.4 再加 VNDB 补全）。VNDB-source persons 返回 None → 文字徽标 fallback。

**Acceptance:** `cargo build --lib` 绿；clear_all_data test 不破坏；前端 `pnpm tsc --noEmit` 绿；首次访问 `/persons/:id` 触发抓取，第二次直接读盘

---

### 13e — POL-03 Backfill progress UI

**Files:**
- `src-tauri/src/commands.rs::backfill_metadata_enrichment` — 启动时 emit `meta-fetch-progress-meta`；新 `cancel_backfill` IPC + BACKFILL_CANCEL AtomicBool state
- `src-tauri/src/lib.rs` — 注册 + state.manage
- `src/lib/scan.ts` 或 `src/lib/metadata.ts` — 增 cancelBackfill invoke + types
- `src/components/library/BackfillProgressBar.tsx` (new)
- `src/routes/Library.tsx` — PageHeader 下沿挂 `<BackfillProgressBar />`

**Event protocol:**
- `meta-fetch-progress-meta`: `{ total: number }` —— 启动时一次
- `meta-fetch-progress`: `{ game_id, phase }` —— 已有，前端按 phase==='finished' 累加 current

**Cancel:**
- 类似 ScanState；新 `BackfillState` 持 AtomicBool
- Backfill 循环 top of each iteration 检查 + break
- IPC `cancel_backfill` 翻 bool 即可

**Acceptance:** `cargo build --lib` 绿；`pnpm tsc --noEmit` 绿；空闲时进度条隐藏

---

## Out of Scope (this phase)

- 完成度 chip
- VNDB portrait 抓取（仅 Bangumi）
- portrait CDN 代理
- 自动定时 backfill
- 跨源 persons 物理合并

## Risks

- PER-01 dedup 在 `list_games_for_person` 反向查询时不再独立的 person_id —— 简化处理：URL 仍接受任一 person_id，identity 派生时 IPC 查回 sources 数组
- PER-04 portrait 抓取受 Bangumi 1 req/s 限速；首次访问 `/persons/:id` 可能感觉慢；mitigation：fire-and-forget + UI 显示 skeleton 几秒
- POL-03 cancel 机制依赖 backfill loop 主动 check；如果 in-flight HTTP 拉取较慢，cancel 立即生效会差几秒

## Verification

- Backend：`cargo test --lib` + `cargo build --lib`
- Frontend：`pnpm tsc --noEmit` + `pnpm build`
- 真机 smoke 推迟到 Phase 15（与 PER 各 sub-feature 一同跑）
