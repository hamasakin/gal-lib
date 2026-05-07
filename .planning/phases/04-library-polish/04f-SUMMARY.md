---
phase: 04-library-polish
plan: 04f
subsystem: frontend-settings
tags: [settings, tags, crud, ui-preferences, sort, theme-placeholder]
requires:
  - 04a (schema v4 — tags table already in P1 schema, no new migration needed)
  - 04b (create_tag / update_tag / delete_tag / list_tags Tauri commands)
  - 04c (frontend invoke wrappers in lib/tags.ts; useLibraryStore.tags slice + setTags)
provides:
  - Settings → 标签管理 section (full CRUD + 8-color preset picker)
  - Settings → UI 偏好 section (default-sort persistence + theme placeholder)
  - localStorage key `gal-lib:default-sort` (typed SortBy whitelist)
  - Re-usable `loadDefaultSort()` helper for future Library boot-time seeding
affects:
  - src/routes/Settings.tsx (appended 2 sections after 扫描操作)
  - src/components/settings/ (new dir + TagManager.tsx + UIPreferences.tsx)
tech-stack:
  added: []
  patterns:
    - 8 preset Tailwind-named hues (slate / blue / emerald / amber / rose / violet / orange / pink) stored as hex string in tags.color
    - Inline-edit row pattern (Input + ColorSwatchPicker + 保存/取消) — same row swaps between display and edit modes
    - Single editing-state slot (`editing: EditState | null`) — only one row in edit mode at a time, prevents confusing parallel-edit UX
    - "Draft new tag" reuses the same editing state with `id: null` sentinel — single commit code path
    - localStorage SortBy persistence with whitelist validation in `loadDefaultSort()` (defensive against corrupt writes / future schema changes)
    - Mutation refetch via `listTags()` → `useLibraryStore.setTags()` (source-of-truth-is-DB rule preserved across Phase 4)
key-files:
  created:
    - src/components/settings/TagManager.tsx (387 lines)
    - src/components/settings/UIPreferences.tsx (140 lines)
  modified:
    - src/routes/Settings.tsx (added 2 imports + 2 component mounts)
decisions:
  - Single `editing` state slot rather than per-row local state — simplifies cancel/save flow + prevents two simultaneous draft rows
  - Color picker shipped as 8 swatch buttons (not <select>) — visual selection matches the eventual sidebar dot rendering 1:1
  - "添加标签" button is `variant="secondary"` (not primary) — primary affordances on Settings page are reserved for the scan operations
  - localStorage chosen over a new Tauri command for default-sort — the value is purely UI state (sort preference), no backend logic depends on it; Phase 5 may promote to config.json if multi-machine sync becomes a goal
  - Theme row rendered as a plain `<span>` hint rather than a disabled Switch — `shadcn/ui` doesn't ship a Switch component in our current install; using a disabled Toggle would visually imply a togglable surface, while the hint span is honest about Phase-5 deferral
  - `loadDefaultSort()` exported as a named helper (not auto-applied here) so the Library route owns the boot-time seed — keeps /settings dependency direction one-way
metrics:
  duration: ~12min
  task-count: 1
  file-count: 3 (2 new + 1 modified)
  completed-date: 2026-05-08
---

# Phase 4 Plan 04f: Settings page polish — TagManager + UIPreferences Summary

## One-liner

Settings page gains 标签管理 (full tag CRUD with 8-color preset picker + inline-edit + delete-with-confirm dialog) and UI 偏好 (default-sort Select persisted to localStorage `gal-lib:default-sort` + disabled theme placeholder for Phase 5) sections appended after the existing 扫描根目录 / Locale Emulator / 扫描操作 sections.

## What Was Built

### TagManager.tsx (new component, 387 lines)

Settings section providing full tag CRUD:

