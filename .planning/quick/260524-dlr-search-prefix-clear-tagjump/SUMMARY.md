---
quick_id: 260524-dlr
slug: search-prefix-clear-tagjump
created: 2026-05-24
status: complete
commits:
  - 177959f refactor(quick-260524-dlr): lift advFilter to library store
  - a44bfef feat(quick-260524-dlr): SearchBar 前缀类型 + 清空按钮 + facet 自动补全
  - 08711d4 feat(quick-260524-dlr): 详情页标签 chip 可点击跳转筛选
  - 5355b89 fix(quick-260524-dlr): MetadataPicker 候选条目宽度收敛 + 简介换行 hover tooltip
---

# Quick 260524-dlr — 搜索栏增强 + 详情页标签点击筛选 + MetadataPicker 溢出修复

## 4 项改动

### 1. `advFilter` 提升到 `useLibraryStore`（177959f）
- `src/store/library.ts`：新增 `advFilter / setAdvFilter` slice，初始 `EMPTY_ADV_FILTER`。
- `src/routes/Library.tsx`：`useState<AdvancedFilter>` → `useLibraryStore` selector。
- 作用：让 Detail / SearchBar / 未来 sidebar 等不在 Library 内部的组件能直接设置 facet 多选筛选并 `navigate('/')` 触发应用。

### 2. SearchBar 前缀类型 + 清空 + 实时模糊补全（a44bfef）
- 左前缀 DropdownMenu：`游戏名 / 品牌 / 声优 / 标签`。
  - `游戏名`（默认）：保留 v1.0 200ms 防抖 → `store.searchQuery` → 后端 LIKE。
  - `品牌 / 声优 / 标签`：输入仅本地，命中 `filterOptions.brands / voices / official_tags` 候选；下拉前 12 项；点击或回车选中即 `setAdvFilter` 把项加入对应多选 Set，input 清空便于继续追加；已选项不再出现在候选里。
- 右尾部 X 清空按钮（有内容显示，否则保留 `⌘K` 键提示）；name 模式清 input 同时清 `store.searchQuery`，其他模式只清 input。
- Esc：先收下拉、再清 input；mousedown 容器外关下拉；下拉项 mouseDown 阻断 input blur 避免抖动。
- 容器整体宽度 `w-[360px]`（原 `w-72`），容纳类型下拉 + ⌘K/X。
- `Library.tsx` 把 `filterOptions` 透传给 `SearchBar`。

### 3. 详情页标签 chip 可点击跳转筛选（08711d4）
- `OfficialTagChip`：`span` → `button` + `onJump` prop。点击：`setAdvFilter({ ...adv, officialTags: new Set(adv.officialTags).add(name) }) + navigate('/')`。hover 边框 / 底色 brand 高亮，title 改成 `{source} · {weight} — 点击筛选`。
- 右栏「我的标签」用户 chip：`span` → `button`，onClick → `setFilter({ tag_id })` + `navigate('/')`。
- Detail 顶部增 `advFilter / setAdvFilter` 选择子 + 两个 handler `onOfficialTagJump` / `onUserTagJump`。
- 不动 `PersonChip`（v1.3 契约：点击跳人物页 `/persons/:id`），声优筛选走「搜索栏类型=声优 → 输入」路径。

### 4. MetadataPicker 候选条目宽度收敛 + 简介换行（5355b89）
- 根因：候选行长文案被裁不显示并非 `line-clamp` 失效，而是 (a) ScrollArea/ul/li/button 链路宽度未严格收敛，长 CJK 串撑开 flex item；(b) `<span>` 上的 `line-clamp` 触发条件不稳。
- 修复：
  - ScrollArea + ul + li + button 全链路 `w-full · min-w-0 · max-w-full · overflow-hidden`（ScrollArea 额外 `overflow-x-hidden`）。
  - 文本块 `<span>` → `<div>` + `break-words`，CJK 无空格也能换行，line-clamp 生效。
  - 标题 `line-clamp-3` / 别名 `line-clamp-2` / 简介 `line-clamp-3`；溢出由 button 上聚合的 `title` 属性做 hover tooltip 一次展示原标题 + 别名 + 完整简介。

## 自动化校验

- `npm run build`（tsc -b + vite build）通过：1962 modules transformed，built in 3.26s。

## 待真机验证（不写「根治」）

- 搜索栏切类型、输入触发下拉、点击候选入 advFilter chip 计数
- 清空按钮在 name / 非 name 模式分别清的范围
- 详情页点官方标签 / 用户标签 → 跳回图书馆且 chip 立即出现在筛选选中态
- MetadataPicker 候选行：长标题 / 长简介在容器内换行且 hover 弹完整原文

## 不在范围

- 后端 `SearchFilter` 已支持 `brands[] / staff_ids[] / official_tags[]`，本次零后端改动。
- 不动 `PersonChip` 点击语义（跳人物页）。
- 不再为详情页其他位置（品牌已能跳）增加冗余入口。
