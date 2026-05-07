---
phase: 04-library-polish
plan: 04d
subsystem: frontend-library-ui
tags: [react, zustand, shadcn, search, sort, filter, sidebar, dropdown-menu, library-route]
requires: [04a (schema v4), 04b (32 commands), 04c (invoke layer + store slices)]
provides:
  - top-bar-controls (SearchBar + SortSelect + FilterChip wired to library store)
  - sidebar-active (auto-categories + tags + click-filter wired to setFilter)
  - card-context-menu-extensions (right-click 收藏 toggle + 通关状态 4-option submenu)
  - library-route-search-loop (effect re-runs searchGames on store query/sort/filter change)
  - mutation-refetch-pattern (GameCard.onMutated → GameGrid.onChildMutation → Library.refetchGrid + refreshSidebar)
affects: [04e, 04f]
tech-stack:
  added: []
  patterns:
    - "Local-state mirror + 200ms debounced commit pattern in SearchBar — keeps input snappy, isolates grid re-render from per-keystroke writes"
    - "Sidebar single-axis activation: clicking a leaf REPLACES store.filter with one slice (clears the others); FilterChip × is the per-slice clear affordance"
    - "Library route is the SINGLE point that calls searchGames — sidebar / chip / search-bar only mutate the store; one useEffect subscribes and re-issues the invoke"
    - "Post-mutation refetch: GameCard.onMutated → GameGrid.onChildMutation → Library.refetchGrid + refreshSidebar; preserves the source-of-truth-is-DB rule from 04c (store layer never optimistically applies)"
    - "Sidebar collapsible groups use native <details>/<summary> + Tailwind group-open: variants — no shadcn Accordion dependency"
    - "Refresh-cover and metadata-rebind paths now refetch via searchGames (current store snapshot) instead of listGames — preserves the active filter view across mutations (Rule 1 fix for 04d-induced regression)"
key-files:
  created:
    - src/components/library/SearchBar.tsx
    - src/components/library/SortSelect.tsx
    - src/components/library/FilterChip.tsx
  modified:
    - src/components/layout/Sidebar.tsx
    - src/components/library/GameCard.tsx
    - src/components/library/GameGrid.tsx
    - src/components/library/MetadataPicker.tsx
    - src/routes/Library.tsx
decisions:
  - "SearchBar uses a local useState mirror of store.searchQuery — typing latency stays in the component, the grid only re-renders once the 200ms debounce promotes the value into the store"
  - "FilterChip renders one Badge per active filter slice (multi-axis ready) — sidebar currently sets one slice at a time, but the chip × clears slices individually so simultaneous filters compose cleanly"
  - "Sidebar 全部 button resets BOTH filter and searchQuery — matches user mental model 'go back to start'; 04-CONTEXT does not specify so this is Claude's discretion"
  - "GameCard new onMutated optional callback flows up through GameGrid.onChildMutation → Library.onChildMutation; Library is the only place that knows search/sort/filter triple, so it owns the refetch"
  - "Library effect uses store.searchQuery directly (not the local SearchBar mirror) — debounce already happened at SearchBar level, the store value IS the debounced value"
  - "Active sidebar item visual: 2px bg-ring left bar + bg-accent (matches the existing 设置 nav active style from P1)"
  - "MetadataPicker post-bind path switched from listGames to searchGames — without this fix, applying metadata while a filter was active would have replaced the grid with the unfiltered set (Rule 1 — 04d-induced regression fix)"
  - "GameGrid.onRefreshCover legacy fallback uses useLibraryStore.getState() imperatively — avoids useCallback dep churn that would otherwise re-create the callback per keystroke"
  - "Sidebar collapsible groups via <details> rather than shadcn Accordion — Accordion would drag in radix-collapsible + extra reactive surface; the disclosure pattern is intrinsic to the element and a11y-correct out of the box"
  - "STATUS_DISPLAY / STATUS_SUBMENU / SORT_OPTIONS arrays at module scope — keeps the locked 04d Chinese copy in one place per file, easy to audit against the lock list"
metrics:
  duration_minutes: ~12
  completed_at: 2026-05-07T15:51:13Z
  commits: 2
  files_created: 3
  files_modified: 5
  pnpm_typecheck: passed
  vite_build: passed
---

# Phase 4 Plan 04d: Frontend Search/Sort/Filter UI + Sidebar polish + Card right-click Summary

**One-liner:** Build the Library top bar (SearchBar with 200ms debounce + SortSelect + FilterChip), fully rewrite the Sidebar with auto-categories (全部 / 收藏 / 通关状态 / 标签 / 品牌 / 年代) wired to `store.filter`, extend GameCard's right-click menu with 收藏 toggle + 通关状态 submenu, and refactor `Library.tsx` so a single effect re-runs `searchGames(query, sort, filter)` whenever the store changes — `pnpm typecheck` + `vite build` clean.

