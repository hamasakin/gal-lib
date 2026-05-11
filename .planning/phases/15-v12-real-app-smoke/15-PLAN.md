# Phase 15: v1.2 Real-app Smoke Verification — Plan

**Phase:** 15
**Goal:** 重跑自动化 + 写完整 real-app walkthrough 清单；human-eye smoke 在 milestone audit 期间跑。
**Depends on:** Phase 12-14 全部完成
**Requirements covered:** VER-01, VER-02, VER-03 (+ Phase 13/14 carry-over）

## Plans (1)

只有一个 sub-plan —— Phase 15 是文档 / 验证 phase，无代码改动。

---

### 15a — 自动化回归 + walkthrough 清单

**Files:**
- `.planning/phases/15-v12-real-app-smoke/15-SUMMARY.md` (新) — 含完整 walkthrough 步骤表
- `.planning/phases/15-v12-real-app-smoke/15-VERIFICATION.md` (新) — 标 human_needed

**自动化 gates:**
- `cargo build --lib` 绿
- `cargo test --lib` 绿
- `pnpm tsc --noEmit` 绿
- `pnpm build` 绿

**Acceptance:**
- 4 个自动化 gate 全绿
- SUMMARY 列出 ≥ 5 条 v1.2 walkthrough + Phase 13 (5 条) + Phase 14 (4 条) 共 ≥ 14 条具体可执行 smoke 步骤

---

## Out of Scope (this phase)

- 任何 git diff
- 真机走查本身 —— 那是 milestone audit 的工作

## Risks

- 上游 phase 之间可能存在交互回归（e.g. tab deeplink 与 ?v= cache-buster 互相影响）—— 自动化层 cargo+tsc+build 全绿 ≠ 运行时 OK
- opener permission name 拼写错误 silent fail —— 只在运行时才会暴露

## Verification

- 自动化层：4 个 build/test gate
- 真机层：交付 walkthrough 清单，audit 期间跑
