---
phase: 14
status: human_needed
verified_at: "2026-05-12"
score: "automated: 6/6 plans landed + build/tests green; real-app smoke deferred to Phase 15"
---

# Phase 14: Filesystem Actions & Detail Polish — Verification

## Automated gates

| Gate | Result | Notes |
|------|--------|-------|
| `cargo build --lib` | ✅ | tauri-plugin-opener=2 resolves clean; 5 pre-existing warnings |
| `cargo test --lib` | ✅ | 68/68 tests; no new tests added (FS / opener are integration paths) |
| `pnpm tsc --noEmit` | ✅ | 0 errors |
| `pnpm build` | ✅ | 1957 modules, 730 KB bundle (+2 KB vs Phase 13 — opener npm 包未引入) |

## Success Criteria Status

| # | Criterion (ROADMAP) | Status | Evidence |
|---|---------------------|--------|----------|
| 1 | tauri-plugin-opener 集成完成，open_path(path) IPC 注册；open_external_url 内部改走 opener | ✅ code | Cargo.toml dep + lib.rs `.plugin(tauri_plugin_opener::init())` + open_path/open_in_explorer/open_external_url 都 delegate 到 OpenerExt + capabilities default.json 3 行 |
| 2 | Detail 页和 Screenshots 页/GameCard 右键菜单出现「打开目录」按钮 | ✅ code | Detail.tsx 更多菜单 (quick 20260509b 已落地) + GameCard.tsx ContextMenu 新加 + Screenshots.tsx 每组 header 按钮；目录不存在通过 IPC err -> toast 提示（disabled 状态在 dataDir 未就绪时也已实现） |
| 3 | /games/:id?tab=screenshots\|saves\|notes\|metadata\|sessions\|config 直接落到对应 tab | ✅ code | Detail.tsx DETAIL_TABS={overview,notes,sessions,screenshots,saves,config}+useSearchParams+parseTab fallback；metadata 别名 fallback overview（Detail tab list 没该值） |
| 4 | Stats 顶部「会话总数」KPI 显示真实 SELECT COUNT(*) FROM sessions WHERE end_at IS NOT NULL 值 | ✅ code | 新 get_session_count IPC (schema 是 ended_at，更正了 ROADMAP 措辞) + Stats.tsx sessionCount state + sub 文案「N 次会话」；fallback to games.length 期间避免 0 |
| 5 | LIB-02 在 PROJECT.md Key Decisions 出现一条最终决策记录（实现 / 废止 二选一） | ✅ code | PROJECT.md Key Decisions 表 LIB-02 行已更新为「✗ 废止」+ 完整原因 + 最终方案；附带 opener 行从 Good 改为 Reversed |

## Items needing real-machine QA (defer to Phase 15)

1. **opener capabilities 权限** — 运行 dev 后实际点「打开目录」/ Bangumi 外链确认 plugin permission 放行（capabilities 名 typo 会 silent fail）
2. **GameCard 右键 + Screenshots 按钮** 实际打开对应目录
3. **Detail `?tab=` deeplink** — 浏览器 navigate `/games/123?tab=saves` 应直接落到存档 tab；切换 tab URL 实时更新
4. **Stats 会话数真实化** — 库里有真实 sessions 行时显示数字与 `SELECT COUNT(*) FROM sessions WHERE ended_at IS NOT NULL` 一致

## Status

`human_needed` — 自动化验证全过；real-app smoke 与 Phase 13 一同推到 Phase 15。
