---
phase: 14
name: Filesystem Actions & Detail Polish
milestone: v1.3
status: complete
completed_at: "2026-05-12"
requirements: [FS-01, FS-02, FS-03, POL-01, POL-02, POL-04]
plans_completed: [14a, 14b, 14c, 14d, 14e, 14f]
commits:
  - 64b2695 feat(14a): FS-01 tauri-plugin-opener 集成 + open_path IPC
  - b1e1932 feat(14b,14c): FS-02 GameCard 「打开目录」 + FS-03 Screenshots 「打开截图目录」
  - f2fa535 feat(14d): POL-01 Detail Tabs 受控 + ?tab= deeplink
  - 0dceb09 feat(14e): POL-02 真实会话总数 IPC + Stats sub 文案真实化
  - 61e9290 docs(14f): POL-04 PROJECT.md Key Decisions — LIB-02 废止 + opener reversal
---

# Phase 14: Filesystem Actions & Detail Polish — Summary

## What shipped

清掉 6 个 carry-over：opener 集成 + 「打开目录」入口 + Detail deeplink + 真实会话数 KPI + LIB-02 决策落地。

### 14a — FS-01 `tauri-plugin-opener` 集成 + `open_path` IPC

- `Cargo.toml` 新依赖 `tauri-plugin-opener = "2"`
- `lib.rs` `.plugin(tauri_plugin_opener::init())` + 注册新 `open_path` handler
- `commands.rs` 重写 `open_in_explorer` + `open_external_url`：都 delegate 到 `OpenerExt::opener().open_path()` / `open_url()`，保留 path-exists 与 http(s) 白名单
- `capabilities/default.json` 增 `opener:default` + `allow-open-path` + `allow-open-url`
- `src/lib/games.ts` 新 `openPath(path)` wrapper（新 callsite 首选）

### 14b — FS-02 GameCard ContextMenu 「打开目录」

- `GameCard.tsx` 新 `onOpenDir()` handler；ContextMenu 在「重新匹配元数据」上加项「打开目录」+ separator；error 通过 toast

### 14c — FS-03 Screenshots 「打开截图目录」

- `Screenshots.tsx` 每个 game 组 header 右侧加 `<FolderOpen>` 图标按钮「打开目录」；onClick 拼 `${dataDir}/screenshots/${game.id}` 调 `openGameDir`；`dataDir` 未就绪时按钮 disabled

### 14d — POL-01 Detail `?tab=` deeplink

- `Detail.tsx` 增 `DETAIL_TABS` 常量（6 个值）+ `parseTab()` helper
- `useSearchParams` 读 `tab`；Tabs 改受控（`value={tab}` + `onValueChange={setTab}`）
- `setTab` 写回 URL 用 `replace:true` 避免 history 爆量
- Screenshots `/games/:id?tab=screenshots` 跳链现在直接命中 screenshots tab

### 14e — POL-02 real session count IPC + Stats 集成

- 新 IPC `get_session_count() -> i64`：`SELECT COUNT(*) FROM sessions WHERE ended_at IS NOT NULL`（schema 是 `ended_at` 不是 PLAN 写的 `end_at`，修正）
- `src/lib/stats.ts` 增 `getSessionCount()` wrapper
- `Stats.tsx` mount 时拉 IPC 存到 `sessionCount`；`sessions = sessionCount ?? games.length`（fallback 避免 IPC 在飞时显示 0）；sub 文案从「N 条记录」改为「N 次会话」

### 14f — POL-04 LIB-02 Key Decision 落地

- `.planning/PROJECT.md` Key Decisions 表：
  - LIB-02 行从「⚠ Revisit — v1.3 重新评估或删除 spec」改为「✗ 废止」并附完整原因（密度可控 / 视觉权重不均 / 实施成本）+ 最终方案（auto-fill, minmax(172px, 1fr) 均匀网格）
  - `tauri-plugin-opener` 行从「✓ Good — 包大小不变」改为「⤴ Reversed」并附 v1.3 Phase 14 (FS-01) 的引入理由

## Acceptance

| Plan | cargo build --lib | cargo test --lib | pnpm tsc --noEmit | pnpm build |
|------|-------------------|------------------|-------------------|------------|
| 14a  | ✅                | ✅               | ✅                | (整体)     |
| 14b  | n/a               | n/a              | ✅                | (整体)     |
| 14c  | n/a               | n/a              | ✅                | (整体)     |
| 14d  | n/a               | n/a              | ✅                | (整体)     |
| 14e  | ✅                | ✅               | ✅                | (整体)     |
| 14f  | n/a (docs)        | n/a              | n/a               | n/a        |
| 全 phase | ✅            | ✅ 68/68         | ✅                | ✅ 3.13s   |

## Out of scope (delivered as locked in PLAN)

- Detail tab `pushState`（用 `replace` 不爆 history）
- `@tauri-apps/plugin-opener` npm 包不引入（保留 IPC wrapper 已够）
- Stats 会话相关 KPI 增量分组（v1.4 如需）
- LIB-02 复活实验

## Real-app smoke (deferred to Phase 15)

下列项目需要真机走查，由 memory 规则推迟到 Phase 15 milestone audit 一并 smoke：
1. **FS-01** — `tauri-plugin-opener` capabilities 权限实际放行 vs runtime error
2. **FS-02** — GameCard 右键「打开目录」实际打开 Explorer
3. **FS-03** — Screenshots 「打开目录」实际打开 `data/screenshots/{id}/`
4. **POL-01** — 浏览器 / 内部跳链 `?tab=saves` 等 6 种值实际命中对应 tab；切换 tab URL 实时更新
5. **POL-02** — 库里有真实游玩会话时 Stats sub 显示真实「N 次会话」数