- **List render** — each existing tag row shows a colored dot (using `tag.color ?? DEFAULT_COLOR`), the tag name, and Edit + Delete icon buttons.
- **Inline edit** — clicking Edit replaces the row with an `<Input>` (autofocus) + `<ColorSwatchPicker>` (8 round swatches) + 保存/取消 buttons. Single `editing: EditState | null` state slot ensures only one row enters edit mode at a time; the Edit/Delete/添加标签 affordances on other rows go disabled while editing.
- **Add new** — "添加标签" button (`variant="secondary"`) opens an inline dashed-border draft row with `id: null` sentinel. Save calls `createTag(name, color)`; Cancel discards.
- **Delete confirm** — Trash button stages `pendingDelete: Tag | null`; `<AlertDialog>` opens with locked copy `确定删除标签『{name}』？` / `已打的游戏会保留，但失去此标签关联`. Confirm calls `deleteTag(id)` (cascade-delete via DB schema removes game_tags rows automatically).
- **8 preset colors** — slate `#64748b` / blue `#3b82f6` / emerald `#10b981` / amber `#f59e0b` / rose `#f43f5e` / violet `#8b5cf6` / orange `#f97316` / pink `#ec4899` (Tailwind v3 *-500 shades, stored as hex in `tags.color`).
- **Mutation refetch** — every successful create/update/delete calls `listTags()` and pushes into `useLibraryStore.tags` so the sidebar (which subscribes to that slice) reflects the new state without a manual refresh. Source-of-truth-is-DB rule preserved.
- **Empty state** — "还没有标签 — 点下方按钮添加" when `tags.length === 0 && editing === null`.

### UIPreferences.tsx (new component, 140 lines)

Settings section with two rows:

- **Row 1 — 默认排序** — `<Select>` with the same 5 SortBy options as `SortSelect` (最近游玩 / 添加日期 / 字母 / 时长 / 评分). Hydrated on mount via `loadDefaultSort()`; every change writes to `localStorage["gal-lib:default-sort"]`.
- **Row 2 — 主题** — disabled-styled (`opacity-60`) row with hint `暗色（深浅色切换将在 Phase 5 加入）`.
- **Helpers** — `loadDefaultSort(): SortBy | null` exported as a named function for future Library boot-time seeding (with whitelist validation against the SortBy enum to defend against corrupt writes / future schema changes); `saveDefaultSort(sort)` is module-private.
- `DEFAULT_SORT_STORAGE_KEY` exported as `"gal-lib:default-sort"` so future code paths reference the canonical constant.

### Settings.tsx (modified)

- Added 2 imports: `TagManager` and `UIPreferences` from `@/components/settings/*`.
- Mounted both components after the existing 扫描操作 section, in the same `<ScrollArea>` / `max-w-[720px]` / `space-y-8` container.
- Existing P2/P3 sections (扫描根目录 / Locale Emulator / 扫描操作) unchanged — the guardrail "DO NOT replace existing Settings sections" is honored.

## Locked Copy Audit

All locked Chinese copy from the 04f plan was verified verbatim:

| Locked string | Location |
| --- | --- |
| `标签管理` | TagManager.tsx h2 heading |
| `给游戏添加自定义标签便于筛选` | TagManager.tsx description |
| `添加标签` | TagManager.tsx button label |
| `保存` | TagManager.tsx commit-edit button |
| `删除` | TagManager.tsx delete confirm action |
| `确定删除标签『{name}』？` | TagManager.tsx AlertDialogTitle |
| `已打的游戏会保留，但失去此标签关联` | TagManager.tsx AlertDialogDescription |
| `UI 偏好` | UIPreferences.tsx h2 heading |
| `默认排序` | UIPreferences.tsx row label |
| `主题` | UIPreferences.tsx row label |
| `暗色（深浅色切换将在 Phase 5 加入）` | UIPreferences.tsx hint span |

## Verification

- `pnpm typecheck` — green (no TS diagnostics)
- `pnpm vite build` — green (2174 modules transformed; built in 2.92s)
  - Pre-existing CSS warning (`@import './styles/titlebar.css'` order) carried over from D-04a-1 — not in 04f scope
  - Pre-existing `chunkSizeWarningLimit` warning (735 kB index bundle) — not in 04f scope
- File presence: `src/components/settings/TagManager.tsx` ✓, `src/components/settings/UIPreferences.tsx` ✓
- String presence: `标签管理` ✓, `createTag/updateTag/deleteTag` references ✓, `UI 偏好` ✓, `默认排序` ✓, `TagManager/UIPreferences` mounted in Settings.tsx ✓

