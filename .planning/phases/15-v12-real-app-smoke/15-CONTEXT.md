# Phase 15: v1.2 Real-app Smoke Verification — Context

**Gathered:** 2026-05-12
**Status:** Verification-only phase (no new code)
**Mode:** Auto-generated for /gsd-autonomous

<domain>
## Phase Boundary

本 phase 不交付新代码——只在装有 Locale Emulator + 一个真实 galgame 库的
Windows 环境对积累的 real-app smoke 项做走查。覆盖：

1. **v1.2 UI-01** Detail summary/staff/外链
2. **v1.2 UI-02** 人物 chip 跳转 + 官方标签 region 与用户 tag region 并存
3. **v1.2 UI-03** FilterPanel 多维 facet 实际收窄 grid + 跨维 AND / 同维 OR / 60-chip expander
4. **Phase 13 carry-over** real-app items（PER-01 dedup / PER-02 timeline / PER-03 co-staff / PER-04 portrait / POL-03 backfill progress + cancel）
5. **Phase 14 carry-over** real-app items（FS-01 opener / FS-02 GameCard 「打开目录」/ FS-03 Screenshots 「打开目录」/ POL-01 ?tab= deeplink / POL-02 sessions KPI）

**Autonomous-mode policy**: 在无人眼可看 GUI 的会话里，本 phase 只能：
1. 重跑自动化（cargo test + tsc + pnpm build）确认上游 phase 没回归
2. 在 SUMMARY 里把每项 smoke 步骤明确写下来作为 milestone audit 的执行清单
3. VERIFICATION 标 `human_needed`，列举所有需要人眼确认的子项

**Out of scope:**
- 任何代码改动（除非 milestone audit 期间发现某项失败需补丁——那时不算 Phase 15，会作为 quick task 或新 phase）
- 真机性能测试 / 大库压测
- 跨 Windows 版本 (Win10 vs Win11) 兼容性 matrix

</domain>

<decisions>
## Implementation Decisions

### 自动化层（本 phase 实际跑的）

- `cargo build --lib`
- `cargo test --lib`
- `pnpm tsc --noEmit`
- `pnpm build`

如果任一回归 → Phase 15 不能 close，必须修复

### 文档层（写下来供 audit 跑）

SUMMARY 里给每条 smoke 步骤：
- 入口（点哪 / 输入哪个 URL）
- 期望结果（看到什么 / 命中什么 tab / 显示哪个数字）
- 失败模式（如何识别 broken）

### 升级路径

milestone audit (v1.3 close) 时由人眼实际跑过这些步骤；任一项失败：
- 小修复 → 作为 quick task 落地
- 大问题 → 开新 phase 16

</decisions>

<code_context>
## Existing Code Insights

### 来自 Phase 11 (v1.2)
- `Detail.tsx` 已有 summary 段落 + staff 分组 + 「在 Bangumi 看 ↗」/「在 VNDB 看 ↗」按钮（line 976-984 + 1522 helper）
- `PersonChip` 在 Detail.tsx 已点击 `navigate(/persons/:id)`
- `FilterPanel.tsx` 已有多维 facet UI

### 来自 Phase 13/14
- 所有改动已 commit + cargo/tsc/build 验证；待人眼验证项已枚举在各 phase 的 VERIFICATION.md

</code_context>

<specifics>
## Specific Ideas

无新代码

</specifics>

<deferred>
## Deferred Ideas

无

</deferred>