## Tasks Completed

### Task 1: SearchBar + SortSelect + FilterChip components — DONE (commit `5d56a1f`)

Created three components in `src/components/library/`:

- **`SearchBar.tsx`** — Controlled `<Input>` with a local `value` mirror; a 200ms `setTimeout` promotes the local value into `useLibraryStore.searchQuery`. Bidirectional sync: external store changes (e.g. sidebar 全部 reset) hydrate the local mirror via a `useEffect`. Lucide `Search` icon prefix (absolute-positioned + `pl-9` on the input). `flex-1` for top-bar layout.
- **`SortSelect.tsx`** — Wraps shadcn `Select` with the 5 backend-whitelisted options in locked Chinese copy (最近游玩 / 添加日期 / 字母 / 时长 / 评分). `w-40` per 04d execution context. Bound to `store.sortBy` via `onValueChange`.
- **`FilterChip.tsx`** — Renders one `Badge variant="outline"` per active filter slice (`tag_id` / `status` / `favorite` / `brand` / `year_decade`) with locked Chinese labels. Each chip has an inline `<button>` × that calls `setFilter(rest-without-this-slice)` — preserves other active filters. Returns `null` when no slice is active. Tag name resolution falls back to `#${id}` when the tag cache hasn't loaded yet.

**Key decisions:**

- Local-state mirror in SearchBar avoids triggering the grid re-render on every keystroke (only the debounced commit hits the store).
- FilterChip is multi-axis ready even though the sidebar currently sets one slice at a time — supports the 04-CONTEXT "搜索 AND filter 可叠加" rule.
- All Chinese copy verified against the 04d execution-context lock list.

### Task 2: Sidebar full rewrite + GameCard right-click + Library route refactor — DONE (commit `52a73c5`)

**Sidebar (`src/components/layout/Sidebar.tsx`)** — full rewrite, replaces the P1 placeholder:

- On mount: calls `getSidebarCategories()` + `listTags()`, populates `store.sidebar` and `store.tags`.
- Section heading "分类" (preserved). Below it, leaf items + collapsible groups:
  - **全部** — single leaf, resets BOTH filter AND searchQuery.
  - **收藏** — single leaf with count badge, sets `filter.favorite = true`.
  - **通关状态** — collapsible (defaults open). 4 children: 未游玩 / 游玩中 / 已通关 / 已弃, each with count, each click sets `filter.status`.
  - **标签** — collapsible. Children = `sidebar.tags` list, each click sets `filter.tag_id`. Empty fallback "无".
  - **品牌** — collapsible. Children = `sidebar.brands`, each click sets `filter.brand`.
  - **年代** — collapsible. Children = `sidebar.year_decades` buckets (`{decade}s`), each click sets `filter.year_decade`.
- Active state: 2px `bg-ring` left bar + `bg-accent` background — same visual as the existing 设置 nav active state.
- Single-axis activation rule: clicking a leaf clears all other filter axes (sidebar leaves are mutually exclusive). Multi-axis filtering is still possible programmatically and via FilterChip.
- Bottom 设置 nav button preserved.
- Internal helpers: `<SidebarLeaf>` (clickable row + count + active visual) and `<SidebarGroup>` (collapsible heading using native `<details>` + Tailwind `group-open:`).

**GameCard (`src/components/library/GameCard.tsx`)** — extended right-click menu:

- New `收藏 / 取消收藏` toggle (label flips based on `game.is_favorite`) — calls `updateGameFavorite` then notifies parent via `onMutated`.
- New `通关状态` submenu with 4 items (未游玩 / 游玩中 / 已通关 / 已弃) — calls `updateGameStatus`, current status is disabled (no-op anyway, gives the user a visual cue of current state).
- Existing `启动` / `强制结束` / `重新匹配元数据` / `重新抓取封面` items preserved.
- New optional `onMutated` callback prop — called after a successful favorite/status mutation; lets the parent (GameGrid → Library) refetch grid + sidebar consistently. STATUS_SUBMENU array at module scope keeps locked Chinese copy auditable.

**GameGrid (`src/components/library/GameGrid.tsx`)** — passes mutations through:

- New optional `onChildMutation` prop. When provided, `GameCard.onMutated` is forwarded to it (the Library route uses this to re-issue searchGames with the current filter triple).
- `onRefreshCover` upgraded to refetch via `searchGames` with the current store snapshot (`useLibraryStore.getState()`) when no parent hook is wired — preserves the active filter view across cover refreshes (pre-04d this used `listGames` which would silently reset the grid to the unfiltered set).

**MetadataPicker (`src/components/library/MetadataPicker.tsx`)** — post-bind refetch upgraded:

