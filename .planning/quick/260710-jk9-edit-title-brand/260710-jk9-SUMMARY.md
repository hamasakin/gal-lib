---
phase: quick-260710-jk9
plan: 01
subsystem: library-detail
tags: [detail, edit, brand, title, i18n, tauri-command]
requires:
  - update_game_brand_year (既有命令，复用)
  - get_filter_options().brands (品牌列表来源)
  - displayGameName (name_cn 首选回退契约)
provides:
  - update_game_title 后端命令 (写 name_cn)
  - updateGameTitle 前端封装
  - EditGameInfoDialog 组件 (标题 + 品牌下拉)
  - Detail「更多」菜单「编辑条目信息」入口
affects:
  - src-tauri/src/commands.rs
  - src-tauri/src/lib.rs
  - src/lib/games.ts
  - src/routes/Detail.tsx
tech-stack:
  added: []
  patterns:
    - "NULLIF(?, name) 让手动标题与底层 name 相同时落回 NULL，避免主/副标题重复"
    - "品牌纯下拉 Select（选项仅来自 get_filter_options().brands + 无品牌哨兵），杜绝自由输入产生重复品牌桶"
key-files:
  created:
    - src/components/library/EditGameInfoDialog.tsx
  modified:
    - src-tauri/src/commands.rs
    - src-tauri/src/lib.rs
    - src/lib/games.ts
    - src/routes/Detail.tsx
    - src/locales/zh-CN/translation.json
    - src/locales/ja-JP/translation.json
    - src/locales/en-US/translation.json
decisions:
  - "标题写 name_cn 而非 name：displayGameName 中 name_cn 最高优先且无需 metadata_source 参与，改它 h1 才立即变化"
  - "品牌复用 update_game_brand_year 并回传当前 release_year，避免覆盖语义误清年份"
  - "品牌控件用下拉而非文本框，满足『必须从已有品牌选择』的收敛约束"
metrics:
  duration: "~35min"
  completed: "2026-07-10"
  tasks: 2
  files: 7
---

# Quick 260710-jk9: 游戏详情手动编辑名称与品牌 Summary

游戏详情页「更多」菜单新增「编辑条目信息」对话框：标题为自由文本（写 `name_cn`，让 h1 立即更新且刷新元数据后保留），品牌为纯下拉选择（仅列库中已有品牌 + 无品牌哨兵，不允许自由输入），品牌保存复用 `update_game_brand_year` 并回传当前发行年份避免误清。

## Tasks Completed

### Task 1: 新增 update_game_title 后端命令并注册 (commit a47a9a8)
- `src-tauri/src/commands.rs`：新增 `update_game_title(game_id, title)`，`UPDATE games SET name_cn = NULLIF(?, name)`；服务端 trim + 空标题拒绝；SQL 全参数化绑定。
- `src-tauri/src/lib.rs`：`commands::update_game_title` 注册进 invoke_handler（在 `update_game_brand_year` 之后）。
- 验证：`cargo check` 通过（仅 6 个 pre-existing 死代码 warning，与本任务无关）；grep `commands::update_game_title` ×1 / `pub async fn update_game_title` ×1。

### Task 2: 编辑对话框 + Detail 菜单接入 + i18n (commit 4a7997d)
- `src/lib/games.ts`：`updateGameTitle(gameId, title)` 封装。
- `src/components/library/EditGameInfoDialog.tsx`（新建，~255 行）：参照 ViewNameDialog 结构（受控 open、Promise onSubmit 后关闭、Enter 提交、忙碌禁用、每次打开重置 + focus/select）。标题自由文本 input；品牌用 `@/components/ui/select` 的 `Select` 纯下拉，只列 `brands` + 「无品牌」哨兵（`NONE="__none__"` 提交映射回 null），initialBrand 不在列表时兜底插入一项。保存禁用条件：忙碌 || 标题空 || 未变化。
- `src/routes/Detail.tsx`：import `EditGameInfoDialog` / `updateGameTitle` / `updateGameBrandYear` / `getFilterOptions` / `Pencil`；新增 `editOpen` + `brandOptions` state；「更多」菜单 split_subdirs 前加「编辑条目信息」项（`onSelect` 拉品牌列表 + 打开对话框）；JSX 渲染对话框，onSubmit 走 `updateGameTitle` → `updateGameBrandYear(id, brand, game.release_year)` → `refreshGame` + toast。
- i18n：三语各新增 10 key（`detail.menu.edit_info` + `detail.edit.{title,subtitle,title_label,title_placeholder,brand_label,brand_none,brand_hint,save,saved,failed}`），545/545/545 对齐。
- 验证：`pnpm run typecheck`（tsc --noEmit）EXIT 0；`pnpm build`（tsc -b + vite build，1990 modules）EXIT 0。

## Deviations from Plan

**1. [Rule 3 - 阻塞] worktree 缺 node_modules，前端门无法运行**
- **Found during:** Task 2 验证。
- **Issue:** 隔离 worktree 无 `node_modules`，`pnpm exec tsc` 报 `Command "tsc" not found`。
- **Fix:** 在 worktree 内 `pnpm install --frozen-lockfile`（全局 store 硬链，6.1s）后 typecheck / build 正常。
- **Files modified:** 无源码改动（node_modules/dist 均 gitignore，未入提交）。

**2. [Rule 2 - 补齐] 对话框补 subtitle / title_placeholder / save 三 key**
- **Found during:** Task 2 实现对话框。
- **Issue:** 计划列的 8 key 不含副标题、标题 placeholder、保存按钮文案。
- **Fix:** 按计划「对话框内如需 placeholder / 副标题等自行补 key，三语同步」补齐，三语对齐。

其余严格按计划执行。品牌控件为下拉 Select、无自由文本入口（满足 T-jk9-02 缓解）；SQL 全参数化（T-jk9-01 缓解）。

## Threat Flags

无新增威胁面。计划 threat_model 中 T-jk9-01（参数化绑定 + 空标题拒绝）、T-jk9-02（品牌纯下拉无自由输入）均已实现落地。

## GUI 真机验证待确认

以下交互项子代理无法运行 GUI，待用户在新 build 出来后亲自确认：
1. 详情页「更多」菜单出现「编辑条目信息」，点击打开对话框。
2. 改标题保存 → h1 标题立即更新。
3. 品牌下拉仅列库中已有品牌 + 「无品牌」，无法自由输入新品牌；选「无品牌」保存后信息栏品牌清除。
4. 手动改的标题在 Settings「刷新元数据」后仍保留（refresh_metadata_smart 不触碰 name_cn）。
5. 编辑品牌不误清发行年份。

## Self-Check: PASSED
- FOUND: src/components/library/EditGameInfoDialog.tsx
- FOUND: src-tauri/src/commands.rs update_game_title ×1
- FOUND: src-tauri/src/lib.rs commands::update_game_title ×1
- FOUND commit: a47a9a8 (Task 1)
- FOUND commit: 4a7997d (Task 2)
