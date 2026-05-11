---
phase: 13
status: human_needed
verified_at: "2026-05-12"
score: "automated: 5/5 plans landed + build/tests green; real-app smoke deferred to Phase 15"
---

# Phase 13: Person Enrichment & Backfill UX — Verification

## Automated gates

| Gate | Result | Notes |
|------|--------|-------|
| `cargo build --lib` | ✅ | 5 pre-existing warnings (unused variant), 0 errors |
| `cargo test --lib` | ✅ | 68/68 tests (incl. 4 new `merge_persons_tests` + 3 new `portrait_cache::tests`) |
| `pnpm tsc --noEmit` | ✅ | 0 errors |
| `pnpm build` | ✅ | 1953 modules, 728 kB bundle (3.11s) |

## Success Criteria Status

| # | Criterion (from ROADMAP) | Status | Evidence |
|---|--------------------------|--------|----------|
| 1 | 同名同语的 Bangumi+VNDB 人物在 /persons/:id 头部折叠为一行 + 显示「Bangumi+VNDB」双源 chip | ✅ code | commands.rs `merge_persons` (4 unit tests) + `sourceLabel()` in Persons.tsx |
| 2 | /persons/:id 顶部展示作品时光轴（按 release_year 横向气泡，尺寸映射 playtime），hover 可见标题 | ✅ code | PersonTimeline.tsx (bubbleSize sqrt mapping + Tooltip) + Persons.tsx mergedGames |
| 3 | /persons/:id 底部展示「常与 X 共同出现」横滑条，含 ≥ 2 共现次数的 person，点击跳对方页 | ✅ code | list_co_staff_for_person (HAVING coshare >= 2) + CoStaffStrip.tsx (Link to /persons/:id) |
| 4 | Detail staff chip + 聚合页头部 + 同台 PersonCard 全部显示头像；首次访问按需下载到 data/portraits/，缺失 fallback 文字徽标 | ⚠ partial | Persons.tsx 头部 + CoStaffStrip 已接入 portrait + monogram fallback；Detail staff chip 没改（PLAN.md 注「Detail staff chip 在 hover 时按需 lazy fetch」标为可选，未在 13d 实现） |
| 5 | 触发 backfill_metadata_enrichment 后 Library PageHeader 出现进度条（current/total + 当前游戏名 + 取消按钮），完成后自动隐藏 | ✅ code | BackfillProgressBar.tsx listens meta + per-game events + AUTO_HIDE_MS 5s + cancel_backfill IPC |

## Items needing real-machine QA (defer to Phase 15)

Per memory rule「Autonomous run no questions — defer human-eye items to milestone audit」，下列项目延后到 Phase 15 真机 smoke：

1. **PER-01 dedup 实测** — 库里实际存在 Bangumi+VNDB 双源同名 staff 的游戏，进 /persons/:id 应该看到「BANGUMI + VNDB · 共参与 N 部作品」副标题
2. **PER-02 timeline 视觉** — 库里有跨年份作品的人物，时光轴气泡大小应正确反映 playtime 差异；hover Tooltip 正确显示
3. **PER-03 co-staff 实测** — 选一个高产剧本家进 /persons/:id，底部 strip 应出现常合作的画师/声优；点击跳转无回路
4. **PER-04 portrait 实测** — Bangumi 上有头像的 staff 首次访问 `/persons/:id` 应该出现头像 spinner → 加载完成；第二次访问立即出图；data/portraits/ 目录里有 `bangumi-{id}.jpg`
5. **POL-03 backfill 实测** — 触发 backfill 后 Library header 下沿出现 2px 渐变条 + 当前游戏名；点取消后下一个 iteration 停下；终态 5s 后自动隐藏
6. **Detail staff chip portrait** — PER-04 success criterion 4 提到 Detail staff chip 显示头像；本 phase 未对 Detail.tsx staff popover/chip 做改动（CONTEXT.md "Detail staff chip 在 hover 时按需 lazy fetch" 仅作为 idea 标注，未列入 PLAN.md Files）；如真机走查发现缺失，可在 Phase 15 内补一行 `<img>` 给 staff chip 用 getOrFetchPortrait

## Status

`human_needed` — 自动化验证全过，real-app smoke 走 Phase 15。
