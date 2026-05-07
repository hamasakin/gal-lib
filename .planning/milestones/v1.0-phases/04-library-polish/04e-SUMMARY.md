---
phase: 04-library-polish
plan: 04e
subsystem: frontend-detail
tags: [detail, tabs, rating, tags, notes, autosave, markdown]
requires:
  - 04a (shadcn tabs / textarea / popover / command + react-markdown + remark-gfm)
  - 04b (set_game_tags / list_game_tags / create_tag + update_game_* commands)
  - 04c (frontend invoke wrappers in lib/games.ts + lib/tags.ts; Game extended with v4 fields)
provides:
  - Detail page full layout (Tabs: 简介 / 标签 / 笔记 / 会话历史 / 设置)
  - StarRating component (5 stars × 2 pts/star = DB 1..=10)
  - TagPicker component (popover + command combo with inline tag creation)
  - Notes autosave (debounce 800ms via useEffect [notes] setTimeout cleanup)
  - Per-game tag chip list + editor surface
affects:
  - src/routes/Detail.tsx (full rewrite — replaces P3 minimal version)
  - src/components/library/ (+ StarRating.tsx + TagPicker.tsx)
tech-stack:
  added: []
  patterns:
    - Staged-commit pattern in TagPicker (popover close → diff commit) — avoids per-toggle round-trip
    - Half-star detection via PointerEvent.clientX vs. boundingClientRect.width (no precomputed half-zones)
    - Notes autosave debounce — useEffect [notes] body: setTimeout 800ms calling updateGameNotes; cleanup clears timer
    - "保存中..." / "已保存 N 秒前" status driven by setInterval(1s) + last-save timestamp
    - Hydration-flag pattern (notesHydratedRef.current) to suppress one-shot autosave fire after listGames hydrate
    - Synthesized markdown blurb (brand + release_year) for 简介 tab — exercises ReactMarkdown pipeline before META phase populates real summary column
key-files:
  created:
    - src/components/library/StarRating.tsx
    - src/components/library/TagPicker.tsx
  modified:
    - src/routes/Detail.tsx
decisions:
  - StarRating click on currently-selected value clears (toggle off) — gives users an inline undo without forcing × button click
  - TagPicker stages selection in local Set<number>; commits diff on popover close (not on every toggle)
  - "创建新标签" path immediately persists via setGameTags so the new id surfaces even if user closes via Esc
  - Detail Tabs default value = "summary" so the most-information-dense tab is visible on landing
  - Status dropdown in hero (not in 设置 tab) — daily-use path, deserves first-class real estate
  - Notes autosave debounce 800ms (CONTEXT-locked) via useEffect dep [notes]; cleanup pattern preserves single in-flight save
  - 设置 tab gets a separate '保存' button (split out from 启动) — hero now owns the daily-use launch flow, settings tab owns config-only saves
  - Sessions list auto-refetches on activeSession→null transition for THIS game (so a new completed row appears immediately after the player closes the game)
metrics:
  duration: ~22min
  completed: 2026-05-08
---

# Phase 4 Plan 04e: Full Detail Page Summary

Full rewrite of the `/games/:id` Detail route — replaces the P3 minimal cut
(cover + name + launch config + sessions list) with a 5-tab layout (简介 /
标签 / 笔记 / 会话历史 / 设置) plus an enriched hero with star rating,
favorite toggle, status dropdown, and the launch button. Two new library
components shipped: `<StarRating>` (5-star half-precision; DB 1..=10) and
`<TagPicker>` (popover + cmdk command combo with inline tag creation).

## Tasks Completed

### Task 1: StarRating + TagPicker components

**Files (created):**
- `src/components/library/StarRating.tsx` — 5-star with half precision; props
  `value: number | null` (DB scale 1..=10), optional `onChange` (readonly
  when omitted). Hover preview computes pending value via pointer geometry
  (left half = odd / half star, right half = even / full star). Click on
  current value toggles to null (inline undo). Inline × button clears
  rating; rendered only when `value != null` and editable. Half-fill
  rendered as an absolutely-positioned overlay clipped to `w-1/2`.
