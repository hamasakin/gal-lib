---
phase: 04-library-polish
plan: 04c
subsystem: frontend-invoke-layer
tags: [tauri-invoke, zustand-store, types, search, sidebar, tags, game-updates]
requires: [04a (schema v4), 04b (13 backend commands + extended Game struct)]
provides:
  - lib-search-ts (SearchFilter / SortBy / SidebarCategories + searchGames + getSidebarCategories)
  - lib-tags-ts (Tag + listTags / createTag / updateTag / deleteTag / setGameTags / listGameTags)
  - lib-games-ts-extensions (Game v4 fields: brand / release_year / is_favorite; updateGameStatus / updateGameFavorite / updateGameRating / updateGameNotes / updateGameBrandYear)
  - store-library-extensions (searchQuery / sortBy / filter / tags / sidebar slices + setters)
affects: [04d, 04e, 04f]
tech-stack:
  added: []
  patterns:
    - "1:1 type mirror between Rust commands.rs structs and TS interfaces (matches existing scan.ts / launch.ts pattern)"
    - "snake_case field names preserved on inner objects (SearchFilter.tag_id, etc.) — those go through serde, not Tauri arg-name converter"
    - "Store does NOT auto-refetch on slice mutations — components own the searchGames/getSidebarCategories re-fetch (keeps store layer pure state)"
    - "Sentinel EMPTY_FILTER + DEFAULT_SORT_BY = last_played consts at module top, not inlined into create() initialState"
key-files:
  created:
    - src/lib/search.ts
    - src/lib/tags.ts
  modified:
    - src/lib/games.ts
    - src/store/library.ts
decisions:
  - "Tag interface lives in src/lib/tags.ts (not duplicated in search.ts); search.ts imports it from ./tags — single source of truth on the JS side, mirrors the single Tag struct on the Rust side"
  - "filter slice uses {} (EMPTY_FILTER) sentinel rather than null — UI binds individual fields like filter.status; null would force null-guards on every field access. Backend already treats all-undefined filter as 'no clauses'"
  - "DEFAULT_SORT_BY = 'last_played' — surfaces recent plays first on app boot. Backend ORDER BY uses NULLS LAST so unplayed games still render, just sorted to the bottom"
  - "Game.is_favorite typed as boolean (not number) — Rust commands.rs row_to_game converts i64 0/1 to bool via != 0 BEFORE serde serialization, so JS receives JSON true/false (verified in 04b)"
  - "updateGameFavorite arg name is 'favorite' on the JS function but maps to Tauri arg 'isFavorite' (camelCase of Rust is_favorite) — function arg renaming kept the call site terse while preserving Tauri's snake_case-to-camelCase auto-conversion"
  - "Mutation helpers do NOT optimistically apply to the store — callers re-fetch via searchGames + getSidebarCategories. Source-of-truth rule documented in store/library.ts is preserved across the new slices"
metrics:
  duration_minutes: ~3
  completed_at: 2026-05-07T15:37:00Z
  commits: 1
  files_created: 2
  files_modified: 2
  pnpm_typecheck: passed
  invoke_wrappers_added: 13
  store_slices_added: 5
---

# Phase 4 Plan 04c: Frontend invoke layer + library store extensions Summary

**One-liner:** Wire the 13 new 04b Tauri commands into TS-side invoke wrappers across `src/lib/{search,tags,games}.ts`, extend the `Game` type with v4 fields (brand / release_year / is_favorite), and grow `useLibraryStore` with searchQuery/sortBy/filter/tags/sidebar slices — `pnpm typecheck` clean, no UI components touched (04d/04e/04f own UI).

## Tasks Completed

### Task 1 — invoke wrappers + types + store extensions (commit `8bffed6`)

Single commit covers all four files per the plan's commit spec (`feat(04-04c): frontend invoke layer ...`):

