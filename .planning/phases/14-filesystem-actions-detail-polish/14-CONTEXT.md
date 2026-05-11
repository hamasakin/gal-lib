# Phase 14: Filesystem Actions & Detail Polish — Context

**Gathered:** 2026-05-12
**Status:** Ready for planning
**Mode:** Auto-generated for /gsd-autonomous (ROADMAP success criteria 已锁定)

<domain>
## Phase Boundary

补齐 v1.0/v1.1/v1.2 carry-over 的 6 个文件系统 + Detail Polish 项：

1. **FS-01** — 集成 `tauri-plugin-opener`，新 `open_path` IPC 走插件；
   既有 `open_external_url` impl 改用 opener；保留 `open_in_explorer` 兼容
2. **FS-02** — GameCard ContextMenu 增「打开目录」（Detail 更多菜单已在
   quick task 20260509b 落地）
3. **FS-03** — Screenshots 路由每个 game 组 header 增「打开截图目录」
4. **POL-01** — Detail 页 Tabs 改受控；`?tab=screenshots|saves|notes|
   metadata|sessions|config` 直接落到对应 tab；写回 URL 让分享/返回稳定
5. **POL-02** — 新 IPC `get_session_count() -> i64` 走 `SELECT COUNT(*)
   FROM sessions WHERE end_at IS NOT NULL`；Stats KPI 行的「会话总数」
   位置（如不存在则新增）真实化
6. **POL-04** — LIB-02（杂志式不对称网格）废止：在 PROJECT.md
   Key Decisions 写一条 Phase 7 reverted 的最终决策

**Out of scope:**
- Detail tab 状态的 `replaceState`/`pushState` 写回（POL-01 只做读取
  解析；hash/search 写回留给 v1.4 如需要）
- Opener API 的 npm `@tauri-apps/plugin-opener` 引入（保留 IPC wrapper
  即可，更换底层实现）
- GameCard 批量选择模式下的右键菜单（保持现状）

</domain>

<decisions>
## Implementation Decisions

### FS-01 — tauri-plugin-opener 集成

- 加 Cargo dep `tauri-plugin-opener = "2"`；lib.rs `.plugin(tauri_plugin_opener::init())`
- 新 IPC `open_path(path: String) -> Result<(), String>`：path 存在性 check + 调 `app.opener().open_path(path, None::<&str>)`
- `open_in_explorer` 保持现签名，内部改 delegate 到 opener（避免 frontend 全量改 invoke 调用）
- `open_external_url` 改用 `app.opener().open_url(url, None::<&str>)`，但仍保留 http(s) 白名单 check
- capabilities/default.json 增 `opener:allow-open-path` / `opener:allow-open-url`
- Cargo / npm 不引入新前端依赖

### FS-02 — GameCard 「打开目录」

- 在 ContextMenu 「重新匹配元数据」上方加一项「打开目录」
- onClick → `openGameDir(game.path)` (已有 wrapper)
- 没有 disabled 状态——目录不存在错误由 IPC 抛出，toast 显示

### FS-03 — Screenshots 「打开截图目录」

- 每个 game 组 header 右侧（与「查看游戏 →」并排）加 `<FolderOpen size=14>` 文字按钮「打开目录」
- onClick → 拼 `${dataDir}/screenshots/${game.id}` → 调 `openGameDir`（同一 IPC，open_path 对子目录适用）
- 截图目录不存在时 toast 提示

### POL-01 — Detail ?tab= 解析

- `Tabs defaultValue="overview"` → `value={tab}` controlled
- 用 `useSearchParams` 读 `tab`；初始值映射 `tab` ∈ {overview, notes, sessions, screenshots, saves, config}；非法值 fallback overview
- `onValueChange` 写回 `setSearchParams({ tab: next }, { replace: true })`，让 history 不爆量
- URL 进入时 `?tab=metadata` 也认（虽然 Detail tab list 里没 metadata；CONTEXT 列了 metadata 是 ROADMAP 表述误差——本 phase 接受值集 = 6 个 actual tab + 容忍 metadata 别名 fallback overview）

### POL-02 — Real session count

