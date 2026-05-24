---
quick_id: 260524-dlr
slug: search-prefix-clear-tagjump
created: 2026-05-24
status: in-progress
---

# Quick 260524-dlr — 搜索栏增强 + 详情页标签点击筛选

## 需求

1. **搜索栏尾部清空按钮**（X）：输入框有内容时显示，点击清空 input 与 store.searchQuery。
2. **搜索类型前缀下拉**（位于输入框左侧）：
   - 类型枚举：`游戏名 | 品牌 | 声优 | 标签`
   - `游戏名`（默认）：行为同现状，debounce 200ms → `setSearchQuery` 触发后端 LIKE。
   - 其他三类：输入即触发**本地模糊匹配下拉**（数据来自 `getFilterOptions()` 的 `brands / voices / official_tags`），用户点选条目后 → `setAdvFilter` 把该项加入对应多选维度（brands/staffIds/officialTags），输入框清空便于继续添加；与 FilterPanel 同一 store，已选项立刻反映为「筛选 N」高亮。
3. **详情页标签点击跳转筛选**：
   - 官方标签 `OfficialTagChip` → 点击 `setAdvFilter(officialTags+=tag_name) + navigate('/')`。
   - 右栏「我的标签」(`gameTags`) chip → 点击 `setFilter({ tag_id })` + `navigate('/')`。

## 设计要点

- 现状基础设施齐备：
  - 后端 `SearchFilter` 已支持 `brands[]/staff_ids[]/official_tags[]` 多选筛选（`src/lib/search.ts:59`）。
  - `getFilterOptions()` 已提供 `brands / scenarios / artists / voices / music / official_tags` 全量候选（`src/lib/persons.ts:156`）。
  - `FilterPanel` 已经在通过 `advFilter` 多维 OR 筛选；`Library.tsx` 已经把 `advFilter.brands/staffIds/officialTags` 合入 `SearchFilter` 发给后端。
- 关键改动：`advFilter` 当前是 `Library.tsx` 的局部 `useState`，详情页无法跨路由设置 → **把 `advFilter` 提升到 `useLibraryStore`**，新增 `setAdvFilter`。
- `filterOptions` 仍由 Library 拉取后通过 props 传给 SearchBar（无需上移）。

## 任务分解

### Task 1 — store: 提升 `advFilter`
- `src/store/library.ts`
  - import `AdvancedFilter, EMPTY_ADV_FILTER` from `@/lib/advancedFilter`。
  - state 增加 `advFilter: AdvancedFilter`，初始 `EMPTY_ADV_FILTER`；setter `setAdvFilter`。
- `src/routes/Library.tsx`
  - 删除 `const [advFilter, setAdvFilter] = useState(EMPTY_ADV_FILTER)`。
  - 改用 `useLibraryStore(s => s.advFilter)` + `useLibraryStore(s => s.setAdvFilter)`。
- 提交：`feat(quick-260524-dlr): lift advFilter to library store`

### Task 2 — SearchBar 增强
- `src/components/library/SearchBar.tsx` 大改：
  - props: `{ filterOptions: FilterOptions | null }`。
  - 内部 state：`kind: "name" | "brand" | "voice" | "tag"`（默认 name），`value` 控件，`open`（候选下拉开关）。
  - 左前缀触发器：自定义按钮 + Popover/DropdownMenu 4 选项；选中后 reset value。
  - 右尾部：value !== "" 时显示 `X` 按钮，否则保留原 `⌘K` 键提示。
  - kind="name" 时：保留原 200ms 防抖 → setSearchQuery；下拉不开。
  - kind!="name" 时：value 仅本地用，作为 fuzzy filter 过 `filterOptions` 对应数组；下拉列出前 N 项；点击 / 回车选中 → 调 `setAdvFilter(...)` 加入对应 Set，并清空 value（焦点保留）。
  - 候选下拉用 popover 显示。
- `src/routes/Library.tsx`：把 `<SearchBar />` 改为 `<SearchBar filterOptions={filterOptions} />`。
- 提交：`feat(quick-260524-dlr): SearchBar prefix selector + clear button + facet autocomplete`

### Task 3 — Detail 标签 chip 跳转筛选
- `src/routes/Detail.tsx`
  - `OfficialTagChip`：改 `span` → `button`，新增 `onJump` prop；点击调用 `setAdvFilter({ ...adv, officialTags: new Set(adv.officialTags).add(row.tag_name) }) + navigate('/')`。
  - 右栏「我的标签」chip：同样改 button + onClick → `setFilter({ tag_id: tag.id })` + `navigate('/')`。
- 提交：`feat(quick-260524-dlr): clickable tag chips on detail page jump to filter`

### Task 4 — 校验 + SUMMARY
- `npm run build`（含 tsc）。
- 写 `SUMMARY.md` (status: complete)。
- 更新 `.planning/STATE.md` Quick Tasks 表。

## 风险 / 取舍

- **PersonChip 不动**：现状点击跳转 `/persons/:id`，是 v1.3 已交付契约；改语义会破坏 UAT。声优筛选走「搜索栏 → 类型=声优 → 输入」路径。
- **品牌点击**：详情页右栏已经能跳，本次不再加多入口。
- **真机验证缺位**：搜索下拉、跨路由 advFilter 跳转、清空按钮都是 GUI 交互；本会话只能 build + 手工 walkthrough 代码；按 memory 规则未真机验证不写「根治」字样。