**`src/lib/tags.ts` (new, 89 lines):**
- `Tag` interface: `{ id, name, color: string | null }` — 1:1 mirror of `commands.rs::Tag`.
- 6 invoke wrappers: `listTags()`, `createTag(name, color)`, `updateTag(id, name, color)`, `deleteTag(id)`, `setGameTags(gameId, tagIds)`, `listGameTags(gameId)`.
- File header documents the source-of-truth rule (don't optimistically update the store).

**`src/lib/search.ts` (new, 135 lines):**
- `SearchFilter` interface (`tag_id?`, `status?`, `favorite?`, `brand?`, `year_decade?`) with snake_case inner fields per serde.
- `SortBy` literal union (`last_played | created_at | name | playtime | rating`).
- 4 sidebar count interfaces: `TagCount`, `StatusCount`, `BrandCount`, `DecadeCount`.
- `SidebarCategories` interface aggregating all four + `favorite_count`.
- 2 invoke wrappers: `searchGames(query, sortBy, filter)`, `getSidebarCategories()`.
- `Tag` re-imported from `./tags` (no duplicate type).

**`src/lib/games.ts` (modified, +84 lines):**
- `Game` type extended: `brand: string | null`, `release_year: number | null`, `is_favorite: boolean` — column ordering kept aligned with the migration's declaration order (matches the existing convention in this file).
- 5 update helpers: `updateGameStatus`, `updateGameFavorite`, `updateGameRating`, `updateGameNotes`, `updateGameBrandYear`. Each documents its NULL semantics (notes: `null` clears, `""` keeps empty-but-present; brand/year: `null` clears via overwrite-with-NULL).

**`src/store/library.ts` (modified, +69 lines):**
- 5 new slices: `searchQuery: string` (default `""`), `sortBy: SortBy` (default `"last_played"`), `filter: SearchFilter` (default `{}` via `EMPTY_FILTER` sentinel), `tags: Tag[]` (default `[]`), `sidebar: SidebarCategories | null` (default `null`).
- 5 paired setters: `setSearchQuery`, `setSortBy`, `setFilter`, `setTags`, `setSidebar`.
- Existing slices (`scanRoots`, `scanProgress`, `games`, `activeSession`, `sessionsByGame`) untouched.

**Verification — Plan 04c `<verify>` block:**

| Check                                                       | Status |
|-------------------------------------------------------------|--------|
| `src/lib/search.ts` exists                                  | ✓      |
| `src/lib/tags.ts` exists                                    | ✓      |
| `searchGames` defined in `src/lib/search.ts`                | ✓      |
| `getSidebarCategories` defined in `src/lib/search.ts`       | ✓      |
| `listTags` defined in `src/lib/tags.ts`                     | ✓      |
| `setGameTags` defined in `src/lib/tags.ts`                  | ✓      |
| `updateGameStatus` defined in `src/lib/games.ts`            | ✓      |
| `updateGameFavorite` defined in `src/lib/games.ts`          | ✓      |
| `updateGameRating` defined in `src/lib/games.ts`            | ✓      |
| `updateGameNotes` defined in `src/lib/games.ts`             | ✓      |
| `searchQuery` slice in `src/store/library.ts`               | ✓      |
| `sortBy` slice in `src/store/library.ts`                    | ✓      |
| `tags:` slice in `src/store/library.ts`                     | ✓      |
| `pnpm typecheck` exit 0                                     | ✓      |

## Deviations from Plan

None — plan executed exactly as written. The plan was already precise (signatures, slice names, file boundaries all explicit), and 04b had pre-aligned the Rust struct field names with what the plan asked for here.

A few small choices made during implementation that are documented in `decisions` above (not deviations, just clarifications): default `sortBy = "last_played"`, `filter = {}` (not `null`), Tag type lives in tags.ts only.

## Authentication Gates

None.

## Tech Stack Additions

None — pure TS additions. `@tauri-apps/api/core::invoke`, `zustand::create` already in use.

## Schema Touch

None — frontend-only plan. No migrations, no DB writes from this layer (mutations all go through 04b's backend commands).

## Decisions Made

1. **Tag interface single source of truth in `src/lib/tags.ts`** — `search.ts` imports it via `import type { Tag } from "./tags"` rather than redeclaring. Mirrors the single Rust `Tag` struct and avoids drift if `Tag` ever gains a column.
2. **`SearchFilter` keeps snake_case field names (`tag_id`, `year_decade`)** — those fields go through serde deserialization on the Rust side (NOT Tauri's outer-arg-name converter), so they MUST match the Rust struct field names verbatim. Documented prominently in the search.ts file header.
3. **`filter` slice default = `{}` not `null`** — UI components will access `filter.status` etc. directly; `null` would require null-guards everywhere. Backend treats all-undefined as "no clauses applied", so the semantics are equivalent.
4. **`sortBy` default = `"last_played"`** — matches the "what did I play recently" mental model; backend NULLS LAST keeps unplayed games visible at the bottom.
5. **No optimistic store updates** — mutation helpers (`updateGameStatus` etc.) don't touch the store. Callers re-fetch via `searchGames()` + `getSidebarCategories()` after mutations. Same source-of-truth rule already documented at the top of `store/library.ts` for `games`/`scanRoots`.
6. **`updateGameFavorite(gameId, favorite)` not `(gameId, isFavorite)`** — JS function param named `favorite` for terseness; the Tauri invoke arg passes `isFavorite` (camelCase of Rust `is_favorite`), with the rename happening at the call site (`{ gameId, isFavorite: favorite }`). Trade-off: cleaner JS API vs. one extra renamed key — chose cleaner API.

## Known Stubs

None — every wrapper calls a real, implemented 04b backend command. Store slices have functional defaults.

## Threat Flags

None — no new network surface, no auth surface, no file-access patterns. The invoke layer is a pure pass-through to backend commands that 04b already audited.

## Deferred Items

None added by 04c. Pre-existing `D-04a-1` (vite/postcss `@import` order warning) still in `deferred-items.md`, not addressed in this plan (frontend-types-only scope).

## Self-Check: PASSED

Verified:
- `src/lib/search.ts` — FOUND (135 lines, contains `searchGames` and `getSidebarCategories`)
- `src/lib/tags.ts` — FOUND (89 lines, contains all 6 tag invoke wrappers)
- `src/lib/games.ts` — FOUND modified (148 lines, `Game` type extended with `brand`/`release_year`/`is_favorite`, 5 `updateGame*` helpers added)
- `src/store/library.ts` — FOUND modified (157 lines, 5 new slices + 5 setters)
- Commit `8bffed6` (feat 04-04c) — FOUND in `git log`
- `pnpm typecheck` — exit 0, no errors
- All 13 plan-defined `<automated>` grep checks — passed
- No file deletions in commit (`git diff --diff-filter=D` empty)
