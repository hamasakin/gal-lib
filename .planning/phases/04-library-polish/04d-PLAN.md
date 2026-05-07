---
phase: 04-library-polish
plan: 04d
type: execute
wave: 4
depends_on: [04a, 04c]
files_modified:
  - src/components/library/SearchBar.tsx
  - src/components/library/SortSelect.tsx
  - src/components/library/FilterChip.tsx
  - src/components/layout/Sidebar.tsx
  - src/components/library/GameCard.tsx
  - src/routes/Library.tsx
autonomous: true
requirements: [LIB-03, LIB-04, TAG-03, TAG-04, STAT-02]
must_haves:
  truths:
    - "Library 顶部 search bar (debounce 200ms) + sort select + active filter chip"
    - "Sidebar 完整覆写：分类 (全部/收藏/通关状态 4 项) + 标签列表 + 品牌 + 年代 — 点击设置 store filter + GameGrid 重新查询"
    - "GameCard 右键菜单扩展：收藏 toggle + 4 个状态切换"
    - "Library 主区根据 store {searchQuery, sortBy, filter} 调 searchGames 并渲染"
    - "pnpm typecheck + vite build 全绿"
---

# Plan 04d — Frontend Search/Sort/Filter UI + Sidebar polish + Card right-click

## Tasks

<task name="Task 1: SearchBar + SortSelect + FilterChip components">

<read_first>
- D:\project\gal-lib\src/lib/search.ts + src/store/library.ts (04c)
- D:\project\gal-lib\.planning\phases\04-library-polish\04-CONTEXT.md (§Search & Filter UX)
</read_first>

<action>

1. **`src/components/library/SearchBar.tsx`** — `<Input>` debounce 200ms, onChange → setSearchQuery + 触发 searchGames; lucide `Search` icon prefix
2. **`src/components/library/SortSelect.tsx`** — shadcn `Select` with 5 options (`最近游玩` / `添加日期` / `字母` / `时长` / `评分`), onChange → setSortBy
3. **`src/components/library/FilterChip.tsx`** — 渲染 store.filter 当前激活值（标签名 / 状态文字 / 品牌 / 年代）作为 Badge variant="outline" with × icon; click × → 清除该 filter slice
4. Library top bar: 横排 SearchBar (flex-1) + FilterChip + SortSelect (w-40)

</action>

<verify>
<automated>
cd D:\project\gal-lib && \
test -f src/components/library/SearchBar.tsx && \
test -f src/components/library/SortSelect.tsx && \
test -f src/components/library/FilterChip.tsx && \
grep -q "lucide-react.*Search" src/components/library/SearchBar.tsx && \
grep -q "最近游玩" src/components/library/SortSelect.tsx
</automated>
</verify>

</task>

<task name="Task 2: Sidebar full rewrite + GameCard right-click + Library route refactor">

<read_first>
- D:\project\gal-lib\src/components/layout/Sidebar.tsx (P1 placeholder; full replace)
- D:\project\gal-lib\src/components/library/GameCard.tsx (extend dropdown)
- D:\project\gal-lib\src/routes/Library.tsx (P3 — extend with top bar + sidebar wired filter)
</read_first>

<action>

1. **`src/components/layout/Sidebar.tsx`** — full overwrite:
   - on mount: call `getSidebarCategories()` → store.setSidebar
   - 4 sections (collapsible — use shadcn `Accordion` if needed; otherwise plain divs):
     - **分类** — 全部 / 收藏 (with count) / 通关状态 (4 children) / 标签 (children list from sidebar.tags) / 品牌 (children) / 年代 (children)
   - Each item is `<button>` clickable → `setFilter({ tag_id / status / favorite / brand / year_decade })` and reset other slices
   - Active state visual: 2px accent left bar + bg-accent
   - "全部" item resets all filters

2. **`src/components/library/GameCard.tsx`** — extend DropdownMenu items:
   - `收藏` / `取消收藏` (toggle is_favorite)
   - `通关状态` submenu with 4 options (unplayed/playing/cleared/dropped)
   - 现有 `重新匹配元数据` / `重新抓取封面` / `启动` 保留

3. **`src/routes/Library.tsx`** — extend:
   - Above GameGrid: `<SearchBar />` + `<FilterChip />` + `<SortSelect />` row
   - Effect: subscribe to (searchQuery, sortBy, filter) store → call `searchGames` → store.setGames
   - Initial load uses `searchGames(null, "last_played", null)`

4. pnpm typecheck + vite build green.

</action>

<verify>
<automated>
cd D:\project\gal-lib && \
grep -q "getSidebarCategories" src/components/layout/Sidebar.tsx && \
grep -q "setFilter" src/components/layout/Sidebar.tsx && \
grep -q "通关状态\|品牌\|年代\|标签" src/components/layout/Sidebar.tsx && \
grep -q "updateGameFavorite\|favorite" src/components/library/GameCard.tsx && \
grep -q "SearchBar\|SortSelect\|FilterChip" src/routes/Library.tsx && \
grep -q "searchGames" src/routes/Library.tsx && \
pnpm typecheck
</automated>
</verify>

</task>

## Commits

- `feat(04-04d): top-bar search/sort/filter components`
- `feat(04-04d): sidebar polish + card right-click extensions + library wiring`