- `src/components/library/TagPicker.tsx` — shadcn `Popover` + cmdk `Command`
  combo. Local `stagedIds: Set<number>` tracks selection while popover is
  open; closing the popover commits the diff via `setGameTags(gameId, ids)`
  in a single round-trip. Search input filters via cmdk default; when
  the search query has no exact (case-insensitive) match against any tag
  name, a "创建新标签 '<query>'" CommandItem appears below the regular
  list and runs `createTag(query, null)` + immediate persist (so a hard
  popover close via Esc doesn't lose the new tag).

**Commit:** `6332454`

**Verification:** `pnpm typecheck` green; `grep` checks for `Star` /
`Popover` / `Command` / `setGameTags` all hit.

### Task 2: Detail.tsx full rewrite

**Files (modified):**
- `src/routes/Detail.tsx` — replaces the entire P3 minimal route. New
  structure:
  - **Hero:** cover (200×267) + display name + secondary name (when
    `name_cn` differs) + 总时长 row + status Badge + affordance row
    (status `<Select>` 4 options / 收藏 `<Heart>` toggle / `<StarRating>`)
    + 启动 button. Same `otherActive` / `noExe` / `isActive` gating as
    P3 — single-session lock preserved.
  - **Tabs:** shadcn `Tabs` with `variant="line"` indicator. Five
    triggers: 简介 / 标签 / 笔记 / 会话历史 / 设置 (locked Chinese copy
    from CONTEXT/UI-SPEC). `defaultValue="summary"`.
  - **简介:** `react-markdown` + `remarkGfm` rendering of a synthesized
    markdown blurb (`buildSummaryMarkdown(game)` — brand + release_year +
    cover_url). When all three are null, renders the locked '暂无简介'
    fallback. NOTE: `summary` column is not in schema v4 — when META
    phase adds it, replace the synthesizer with `game.summary` directly.
  - **标签:** chip list with optional color dot + `<TagPicker>` editor.
    `onTagsChanged` refetches `listTags()` AND `listGameTags(gameId)`
    in parallel (covers the create-new-tag case for `allTags` cache).
  - **笔记:** `<Textarea>` value=notes (hydrated from `game.notes`) +
    debounced 800ms autosave via `useEffect [notes]` setTimeout. Status
    row uses `aria-live="polite"` and shows '保存中...' (during invoke)
    or '已保存 N 秒前' (driven by 1Hz setInterval tick + lastSavedAt
    timestamp). `notesHydratedRef` flag suppresses the autosave that
    would otherwise fire once after the initial hydrate.
  - **会话历史:** preserved P3 sessions list (倒序) + locked empty state
    '还没有游玩记录 — 启动游戏开始记录'. Bonus refetch: `prevActiveRef`
    detects activeSession→null for THIS game and re-runs
    `listSessions(gameId)` so the just-completed row appears without
    a manual reload.
  - **设置:** preserved P3 launch config (LE Profile / 启动参数 / cwd)
    + new `executable_path` Input (留空 = 自动识别) + explicit '保存'
    button. Save handler is `onSaveLaunchConfig` (separate from launch
    flow now).

  Mutation contract: every write path (`updateGameFavorite` /
  `updateGameStatus` / `updateGameRating` / `updateGameNotes` /
  `updateGameLaunchConfig` / `setGameTags`) is followed by `refreshGame()`
  (a thin `listGames().find(id)` + setState). The global library store
  is intentionally NOT refetched from this route — Library handles its
  own (search, sort, filter) refetch on remount.

**Commit:** `f447b7b`

**Verification:** `pnpm typecheck` green; `pnpm vite build` green
(2.90s, 728kB chunk-size warning is pre-existing). `grep` checks for
`Tabs` / `react-markdown` / `StarRating` / `TagPicker` /
`updateGameNotes|updateGameFavorite|updateGameStatus|updateGameRating` /
`保存中|已保存` all hit.

## Deviations from Plan

None — plan executed exactly as written. Two minor extensions documented
in `decisions` above (out of scope for "deviations"):

1. **Sessions auto-refetch on session-end:** Added `prevActiveRef` watcher
   (~10 LOC) so the 会话历史 tab updates without a manual reload. Plan
   said "preserve P3 sessions list" — preserving the list as-is would
   have left a UX dead-spot where the just-played session is invisible
   until the user navigates away and back. Falls under Rule 2 (auto-add
   missing critical UX).
2. **设置 tab '保存' button:** Plan said "preserve P3 启动配置" — but P3
   bundled save+launch into a single 启动 button. Now that the hero owns
   the daily-use launch flow, the 设置 tab needed a save-only path; the
   alternative (auto-save on blur) would surprise users and introduce
   another debounce. Falls under Rule 2.

## Threat Flags

None — Detail page only consumes existing Tauri commands; no new network
endpoints / file access patterns / auth surfaces introduced.

## Self-Check: PASSED

- Files: `src/components/library/StarRating.tsx` FOUND;
  `src/components/library/TagPicker.tsx` FOUND;
  `src/routes/Detail.tsx` modified (526 ins / 169 del verified by
  `git show --stat f447b7b`).
- Commits: `6332454` FOUND; `f447b7b` FOUND.
- Verification commands: `pnpm typecheck` (PASS); `pnpm vite build`
  (PASS, 2.90s).
- Locked Chinese copy assertions: 简介 / 标签 / 笔记 / 会话历史 / 设置 /
  暂无简介 / 总时长 / 收藏 / 启动 / 游戏中 / 已保存 / 保存中... /
  LE Profile / 启动参数 / 工作目录 (cwd) / 已识别可执行文件 /
  还没有游玩记录 — 启动游戏开始记录 / 创建新标签 — all present in
  Detail.tsx + TagPicker.tsx.
