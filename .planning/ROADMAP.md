# Roadmap: gal-lib

## Milestones

- ✅ **v1.0 MVP** — Phases 1-5 (shipped 2026-05-08) — see [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md)
- ✅ **v1.1 UI Redesign** — Phases 6-10 (shipped 2026-05-09) — see [milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md)
- ✅ **v1.2 Metadata Enrichment & Filtering** — Phase 11 (shipped 2026-05-09) — see [milestones/v1.2-ROADMAP.md](milestones/v1.2-ROADMAP.md)
- ◆ **v1.3 Scan Pipeline & Person Polish** — Phases 12-15 (started 2026-05-12) — current

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1-5) — SHIPPED 2026-05-08</summary>

- [x] Phase 1: Foundation (6/6 plans) — completed 2026-05-06
- [x] Phase 2: Library Ingest (6/6 plans) — completed 2026-05-07
- [x] Phase 3: Launch & Playtime (6/6 plans) — completed 2026-05-07
- [x] Phase 4: Library Polish (6/6 plans) — completed 2026-05-08
- [x] Phase 5: Stats / Screenshots / Saves (5/5 plans) — completed 2026-05-08

</details>

<details>
<summary>✅ v1.1 UI Redesign (Phases 6-10) — SHIPPED 2026-05-09 — 27/30 reqs (1 reverted, 2 deferred)</summary>

- [x] Phase 6: Design Tokens & Tweaks (1/1 plans) — completed 2026-05-08
- [x] Phase 7: Library Page Redesign (1/1 plans) — completed 2026-05-08
- [x] Phase 8: Detail Page Redesign (1/1 plans) — completed 2026-05-08
- [x] Phase 9: Scan & Stats Pages (1/1 plans, partial — Scan deferred) — completed 2026-05-08
- [x] Phase 10: Settings & Screenshots (1/1 plans) — completed 2026-05-08

</details>

<details>
<summary>✅ v1.2 Metadata Enrichment (Phase 11) — SHIPPED 2026-05-09 — 16/18 reqs (3 UI deferred to real-app smoke)</summary>

- [x] Phase 11: Metadata Enrichment & Multi-dim Filtering (7/7 plans, 11a-g) — completed 2026-05-09

</details>

### ◆ v1.3 Scan Pipeline & Person Polish (Active — started 2026-05-12)

- [x] **Phase 12: Scan Pipeline & Review Queue** — SCAN-01/02/03 (3 reqs) — completed 2026-05-12 (real-app smoke → Phase 15)
- [x] **Phase 13: Person Enrichment & Backfill UX** — PER-01/02/03/04 + POL-03 (5 reqs) — completed 2026-05-12 (real-app smoke → Phase 15)
- [x] **Phase 14: Filesystem Actions & Detail Polish** — FS-01/02/03 + POL-01/02/04 (6 reqs) — completed 2026-05-12 (real-app smoke → Phase 15)
- [x] **Phase 15: v1.2 Real-app Smoke Verification** — VER-01/02/03 (3 reqs) — completed 2026-05-12 (verification-only：自动化全绿 + 12-step walkthrough doc 待 milestone audit)

## Phase Details (v1.3)

### Phase 12: Scan Pipeline & Review Queue

**Goal:** 上线独立 `/scan` 路由，让用户能看到扫描实时日志 + 持久化的待复核队列 + Bangumi/VNDB 候选并排对比一键切换数据源。

**Depends on:** v1.2 (`get_filter_options` / `backfill_metadata_enrichment` 已就绪；fetch_detail 双源已可拉简介)

**Requirements:** SCAN-01, SCAN-02, SCAN-03

**Success Criteria:**
1. 访问 `/scan` 进入独立页面（无 Library 侧栏 + 顶部窄返回 nav），顶部 4 KPI 卡显示当前库的扫描状态
2. 触发增量/全量扫描时，左栏增量日志实时刷新（每条 < 50ms 出现），不阻塞 UI
3. 扫描产出的 match_confidence < 80 游戏自动进入右栏「待复核」队列，重启应用后队列仍保留
4. 在待复核卡片上点击 → 展开 Bangumi vs VNDB 并排候选视图，看到双源封面/标题/品牌/简介/评分对比
5. 点「采用 Bangumi」或「采用 VNDB」一键写库 + 触发 ingest 重抓 + 该卡片从队列移除

### Phase 13: Person Enrichment & Backfill UX

**Goal:** 把人物聚合页从「单 grid」升级到「跨源去重 + 作品时光轴 + 同台伙伴 + 头像缓存」，同时把 Backfill 进度做成 PageHeader 可见的进度条。

**Depends on:** v1.2 (persons / game_staff 表已有真实数据 + `/persons/:id` 已上路由)

**Requirements:** PER-01, PER-02, PER-03, PER-04, POL-03