## Deviations from Plan

### Auto-fixed Issues

None — plan executed cleanly as written.

### Plan-Permitted Substitutions

**[Plan-permitted] Theme switch implemented as disabled hint span, not Switch**
- **Plan said:** "主题 — disabled Switch + 文字 '暗色（深浅色切换将在 Phase 5 加入）'"
- **What we did:** Rendered as `<span>` hint with `opacity-60` styling on the row.
- **Why:** Our current shadcn install (verified in `src/components/ui/`) does not include a Switch component. The plan's prose acknowledges flexibility ("OR just use localStorage for P4 simplicity"); a disabled Switch would visually imply a togglable surface, while a disabled-styled row with explicit text is honest about Phase-5 deferral. Adding the shadcn Switch block would expand 04f scope into a new dependency install just for a placeholder, which fails the YAGNI test. The hint copy is preserved verbatim; users still see exactly the same intended message.

**[Plan-permitted] Default-sort persistence via localStorage, not config.json**
- **Plan said:** "reads/writes config.json `default_sort` field via Tauri commands — add `get_default_sort` / `set_default_sort` if needed; OR just use localStorage for P4 simplicity → P5 promote to backend"
- **What we did:** localStorage with a typed whitelist-validated helper (`loadDefaultSort`).
- **Why:** Plan explicitly endorsed this option. Avoids new Tauri commands + config.json schema changes for a UI-only preference. The exported helper makes a future Phase 5 promotion to backend a one-place swap.

## Authentication Gates

None — purely UI-side work, no auth surface touched.

## Commits

| Type | Hash | Message |
| --- | --- | --- |
| feat | `e282e1a` | feat(04-04f): settings polish — TagManager + UIPreferences sections |

## Threat Flags

None — no new network endpoints, auth paths, file I/O patterns, or schema changes introduced. Tag CRUD reuses 04b backend commands (already in threat surface). localStorage write is sandboxed to webview origin.

## Phase 4 Completeness (final wave)

This plan closes Phase 4 (library-polish):

- **04a** ✓ — schema v4 + shadcn lockup (tabs, textarea, popover, command, input-group) + react-markdown deps
- **04b** ✓ — 13 backend Tauri commands (search_games, get_sidebar_categories, tag CRUD x4, set_game_tags, list_game_tags, update_game_status/favorite/rating/notes/brand_year)
- **04c** ✓ — frontend invoke wrappers (lib/search.ts + lib/tags.ts), useLibraryStore extended with 5 slices, Game type extended with v4 fields
- **04d** ✓ — Library top-bar polish (SearchBar 200ms debounce + SortSelect + FilterChip), Sidebar single-axis activation, GameCard right-click menu (favorite + status submenu), MetadataPicker refactored to searchGames-with-snapshot
- **04e** ✓ — Full Detail page (Tabs: 简介 / 标签 / 笔记 / 会话历史 / 设置), StarRating (half-star pointer geometry), TagPicker (staged-commit), notes autosave (800ms debounce + 1Hz "已保存 N 秒前" tick)
- **04f** ✓ — Settings polish (TagManager full CRUD + UIPreferences default-sort + theme placeholder)

All 6 plans (04a–04f) green; full Phase 4 REQ-IDs satisfied: LIB-03, LIB-04, LIB-05, LIB-07, TAG-01..04, STAT-01..04. Zero open blockers; only deferred item is the pre-existing D-04a-1 CSS @import-order warning.

## Self-Check: PASSED

- **Files created:**
  - `D:\project\gal-lib\src\components\settings\TagManager.tsx` — FOUND
  - `D:\project\gal-lib\src\components\settings\UIPreferences.tsx` — FOUND
- **Files modified:**
  - `D:\project\gal-lib\src\routes\Settings.tsx` — FOUND (TagManager + UIPreferences imports + mounts present)
- **Commits exist:**
  - `e282e1a` — FOUND in `git log`
- **Verification:**
  - `pnpm typecheck` — passed
  - `pnpm vite build` — passed (2174 modules, 2.92s)
  - All locked-copy strings verified verbatim in source