- After a successful `bindMetadata`, switched from `listGames` to `searchGames(currentQuery, currentSort, currentFilter)` + `getSidebarCategories()` — keeps both the active filter view AND the sidebar counts (which can shift when new brand/release_year metadata appears) in sync. Treated as a Rule 1 fix for an 04d-induced regression: without it, applying metadata while a filter was active would replace the grid with the unfiltered set.

**Library route (`src/routes/Library.tsx`)** — top bar + search loop:

- Top bar above the grid: `<SearchBar />` (flex-1) + `<FilterChip />` + `<SortSelect />` (w-40), `gap-3 px-6 pt-4 pb-3`.
- Single `refetchGrid` callback subscribed to `(searchQuery, sortBy, filter)` via useEffect → calls `searchGames(query?, sort, filter?)`. Empty searchQuery becomes `null` (no LIKE clause); all-undefined filter becomes `null`.
- Initial render uses store defaults → `searchGames(null, "last_played", null)`, equivalent to the pre-04d `listGames()` boot output.
- Scan completion still triggers an extra refetch (grid + sidebar).
- New empty state: `filterFoundNothing` (active search/filter, zero rows) shows "无匹配结果" + "清除筛选" CTA. Existing empty states (noScanYet / scanFinishedZeroResults) preserved but only fire when no search/filter is active.
- `onChildMutation` (handed to GameGrid) calls `refetchGrid` + `refreshSidebar`.

**Why a single refetch path (Library owns the searchGames call):**
The store is state-only (per the 04c source-of-truth rule); side-effects belong in components. Putting the searchGames invoke in the Library route's effect means there's exactly one place to reason about "what triggers a re-fetch" — and any new mutation (rating, notes, ratings, future tag-CRUD) just needs to flow through the same `onChildMutation` path. No subscription middleware, no per-component re-fetches, no double fetches.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — 04d-induced regression] Metadata-rebind / refresh-cover path replaced grid with unfiltered set**

- **Found during:** Task 2 (Library route refactor).
- **Issue:** `MetadataPicker.onApply` and `GameGrid.onRefreshCover` both used `listGames()` for their post-mutation refetch. Pre-04d this was correct (the grid showed the unfiltered list). Post-04d the grid is filtered by `(searchQuery, sortBy, filter)` — calling `listGames()` after a successful rebind/cover-refresh would silently replace the filtered view with the full library, breaking the user's filter context.
- **Fix:** Switched both to `searchGames(currentQuery, currentSort, currentFilter)` reading from the store snapshot. MetadataPicker also now refreshes `getSidebarCategories()` because new metadata can introduce previously unseen brand / release_year buckets.
- **Files modified:** `src/components/library/MetadataPicker.tsx`, `src/components/library/GameGrid.tsx`.
- **Commit:** `52a73c5`.

**2. [Rule 2 — auto-add missing critical functionality] Empty-state for "filter narrowed to zero"**

- **Found during:** Task 2 (Library route refactor).
- **Issue:** The pre-04d empty states (`noScanYet`, `scanFinishedZeroResults`) classified `games.length === 0` as either "scan onboarding needed" or "scanned but found nothing". Post-04d a third case exists: the library has games, but the active search/filter excludes all of them. Without a dedicated state, the user would see the misleading "还没有游戏" prompt directing them back to settings.
- **Fix:** Added `filterFoundNothing` state (`games.length === 0 && (hasActiveSearch || hasActiveFilter)`), shown as "无匹配结果" + "清除筛选" CTA which calls `setFilter({}) + setSearchQuery("")`. Existing empty states gated on `!hasActiveSearch && !hasActiveFilter` so they only fire in their genuine case.
- **Files modified:** `src/routes/Library.tsx`.
- **Commit:** `52a73c5`.

### Auth Gates

None.

## Verification

- `pnpm typecheck` → clean.
- `pnpm build` → clean (vite build succeeded; pre-existing CSS @import-order warning in `index.css` is out of 04d scope per SCOPE BOUNDARY rule and tracked in `deferred-items.md` if not already there).
- 04d plan verify-block grep checks → all green:
  - `getSidebarCategories` / `setFilter` / `通关状态` / `品牌` / `年代` / `标签` present in Sidebar.tsx
  - `updateGameFavorite` / `favorite` present in GameCard.tsx
  - `SearchBar` / `SortSelect` / `FilterChip` / `searchGames` present in Library.tsx

## Self-Check: PASSED

- `src/components/library/SearchBar.tsx` — exists.
- `src/components/library/SortSelect.tsx` — exists.
- `src/components/library/FilterChip.tsx` — exists.
- `src/components/layout/Sidebar.tsx` — modified.
- `src/components/library/GameCard.tsx` — modified.
- `src/components/library/GameGrid.tsx` — modified.
- `src/components/library/MetadataPicker.tsx` — modified.
- `src/routes/Library.tsx` — modified.
- Commit `5d56a1f` — present in `git log`.
- Commit `52a73c5` — present in `git log`.
