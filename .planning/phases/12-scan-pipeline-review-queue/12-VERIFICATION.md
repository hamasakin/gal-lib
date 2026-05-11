---
phase: 12
verified: 2026-05-12
status: human_needed
score: requirements=3/3 implemented, 3/3 deferred to real-app smoke (Phase 15 VER)
auto_verification:
  cargo_test: pass (61 tests)
  cargo_build_lib: pass
  pnpm_tsc: pass
  pnpm_build: pass
human_verification:
  required_environment: Windows 10/11 + 已配置至少 1 个 scan_root + Locale Emulator 可选（仅观察队列 UI 不需要启动游戏）
  checklist:
    - id: "SCAN-01-smoke"
      requirement: SCAN-01
      step: "访问 /scan → 看到 PageHeader + 4 KPI（已扫游戏 / 已绑定 / 待复核 / 无匹配）。增量/全量/取消按钮可点击；scan 进行中显示取消。"
    - id: "SCAN-02-smoke"
      requirement: SCAN-02
      step: "触发增量扫描 → 左栏 ScanFeed 持续追加 hh:mm:ss 行，最新在上，200 行 cap；右栏 ReviewQueue 在 ingest 完成后出现新待复核项。"
    - id: "SCAN-02-persistence"
      requirement: SCAN-02
      step: "完成扫描后关闭并重启 app → 重新进 /scan 看右栏 ReviewQueue 依然显示之前的待复核项（持久化到 scan_review_queue 表）。"
    - id: "SCAN-03-compare"
      requirement: SCAN-03
      step: "点开一个待复核项 → 看到 Bangumi vs VNDB 并排候选卡片（封面 / 标题 / 别名 / 评分 / 简介 200 字 clamp / 外链 chip）。"
    - id: "SCAN-03-accept"
      requirement: SCAN-03
      step: "点「采用 Bangumi」或「采用 VNDB」→ toast 成功提示 + 该卡片从队列消失 + KPI 重新计算 + Library 中游戏 name/cover 更新（cache-buster 命中）。"
    - id: "sidebar-pulse"
      requirement: SCAN-01/02
      step: "Sidebar「扫描复核」nav 上的 count pill 跟随队列大小变化（accept/dismiss 后立即减小）。"
    - id: "manual-rebind-clear"
      requirement: SCAN-03
      step: "点「手工绑定…」打开 MetadataPicker，绑定一个 id 成功 → 队列条目自动消失（bind_metadata 内部 DELETE 触发）。"
    - id: "dismiss"
      requirement: SCAN-03
      step: "点「不再提示」→ 卡片消失但 games 表不变；下次再扫该目录如果仍 < 80 confidence 会重新入队（INSERT OR REPLACE）。"

requirements_status:
  SCAN-01:
    status: implemented
    plan: 12a/12b/12c/12d
    evidence: |
      schema v9 migration applied via tauri-plugin-sql; get_scan_kpis IPC returns 4 counts in a single query; /scan PageHeader + 4 KpiCards rendered; cargo + tsc green.
    real_app_smoke: deferred (see checklist SCAN-01-smoke)
  SCAN-02:
    status: implemented
    plan: 12a/12b/12d
    evidence: |
      scan_review_queue table persists ingest results with current_confidence < 80; ScanFeed subscribes to two existing event streams with rolling 200-line buffer; ReviewQueue refetches on mount + scan/meta event (debounced 600ms).
    real_app_smoke: deferred (see checklist SCAN-02-smoke, SCAN-02-persistence)
  SCAN-03:
    status: implemented
    plan: 12b/12c/12d
    evidence: |
      fetch_review_candidates IPC concurrent dual-source search (tokio::join!); CandidateCard component renders cover/title/aliases/release_date/summary; accept_review_candidate IPC wraps bind_metadata; optimistic UI update + reconcile.
    real_app_smoke: deferred (see checklist SCAN-03-compare, SCAN-03-accept, manual-rebind-clear, dismiss)

tech_debt:
  - "ScanFeed 不持久化（session-only log 语义）"
  - "200-game backfill 期间 600ms debounce 全表 refetch（典型库尺寸无问题；> 1000 时观察）"
  - "候选 AI 辅助评分推荐未做（v1.4 视用户反馈）"

decision: |
  3 SCAN requirements 全部代码层完成 + cargo/tsc/build 绿；real-app smoke 推
  迟到 Phase 15 VER 统一真机验证（与 v1.2 UI-01/02/03 一同跑）。符合 user
  feedback "autonomous run no questions — defer human-eye items to milestone
  audit"。
---

# Phase 12 Verification

## Auto-verification (passed)

```
$ cd src-tauri && cargo test --lib
test result: ok. 61 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out

$ pnpm tsc --noEmit
(exit 0, no output)

$ pnpm build
dist/index.html                   0.97 kB │ gzip:   0.53 kB
dist/assets/index-B6Q0VpyS.css   57.55 kB │ gzip:  11.54 kB
dist/assets/index-Csnx3yAN.js   708.80 kB │ gzip: 213.51 kB
✓ built in 3.89s
```

## Human verification

See frontmatter `human_verification.checklist` — 8 items grouped by
requirement. Deferred to Phase 15 VER consolidated real-app smoke pass.

## Files touched

Backend:
- `src-tauri/migrations/0009_add_scan_review_queue.sql` (new)
- `src-tauri/src/db.rs` (V9_SQL + migration test)
- `src-tauri/src/commands.rs` (sync_review_queue_for_game / delete helper + 5 new IPCs + clear_all_data list)
- `src-tauri/src/lib.rs` (handler registration)

Frontend:
- `src/lib/scan.ts` (ScanKpis + getScanKpis)
- `src/lib/scanReview.ts` (new)
- `src/routes/Scan.tsx` (new)
- `src/components/library/ScanFeed.tsx` (new)
- `src/components/library/ReviewQueue.tsx` (new)
- `src/components/layout/Sidebar.tsx` (扫描复核 nav + badge)
- `src/router.tsx` (route registration)
