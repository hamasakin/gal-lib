# Phase 11 Summary — Metadata Enrichment & Multi-dim Filtering

**Status:** Complete (human-verified items deferred to milestone audit per autonomous-mode policy)
**Shipped:** 2026-05-09
**Plans:** 7 (11a → 11g)
**Commits:** 8 (planning + 7 plans)

## What shipped

### Schema v7 (Plan 11a — `508212f`)
- `games.summary` column for Bangumi/VNDB synopsis text
- 3 new tables: `persons` (cross-source person registry), `game_staff` (N:M with role enum scenario/artist/voice/music + character_name for voice), `game_official_tags` (Bangumi/VNDB official tag list, decoupled from user-built `tags`/`game_tags`)
- 4 indexes (game_staff×2, official_tags×2)

### Bangumi/VNDB API client widening (Plan 11b — `c80ec34`)
- `MetadataDetail` extended with `brand` + `tags: Vec<OfficialTagRef>`
- New types `StaffRole` (4-role enum) / `PersonRef` / `OfficialTagRef`
- Bangumi: `fetch_detail` parses infobox 开发/发行/厂商/品牌 + `subject.tags`; new `fetch_persons` (`/v0/subjects/{id}/persons`) + `fetch_characters` (`/v0/subjects/{id}/characters`)
- VNDB: `fetch_detail` GraphQL extended with `developers/tags/staff/va` (single combined call); separate `fetch_persons` / `fetch_characters` helpers for backfill
- Cross-source role normalization (Chinese → enum for Bangumi; collapses art+chardesign for VNDB)

### Ingest pipeline + IPC layer (Plan 11c — `67e016a`)
- `IngestResult` carries `summary/brand/staff/tags`
- `process_game(_cached)` calls `fetch_detail + fetch_persons + fetch_characters` after final_choice; best-effort, never aborts ingest
- New `write_staff_and_tags` tx-helper called from all 4 ingest sites (start_scan, add_game, refresh_metadata, refresh_all_metadata, bind_metadata)
- 6 new IPC commands registered in lib.rs:
  - `list_persons_for_game`, `list_games_for_person`, `list_official_tags_for_game`
  - `get_filter_options` (returns FilterOptions with brands/scenarios/artists/voices/music/official_tags)
  - `backfill_metadata_enrichment` (async, emits meta-fetch-progress per game)
  - `open_external_url` (cmd /C start fallback; http(s) prefix validation)
- `SearchFilter` extended with `staff_ids[] / brands[] / official_tags[]` (multi-dim AND across, OR within)

### Frontend types + invoke wrappers (Plan 11d — `1083f01`)
- `Game.summary` field added
- New `lib/persons.ts` with full type set (GameStaffRow / OfficialTagRow / FilterOptions / PersonOption / TagOption) + 6 invoke wrappers + bangumiSubjectUrl/vndbVnUrl helpers
- `AdvancedFilter` extended with `brands/staffIds/officialTags` Sets
- `applyAdvancedFilter` handles brand client-side; staff/tags route to backend

### Detail page metadata display (Plan 11e — `347ed40`)
- 总览 tab: real summary renderer (paragraph splitting, line-height 1.7, max-width 68ch)
- 制作团队 section grouped by role (scenario/artist/voice/music) with lucide icons; voice chips show `角色 · 演员` format; click → `/persons/:id`
- 官方标签 region in right sidebar below user TagPicker
- Hero pills: `在 Bangumi 看 ↗` / `在 VNDB 看 ↗` external-link buttons (replaces previous BGM·id / VNDB·id pills)

### Library multi-dim FilterPanel (Plan 11f — `f7f80ae`)
- 4 new sections after the existing 4: 品牌, 编剧, 画师, 声优, 官方标签 (music skipped — niche interest)
- Each section: local search input (`<input type="search">`), chip multi-select capped at 60 with "更多 N >" / "收起" expander
- `Library.tsx` fetches `getFilterOptions()` on mount + at scan-completion edge; passes `options={filterOptions}` to FilterPanel
- `refetchGrid` merges new SearchFilter fields into the backend search_games invoke

### Persons aggregate page (Plan 11g — `f48f86c`)
- `/persons/:id` route registered
- 4 parallel `listGamesForPerson` calls (one per role) for clean fan-out
- Identity derivation: first-game's listPersonsForGame → match person_id (defensive "未知人物" fallback)
- Voice section adds `饰 · {character_name}` caption per card
- Reuses GameCard from library; PageHeader pattern matches Stats/Screenshots
- Hydrates useLibraryStore.games on deep-link; loading/empty/invalid-id states all handled

## Stats

- **Files changed:** 18 (Rust: 6, TypeScript: 11, Migration: 1)
- **New IPC commands:** 6
- **New routes:** 1 (`/persons/:id`)
- **New tables:** 3
- **Tests:** 59 passing (cargo); pnpm tsc clean
- **Bundle delta:** `cargo build` succeeds (warnings only); frontend bundle delta deferred to next `pnpm build` audit

## Outstanding (deferred to milestone audit per autonomous-mode policy)

UI-01 / UI-02 / UI-03 mark as `human_needed` in VERIFICATION.md — UI flows compile + type-check but need real-app smoke test (browser navigation, popover layout, real Bangumi/VNDB data quality, backfill 10-min E2E observation).

## Carry-over to v1.3 / future seeds

- Person dedup across Bangumi+VNDB (same author currently appears as 2 rows)
- Person aggregate page enrichment (timeline / co-staff recommendations) — `seeds/persons-page-enrichment.md`
- Person portrait local caching
- Backfill progress UI (currently emits events; full progress bar in PageHeader pending if user-visible value warrants it)