**Success Criteria:**
1. 同名同语的 Bangumi+VNDB 人物在 `/persons/:id` 头部折叠为一行 + 显示「Bangumi+VNDB」双源 chip
2. `/persons/:id` 顶部展示作品时光轴（按 release_year 横向气泡，尺寸映射 playtime），hover 可见标题
3. `/persons/:id` 底部展示「常与 X 共同出现」横滑条，含 ≥ 2 共现次数的 person，点击跳对方页
4. Detail staff chip + 聚合页头部 + 同台 PersonCard 全部显示头像；首次访问按需下载到 `data/portraits/`，缺失 fallback 文字徽标
5. 触发 backfill_metadata_enrichment 后 Library PageHeader 出现进度条（current/total + 当前游戏名 + 取消按钮），完成后自动隐藏

### Phase 14: Filesystem Actions & Detail Polish

**Goal:** 把"打开目录"打通（tauri-plugin-opener + Detail/Screenshots 按钮）、Detail `?tab=` deeplink 解析、真实会话数 KPI、LIB-02 最终决策落地。

**Depends on:** v1.0 (data/screenshots per-game 范围) + v1.1 (Stats KPI + LIB-02 spec)

**Requirements:** FS-01, FS-02, FS-03, POL-01, POL-02, POL-04

**Success Criteria:**
1. `tauri-plugin-opener` 集成完成，`open_path(path)` IPC 注册；`open_external_url` 内部改走 opener
2. Detail 页和 Screenshots 页/GameCard 右键菜单出现「打开目录」按钮，点击在系统资源管理器中打开对应目录；目录不存在时按钮 disabled 并提示
3. 通过 `/games/:id?tab=screenshots`（或 saves/notes/metadata/sessions/config）进入 Detail 页时直接落到对应 tab
4. Stats 顶部「会话总数」KPI 显示真实 `SELECT COUNT(*) FROM sessions WHERE end_at IS NOT NULL` 值
5. LIB-02 在 PROJECT.md Key Decisions 出现一条最终决策记录（实现 / 废止 二选一），代码 + spec 与决策一致

### Phase 15: v1.2 Real-app Smoke Verification

**Goal:** 在装有 Locale Emulator 的真实 Windows 环境对 v1.2 deferred 的 UI-01/02/03 三件套做 smoke 验证；任一项失败在本 phase 内修复。

**Depends on:** Phase 12-14 完成（其它 v1.3 改动也一同 smoke）

**Requirements:** VER-01, VER-02, VER-03

**Success Criteria:**
1. Detail 页对一款 Bangumi-bound 游戏显示完整 summary 段落 + staff 分组 + 在 Bangumi 看 ↗ / 在 VNDB 看 ↗ 可点击跳浏览器
2. Detail staff chip 点击跳 `/persons/:id` 路由切换正常；同游戏官方 tags region 与用户 tag 区域并存且视觉区分
3. Library FilterPanel 多维 facet（品牌/编剧/画师/声优/官方标签）勾选后 grid 实际收窄；多 facet 跨维 AND、同维 OR、60-chip 「更多」expander OK
4. SUMMARY.md 附实机 walkthrough（截图或文字 step-by-step）
5. 任一项失败 → 本 phase 内修复并重 smoke

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation | v1.0 | 6/6 | Complete | 2026-05-06 |
| 2. Library Ingest | v1.0 | 6/6 | Complete | 2026-05-07 |
| 3. Launch & Playtime | v1.0 | 6/6 | Complete | 2026-05-07 |
| 4. Library Polish | v1.0 | 6/6 | Complete | 2026-05-08 |
| 5. Stats / Screenshots / Saves | v1.0 | 5/5 | Complete | 2026-05-08 |
| 6. Design Tokens & Tweaks | v1.1 | 1/1 | Complete | 2026-05-08 |
| 7. Library Page Redesign | v1.1 | 1/1 | Complete (LIB-02 reverted) | 2026-05-08 |
| 8. Detail Page Redesign | v1.1 | 1/1 | Complete | 2026-05-08 |
| 9. Scan & Stats Pages | v1.1 | 1/1 | Complete (Scan deferred) | 2026-05-08 |
| 10. Settings & Screenshots | v1.1 | 1/1 | Complete | 2026-05-08 |
| 11. Metadata Enrichment & Multi-dim Filtering | v1.2 | 7/7 | Complete (UI-01/02/03 human-eye deferred) | 2026-05-09 |
| 12. Scan Pipeline & Review Queue | v1.3 | 4/4 | Complete (real-app smoke → Phase 15) | 2026-05-12 |
| 13. Person Enrichment & Backfill UX | v1.3 | 5/5 | Complete (real-app smoke → Phase 15) | 2026-05-12 |
| 14. Filesystem Actions & Detail Polish | v1.3 | 6/6 | Complete (real-app smoke → Phase 15) | 2026-05-12 |
| 15. v1.2 Real-app Smoke Verification | v1.3 | 1/1 | Complete (verification-only) | 2026-05-12 |
