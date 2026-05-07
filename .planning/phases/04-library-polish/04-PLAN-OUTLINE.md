# Phase 4 Plan Outline

**Phase:** 04-library-polish
**Goal:** 用户能快速找到任意游戏，给游戏打标签/状态/评分/笔记，通过详情页查看完整信息，通过设置页管理库配置
**Phase req IDs:** LIB-03, LIB-04, LIB-05, LIB-07, TAG-01..04, STAT-01..04 (12 IDs)

Plans are SERIAL.

| Plan | Objective | Wave | Depends On | Requirements |
|---|---|---|---|---|
| 04a | Schema v4 + 4 new shadcn blocks (textarea / tabs / popover / command) + react-markdown + remark-gfm install | 1 | [] | (foundation) |
| 04b | Backend: search_games + sort + sidebar_categories + tag CRUD + game status/favorite/rating/notes update commands | 2 | [04a] | LIB-03, LIB-04, TAG-01..03, STAT-01..04 |
| 04c | Frontend invoke layer (search.ts, tags.ts, games.ts extension) + library store extensions (search/sort/filter slices, tags slice) | 3 | [04a, 04b] | LIB-03, LIB-04, TAG-02 |
| 04d | Library route polish: SearchBar + SortSelect + active filter chip; Sidebar activates with tag list + auto-categories + click-filter; GameCard right-click extends (favorite/status) | 4 | [04a, 04c] | LIB-03, LIB-04, TAG-03, TAG-04, STAT-02 |
| 04e | Detail page (full version) — Tabs + Notes textarea + Tag picker (combobox) + 5-star rating + Status dropdown + favorite toggle | 5 | [04a, 04c] | LIB-05, STAT-01..04, TAG-02 |
| 04f | Settings page polish: 标签管理 section (CRUD UI) + UI 偏好 section (默认排序 select) | 6 | [04a, 04c] | LIB-07, TAG-01 |

## Coverage Map

| REQ-ID | Plan |
|---|---|
| LIB-03 | 04b (search_games cmd) + 04d (SearchBar UI) |
| LIB-04 | 04b (sort SQL) + 04d (SortSelect UI) |
| LIB-05 | 04e (full Detail with tabs) |
| LIB-07 | 04f (Settings polish) |
| TAG-01 | 04b (CRUD cmds) + 04f (mgmt UI) |
| TAG-02 | 04b (set_game_tags) + 04e (Detail tag picker) |
| TAG-03 | 04d (sidebar tag list + filter) |
| TAG-04 | 04b (sidebar_categories agg) + 04d (sidebar render) |
| STAT-01 | 04b (update_game_status) + 04e (Detail status dropdown) |
| STAT-02 | 04b (update_game_favorite) + 04d (right-click) + 04e (Detail star toggle) |
| STAT-03 | 04b (update_game_rating) + 04e (Detail 5-star) |
| STAT-04 | 04b (update_game_notes) + 04e (Detail textarea autosave) |

All 12 IDs covered.

## Cross-cutting Constraints

- 04a 一次性 lockup（schema + shadcn + npm）；其他 plan 直接消费
- `src-tauri/src/commands.rs`: 04b 一次性追加全部新 commands（13+ 个）
- `src-tauri/src/lib.rs`: 04b 一次性写入 generate_handler! 扩展
- `src/store/library.ts`: 04c 一次性扩展（search/sort/filter/tags slices）
- `src/components/layout/Sidebar.tsx`: 04d 完整覆写
- `src/routes/Library.tsx`: 04d 完整覆写（在 P3 基础上）
- `src/routes/Detail.tsx`: 04e 完整覆写（替换 P3 minimal version）
- `src/routes/Settings.tsx`: 04f 追加 2 sections

## Schema v4 Diff

```sql
ALTER TABLE games ADD COLUMN brand TEXT;
ALTER TABLE games ADD COLUMN release_year INTEGER;
ALTER TABLE games ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0;
UPDATE app_meta SET value = '4' WHERE key = 'schema_version';
```

## OUTLINE COMPLETE
Plans: 04a, 04b, 04c, 04d, 04e, 04f