- 新 IPC `get_session_count() -> i64`：`SELECT COUNT(*) FROM sessions WHERE end_at IS NOT NULL` （v1.0 schema 用 `end_at` 列）
- Stats.tsx `useEffect` 拉一次；存在则替换 `sessions = games.length` 的 proxy
- 旧 sub 文案「N 条记录」改为「N 次会话」更直观
- 不缓存，每次进入 Stats 重拉（数据量小）

### POL-04 — LIB-02 决策落地

- LIB-02 在 v1.1 Phase 7 reverted —— 最终决策「废止」
- 在 PROJECT.md 文末 / Conventions 块前 加一节「Key Decisions」（如不存在则新建）
- 记一条：
  > **LIB-02 杂志式不对称网格** — 废止。Phase 7 评估后回退到标准均匀网格；
  > 原因：a) auto-fill 网格在不同屏幕下视觉密度可控；b) 不对称布局对长名/
  > 短名游戏视觉权重不均衡；c) 实施成本高。最终采用 `repeat(auto-fill,
  > minmax(172px, 1fr))` 均匀网格。

### What NOT to change

- Detail.tsx 更多菜单已有「打开本地目录」(quick 20260509b)；不动
- 删除 `open_in_explorer` 旧 IPC（保持兼容，仅改实现）
- GameCard 内的批量选择模式逻辑

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets

- `open_in_explorer(path)` Rust IPC + `openGameDir(path)` TS wrapper (lib/games.ts:186) — Detail "更多" 菜单已经在用
- `open_external_url(url)` IPC — Bangumi/VNDB 外链跳转在用
- `useSearchParams` from react-router-dom v6 — Detail.tsx 已 import navigate；可直接加 useSearchParams
- `getTopGames` 类似 KPI 拉 IPC 模式 — POL-02 仿照
- Screenshots.tsx 已经在 `216` 行用了 `/games/:id?tab=screenshots` URL —— POL-01 落地后这就 round-trips

### Established Patterns

- IPC error: stringified via err_str
- 容错路径检查：`if !Path::new(&path).exists() { return Err(format!("路径不存在：{}", path)); }`
- Tauri 2 plugin: `.plugin(plugin_name::init())` in lib.rs
- capabilities/default.json permissions array

### Integration Points

- `commands.rs` 增 2 个新 IPC（open_path / get_session_count）
- `lib.rs` 注册 + .plugin(opener)
- `Cargo.toml` 增 `tauri-plugin-opener = "2"`
- `tauri.conf.json` 不动（plugin permission 在 capabilities 配置）
- `capabilities/default.json` 增 2 行 opener permission
- `src/lib/games.ts` 增 `openPath()` wrapper（option：复用 openGameDir）
- `src/lib/stats.ts` 或同等 — 增 getSessionCount wrapper
- `GameCard.tsx` ContextMenu 加一项
- `Screenshots.tsx` 每组 header 加按钮
- `Detail.tsx` Tabs 改受控
- `Stats.tsx` KPI 真实化
- `PROJECT.md` Key Decisions 加 LIB-02 一条

</code_context>

<specifics>
## Specific Ideas

- Tauri opener Rust trait: `use tauri_plugin_opener::OpenerExt; app.opener().open_path(...)`
- Detail tab valid set: `["overview","notes","sessions","screenshots","saves","config"]`；URL 写回时只允许这 6 个
- Stats `sessions` proxy 当前在 KPI 的 sub 文案，不是独立 KPI 卡——POL-02 success criterion 4 说"会话总数 KPI"，所以应该新增一张 KPI 卡或替换现有某张；最经济：替换 `sessions = games.length` 的 proxy 为真实值，sub 文案同步改

</specifics>

<deferred>
## Deferred Ideas

- Detail tab 变更时滚动到对应 anchor（v1.4 如需）
- Stats 多个会话 KPI（今日 / 本周 / 本月分组）
- Opener npm 包前端接入（保留 IPC wrapper 已够）
- GameCard 在「待复核」状态下额外提供「跳转 /scan 页」入口
- LIB-02 杂志式不对称的"复活"实验 — 永久废止，不再讨论

</deferred>
