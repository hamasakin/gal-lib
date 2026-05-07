---
phase: 04-library-polish
plan: 04c
type: execute
wave: 3
depends_on: [04a, 04b]
files_modified:
  - src/lib/search.ts
  - src/lib/tags.ts
  - src/lib/games.ts
  - src/store/library.ts
autonomous: true
requirements: [LIB-03, LIB-04, TAG-02]
must_haves:
  truths:
    - "src/lib/search.ts: searchGames + getSidebarCategories"
    - "src/lib/tags.ts: listTags + createTag + updateTag + deleteTag + setGameTags + listGameTags"
    - "src/lib/games.ts extended: updateGameStatus + updateGameFavorite + updateGameRating + updateGameNotes + updateGameBrandYear"
    - "src/store/library.ts extended: searchQuery / sortBy / filter slices + tags slice + sidebar slice"
    - "pnpm typecheck 退出 0"
---

# Plan 04c — Frontend invoke layer + library store extensions

## Tasks

<task name="Task 1: invoke wrappers + types">

<read_first>
- D:\project\gal-lib\src-tauri\src\commands.rs (13 new commands, signatures)
- D:\project\gal-lib\src/lib/scan.ts (existing pattern)
- D:\project\gal-lib\src/lib/games.ts (existing — extend)
</read_first>

<action>

1. **`src/lib/search.ts`** — types + 2 helpers:
```ts
export interface SearchFilter { tag_id?: number; status?: string; favorite?: boolean; brand?: string; year_decade?: number; }
export type SortBy = "last_played" | "created_at" | "name" | "playtime" | "rating";
export interface TagCount { tag: Tag; count: number }
export interface StatusCount { status: string; count: number }
export interface BrandCount { brand: string; count: number }
export interface DecadeCount { decade: number; count: number }
export interface SidebarCategories {
  tags: TagCount[];
  statuses: StatusCount[];
  brands: BrandCount[];
  year_decades: DecadeCount[];
  favorite_count: number;
}
export async function searchGames(query: string | null, sortBy: SortBy, filter: SearchFilter | null): Promise<Game[]>;
export async function getSidebarCategories(): Promise<SidebarCategories>;
```

2. **`src/lib/tags.ts`**:
```ts
export interface Tag { id: number; name: string; color: string | null }
export async function listTags(): Promise<Tag[]>;
export async function createTag(name: string, color: string | null): Promise<number>;
export async function updateTag(id: number, name: string, color: string | null): Promise<void>;
export async function deleteTag(id: number): Promise<void>;
export async function setGameTags(gameId: number, tagIds: number[]): Promise<void>;
export async function listGameTags(gameId: number): Promise<Tag[]>;
```

3. **`src/lib/games.ts`** — extend with 5 update helpers:
```ts
export async function updateGameStatus(gameId: number, status: "unplayed" | "playing" | "cleared" | "dropped"): Promise<void>;
export async function updateGameFavorite(gameId: number, favorite: boolean): Promise<void>;
export async function updateGameRating(gameId: number, rating: number | null): Promise<void>;
export async function updateGameNotes(gameId: number, notes: string | null): Promise<void>;
export async function updateGameBrandYear(gameId: number, brand: string | null, releaseYear: number | null): Promise<void>;
```
Also extend `Game` type with `brand: string | null; release_year: number | null; is_favorite: boolean` (mind sqlx returns INTEGER 0/1; backend should serialize is_favorite as bool — verify in 04b).

4. **`src/store/library.ts`** — extend with:
```ts
searchQuery: string;
sortBy: SortBy;
filter: SearchFilter;
tags: Tag[];
sidebar: SidebarCategories | null;
setSearchQuery / setSortBy / setFilter / setTags / setSidebar;
```

5. pnpm typecheck 绿。

</action>

<verify>
<automated>
cd D:\project\gal-lib && \
test -f src/lib/search.ts && \
test -f src/lib/tags.ts && \
grep -q "searchGames" src/lib/search.ts && \
grep -q "getSidebarCategories" src/lib/search.ts && \
grep -q "listTags" src/lib/tags.ts && \
grep -q "setGameTags" src/lib/tags.ts && \
grep -q "updateGameStatus" src/lib/games.ts && \
grep -q "updateGameFavorite" src/lib/games.ts && \
grep -q "updateGameRating" src/lib/games.ts && \
grep -q "updateGameNotes" src/lib/games.ts && \
grep -q "searchQuery" src/store/library.ts && \
grep -q "sortBy" src/store/library.ts && \
grep -q "tags:" src/store/library.ts && \
pnpm typecheck
</automated>
</verify>

</task>

## Commit

`feat(04-04c): frontend invoke layer (search/tags/game updates) + store extensions`
