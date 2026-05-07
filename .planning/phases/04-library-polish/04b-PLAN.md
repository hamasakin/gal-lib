---
phase: 04-library-polish
plan: 04b
type: execute
wave: 2
depends_on: [04a]
files_modified:
  - src-tauri/src/commands.rs
  - src-tauri/src/lib.rs
autonomous: true
requirements: [LIB-03, LIB-04, TAG-01, TAG-02, TAG-03, STAT-01, STAT-02, STAT-03, STAT-04]
must_haves:
  truths:
    - "13 new Tauri commands registered: search_games, list_tags, create_tag, update_tag, delete_tag, set_game_tags, list_game_tags, get_sidebar_categories, update_game_status, update_game_favorite, update_game_rating, update_game_notes, update_game_brand_year"
    - "search_games supports query (LIKE %q% on name + name_cn + path basename + tag.name) + sort_by (last_played | created_at | name | playtime | rating) + filter (tag_id / status / favorite / brand / year_decade)"
    - "get_sidebar_categories returns aggregated counts: { tags: [...], statuses: [...], brands: [...], year_decades: [...] }"
    - "cargo check + cargo test --lib 全绿"
---

# Plan 04b — Backend search/sort/filter + tag CRUD + game-property update commands

## Tasks

<task name="Task 1: implement 13 commands in commands.rs + register in lib.rs">

<read_first>
- D:\project\gal-lib\src-tauri\src\commands.rs (extend; preserve existing 19)
- D:\project\gal-lib\src-tauri\src\lib.rs (extend generate_handler!)
- D:\project\gal-lib\.planning\phases\04-library-polish\04-CONTEXT.md (§Search & Filter, §Tag CRUD, §Sidebar Auto-Categories)
</read_first>

<action>

Implement the 13 commands as `Result<T, String>` per existing pattern.

**Search & Sort:**
- `search_games(query: Option<String>, sort_by: String, filter: Option<SearchFilter>) -> Vec<Game>` — SQL with optional WHERE on query (LIKE) + filter clauses + ORDER BY
  - sort_by: "last_played" → `ORDER BY last_played_at DESC NULLS LAST` / "created_at" → `created_at DESC` / "name" → `name COLLATE NOCASE ASC` / "playtime" → `total_playtime_sec DESC` / "rating" → `rating DESC NULLS LAST`
  - filter: `{ tag_id?: i64, status?: String, favorite?: bool, brand?: String, year_decade?: i32 }` — all optional, ANDed
- `get_sidebar_categories() -> SidebarCategories` — aggregated counts via 4 SELECTs (with empty defaults)

**Tag CRUD:**
- `list_tags() -> Vec<Tag>` — SELECT * FROM tags ORDER BY name
- `create_tag(name: String, color: Option<String>) -> i64` — INSERT, return id
- `update_tag(id: i64, name: String, color: Option<String>) -> ()` — UPDATE
- `delete_tag(id: i64) -> ()` — DELETE (cascade via FK)
- `set_game_tags(game_id: i64, tag_ids: Vec<i64>) -> ()` — DELETE FROM game_tags WHERE game_id=? + INSERT each pair (transactional)
- `list_game_tags(game_id: i64) -> Vec<Tag>`

**Game property updates:**
- `update_game_status(game_id, status)` (CHECK enum: unplayed/playing/cleared/dropped)
- `update_game_favorite(game_id, is_favorite: bool)` — store as 0/1 INTEGER
- `update_game_rating(game_id, rating: Option<i32>)` (NULL or 1-10)
- `update_game_notes(game_id, notes: Option<String>)`
- `update_game_brand_year(game_id, brand: Option<String>, release_year: Option<i32>)` — used by metadata pipeline (META re-fetch)

**lib.rs:** append 13 new entries to `generate_handler!`. Preserve all 19 prior commands → total 32.

**Tag struct (in commands.rs):**
```rust
#[derive(Serialize, Deserialize, Debug, Clone, FromRow)]
pub struct Tag { pub id: i64, pub name: String, pub color: Option<String> }
```

**SearchFilter struct:**
```rust
#[derive(Deserialize, Debug, Clone, Default)]
pub struct SearchFilter {
    pub tag_id: Option<i64>,
    pub status: Option<String>,
    pub favorite: Option<bool>,
    pub brand: Option<String>,
    pub year_decade: Option<i32>,
}
```

**SidebarCategories:**
```rust
#[derive(Serialize, Debug, Clone)]
pub struct SidebarCategories {
    pub tags: Vec<TagWithCount>,
    pub statuses: Vec<StatusCount>,
    pub brands: Vec<BrandCount>,
    pub year_decades: Vec<DecadeCount>,
    pub favorite_count: i64,
}
```
Where `TagWithCount { tag: Tag, count: i64 }`, etc.

cargo check + cargo test --lib 全绿。

</action>

<verify>
<automated>
cd D:\project\gal-lib && \
grep -q "search_games" src-tauri/src/commands.rs && \
grep -q "list_tags" src-tauri/src/commands.rs && \
grep -q "set_game_tags" src-tauri/src/commands.rs && \
grep -q "get_sidebar_categories" src-tauri/src/commands.rs && \
grep -q "update_game_status" src-tauri/src/commands.rs && \
grep -q "update_game_favorite" src-tauri/src/commands.rs && \
grep -q "update_game_rating" src-tauri/src/commands.rs && \
grep -q "update_game_notes" src-tauri/src/commands.rs && \
grep -q "commands::search_games" src-tauri/src/lib.rs && \
grep -q "commands::list_tags" src-tauri/src/lib.rs && \
grep -q "commands::set_game_tags" src-tauri/src/lib.rs && \
grep -q "commands::update_game_favorite" src-tauri/src/lib.rs && \
cargo check --manifest-path src-tauri/Cargo.toml && \
cargo test --manifest-path src-tauri/Cargo.toml --lib
</automated>
</verify>

</task>

## Commit

`feat(04-04b): wire 13 backend commands (search/sort + tag CRUD + game property updates)`
