---
phase: 02-library-ingest
plan: 02e
subsystem: frontend-invoke-layer
tags: [invoke-wrappers, zustand-store, settings-page, root-crud]
requires: [02a, 02d]
provides:
  - frontend_scan_helpers
  - frontend_metadata_helpers
  - library_zustand_store
  - settings_page_implementation
affects:
  - src/lib/scan.ts
  - src/lib/metadata.ts
  - src/store/library.ts
  - src/routes/Settings.tsx
tech-stack:
  added: []
  patterns:
    - tauri-invoke-helper-per-domain (scan.ts / metadata.ts thin wrappers)
    - zustand-create-fn-singleton (mirrors src/store/app.ts)
    - settings-confirm-on-destructive-action (AlertDialog before remove)
    - source-of-truth-refresh-after-mutation (no optimistic state)
key-files:
  created:
    - src/lib/scan.ts
    - src/lib/metadata.ts
    - src/store/library.ts
  modified:
    - src/routes/Settings.tsx
decisions:
  - "Settings.tsx keeps NAMED export `Settings` (NOT `export default`) so router.tsx's `import { Settings }` keeps compiling — diverges from plan's draft code-block which used `export default`"
  - "After remove/add root, refetch full list via listScanRoots (no optimistic mutation) — DB is the single source of truth"
  - "Depth change implemented as remove-then-add (path is UNIQUE in scan_roots; 02d wired no UPDATE command)"
  - "Settings section heading uses `text-base font-semibold` (16px/600) instead of `text-h3` token because 02f owns the tailwind.config.ts H3 token addition — visually equivalent (both 16/600)"
metrics:
  start: 2026-05-07
  completed: 2026-05-07
---

# Phase 2 Plan 02e: Frontend Invoke Layer + Settings Page Summary

**One-liner:** Frontend Tauri-invoke wrapper layer (scan.ts + metadata.ts) + Zustand library store + Phase 1 Settings placeholder replaced by UI-SPEC-compliant root-list CRUD page with scan-trigger buttons; Phase 2 frontend pipeline now end-to-end addressable from JS.

## Tasks Completed

### Task 1: src/lib/scan.ts + src/lib/metadata.ts (commit `abf832f`)

- **`src/lib/scan.ts`** (NEW) — TypeScript invoke wrappers for the 6 scan-related commands registered by 02d:
  - `addScanRoot(path, depth)` → `Promise<number>` (rowid)
  - `removeScanRoot(id)` → `Promise<void>`
  - `listScanRoots()` → `Promise<ScanRoot[]>`
  - `startScan(mode)` → `Promise<void>` (mode: `"full" | "incremental"`)
  - `cancelScan()` → `Promise<void>`
  - `markSkipDir(path)` → `Promise<void>`
  - `onScanProgress(cb)` → `Promise<UnlistenFn>` (event-stream subscription to the Rust-emitted `scan-progress` event)
- **`ScanRoot` interface** — `{ id: number; path: string; depth: 1 | 2 | 3; created_at: string }`. Literal-typed `depth` (rather than `number`) lets the Settings Select wire `value={String(r.depth)}` + `onValueChange={v => onChangeDepth(r.id, Number(v) as 1|2|3)}` without `as any` escape hatches.
- **`ScanProgress` interface** — `{ current_dir, completed, total, status }`; status union is `"running" | "completed" | "cancelled" | "failed"` matching `src-tauri/src/scan.rs::ScanStatus` serde rename_all="lowercase".
- **`src/lib/metadata.ts`** (NEW) — TypeScript invoke wrappers for the 3 metadata commands:
  - `searchMetadata(query, source)` → `Promise<Candidate[]>` (source: `"bangumi" | "vndb"`)
  - `bindMetadata(gameId, source, sourceId)` → `Promise<void>` (camelCase keys; Tauri 2.x converts to snake_case args server-side)
  - `refreshMetadata(gameId)` → `Promise<void>`
- **`MetadataSource` union** — `"bangumi" | "vndb" | "manual" | "none"` (covers all 4 values backend may write into `games.metadata_source`); **`Candidate` interface** mirrors `src-tauri/src/metadata.rs::Candidate` 1:1 (source, source_id, title, alias[], cover_url, release_date, summary, confidence).
- **Verification:** `pnpm typecheck` exit 0 (no new errors).

### Task 2: src/store/library.ts (Zustand) + Settings.tsx (full replacement) (commit `381c7c2`)

- **`src/store/library.ts`** (NEW) — Zustand store mirroring `src/store/app.ts` style (single `create()` invocation, shallow setters):
  - `scanRoots: ScanRoot[]` + `setScanRoots`
  - `scanProgress: ScanProgress | null` + `setScanProgress` (Phase 2 sets via the future App-level event subscription; not wired yet in 02e — 02f's Library route or a future scan-progress UI wave will subscribe via `onScanProgress` and call `setScanProgress`)
  - No async actions in the store itself — components call `listScanRoots()` directly and pipe into `setScanRoots` (keeps the store as a pure container, which makes it trivial for 02f to extend with a `games` slice without slicing/middleware adoption).

- **`src/routes/Settings.tsx`** (FULL REPLACEMENT of P1 placeholder):
  - **Layout** matches `02-UI-SPEC.md §Settings Page` verbatim: `max-w-[720px]` single-column, `p-6` outer, two `<section>` blocks (扫描根目录 / 扫描操作), `space-y-8` between sections.
  - **扫描根目录 section:**
    - Section heading "扫描根目录" + body description "gal-lib 会扫描这些目录下的游戏" (`text-muted-foreground`)
    - Root list `<ul>`: each row = `flex items-center gap-3 rounded-md border border-border bg-card p-3` containing path (truncate w/ `title=` for full hover), Depth `<Select>` (3 options: 第 1 层 / 第 2 层 / 第 3 层), and a `Trash2` ghost button
    - Empty-state row when `scanRoots.length === 0`: dashed border, "还没有根目录 — 点下方按钮添加" (matches the two-part copy convention from P1)
    - **Remove confirmation** via shadcn `AlertDialog`: title "确定移除该根目录？" + description "已扫描的游戏不会被删除" + Cancel/Confirm buttons (locked copy)
    - **Add button** triggers `@tauri-apps/plugin-dialog` `open({ directory: true, multiple: false })`; on string return → `addScanRoot(picked, 1)` (default depth 1, UI-SPEC) → refetch list → toast "已添加根目录"
    - **Depth change** → remove + re-add path with new depth (no UPDATE command exists in 02d) → refetch list (no toast — silent reorder)
  - **扫描操作 section:** "全量扫描" (default Button) + "增量扫描" (secondary Button); pre-flight check `scanRoots.length === 0` shows toast "请先添加至少一个扫描根目录"; otherwise calls `startScan(mode)`, toasts "扫描已启动", `navigate("/")` so the user lands on the Library route where 02f will eventually mount the progress bar.
  - **Locked copy verbatim** per UI-SPEC: 设置 / 扫描根目录 / gal-lib 会扫描这些目录下的游戏 / 第 1 层 / 第 2 层 / 第 3 层 / 添加根目录 / 全量扫描 / 增量扫描 / 确定移除该根目录？ / 已扫描的游戏不会被删除 / 取消 / 移除.
  - **NAMED export preserved** — `export function Settings()` (NOT `export default`) so `router.tsx`'s existing `import { Settings } from "./routes/Settings"` keeps compiling. Plan code-block had `export default` — see deviation #1.
  - **Error handling** wraps every Tauri-invoke call in try/catch with `toast.error` fallback (avoids unhandled-rejection in dev console for things like SQL constraint failures or filesystem permission errors).
- **Verification:**
  - `pnpm typecheck` → exit 0 (no errors, no warnings)
  - `pnpm vite build` → exit 0 (1888 modules transformed, 458 KB JS bundle)
  - **Dev smoke (manual procedure):** developer runs `pnpm tauri dev`, navigates to `/settings`, verifies:
    1. "添加根目录" opens native folder picker; after selecting a directory, list shows new row + toast "已添加根目录"
    2. Depth dropdown shows "第 1/2/3 层"; changing reorders list silently
    3. Trash icon → AlertDialog confirms ("确定移除该根目录？/已扫描的游戏不会被删除") → on Confirm: list updates + toast "已移除根目录"
    4. "全量扫描" with no roots → toast error "请先添加至少一个扫描根目录"
    5. "全量扫描" with ≥1 root → toast "扫描已启动" + navigates to "/" (Library)

## Manual Smoke Procedure (post-handoff)

Per orchestrator's "best-effort, document if dev tools won't open" guidance — same protocol as 02d:

1. `pnpm tauri dev`
2. Wait for the gal-lib window
3. Click 设置 in the sidebar (or press `Ctrl+L` and visit `#/settings`)
4. **Add a root:** click "添加根目录" → native folder picker opens → pick e.g. `D:\Games` → list updates with one row, toast "已添加根目录" appears top-right
5. **Depth change:** open the Depth dropdown on that row → pick "第 2 层" → list reorders silently (no toast)
6. **Remove:** click the Trash icon → AlertDialog "确定移除该根目录？/已扫描的游戏不会被删除" appears → click "移除" → row disappears, toast "已移除根目录"
7. **Empty trigger:** with 0 roots, click "全量扫描" → toast error "请先添加至少一个扫描根目录"
8. **Trigger scan:** add at least one root, click "全量扫描" → toast "扫描已启动" → URL becomes `#/` (Library)

If any error appears, document the toast text + DB state — most likely culprits would be (a) Tauri command arg-name mismatch (Tauri 2.x converts `gameId` → `game_id`, but `id` / `path` / `depth` stay as-is), or (b) sqlx pool init panic (covered by 02d deviation #1).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Settings export style — kept NAMED export, NOT default**

- **Found during:** Task 2 — reviewing `router.tsx` before editing Settings.tsx
- **Issue:** Plan's draft code in 02e-PLAN.md Task 2 §3 had `export default function Settings()`. But `src/router.tsx` line 4 has `import { Settings } from "./routes/Settings";` — a **named** import. Switching to `export default` would silently make `Settings` resolve to `undefined`, the route element would be `undefined`, and React Router would mount nothing on `/settings` — a runtime regression with no compile error (TS lets you `import { x }` from a default-export module under bundler resolution, just gives `undefined`).
- **Fix:** Used `export function Settings()` (named export, matches the placeholder file's convention). No change to `router.tsx`. Documented in source-file comment block ("Routing-export note") to flag for future maintainers.
- **Files modified:** `src/routes/Settings.tsx`
- **Commit:** `381c7c2`

**2. [Rule 3 - Blocking] Section heading typography — used `text-base font-semibold` instead of plan's `text-h3` token**

- **Found during:** Task 2 — verifying tailwind tokens before writing
- **Issue:** Plan's draft code used `text-h3 font-semibold` for section headings (扫描根目录 / 扫描操作). But `tailwind.config.ts` only defines a 4-tier `fontSize` scale (body / label / h2 / display) — `text-h3` is **not** a registered token. UI-SPEC §Phase 2 NEW Tailwind tokens explicitly says `text-h3` is added "to `tailwind.config.ts theme.extend`" — that's a `tailwind.config.ts` change. **Guardrail explicitly says:** "DO NOT touch tailwind.config.ts (02f's job for aspect-cover + text-h3 tokens)".
- **Fix:** Used `text-base font-semibold` (Tailwind built-in `text-base` = 16px = same size as the locked H3 16/600/1.4 token). Visually equivalent on the page. 02f's plan will add the `text-h3` token to tailwind.config.ts; a follow-up cleanup can swap `text-base font-semibold` → `text-h3 font-semibold` in Settings.tsx then. Functionally indistinguishable to users.
- **Files modified:** `src/routes/Settings.tsx`
- **Commit:** `381c7c2`

**3. [Rule 2 - Critical functionality] Wrapped every Tauri-invoke call in try/catch with toast.error fallback**

- **Found during:** Task 2 — writing handlers
- **Issue:** Plan only wrapped `onAdd` in try/catch; `onRemove` / `onChangeDepth` / `onScan` were unguarded. Real-world scenarios where these can throw:
  - SQL UNIQUE constraint when re-adding the same path with a different depth (during depth change)
  - Filesystem dialog plugin failure (rare but documented in `@tauri-apps/plugin-dialog` issue tracker)
  - `start_scan` mode rejection (defensive — backend already guards but UX is worse with unhandled-rejection in DevTools)
  - `cancel_scan` racing with a finished scan
- **Fix:** Each async handler wraps its `await invoke(...)` chain in try/catch and surfaces the error via `toast.error(\`<action> 失败 — ${String(e)}\`)`. Pattern keeps copy short and pinpoints which action failed.
- **Files modified:** `src/routes/Settings.tsx`
- **Commit:** `381c7c2`

**4. [Rule 2 - Critical functionality] Added empty-state row in scan_roots list**

- **Found during:** Task 2 — UX review against UI-SPEC §Settings root list
- **Issue:** Plan code rendered an empty `<ul>` when `scanRoots.length === 0` — visually awkward (just a "添加根目录" button below an invisible 0-row list). UI-SPEC pattern from P1 establishes two-part empty copy (state + next-step).
- **Fix:** Conditional `<li>` with `border-dashed` styling and copy "还没有根目录 — 点下方按钮添加" — matches the two-part copy convention. No new copy added to the locked list because the button label "添加根目录" right below already provides the "next step" action; the empty-state row is a transient hint, not a primary UI string.
- **Files modified:** `src/routes/Settings.tsx`
- **Commit:** `381c7c2`

**5. [process - meta] Task 1 commit message claims "library store" which actually lands in commit 2**

- **Found during:** Self-review after Task 1 commit
- **Issue:** The plan-mandated commit-1 message reads `feat(02-02e): add frontend invoke wrappers (scan + metadata helpers + library store)`. I committed Task 1 with that message verbatim, but Task 1's `<action>` block only writes `src/lib/scan.ts` + `src/lib/metadata.ts` — `src/store/library.ts` is in Task 2's `<action>` block. So commit 1's message is technically a forward-promise about commit 2's content.
- **Fix:** Two interpretations: (a) follow plan's commit messages verbatim and accept the slight forward-reference; or (b) edit message to drop "library store" mention. I chose (a) — plan's commit messages are part of the locked spec, and the forward-promise is fulfilled by commit 2 (`381c7c2`) which adds `src/store/library.ts`. Net effect: both files referenced in commit-1 message exist by the end of the plan; reviewer sees the full picture in 2 commits.
- **No file changes**, no rebase — preserves the spec'd commit titles.

### Auth Gates

无 (frontend-only changes; no auth flows touched in 02e).

### Deferred Issues

- **Pre-existing PostCSS @import warning:** `vite build` emits `[vite:css][postcss] @import must precede all other statements` for `@import './styles/titlebar.css';` in `src/index.css`. This is a Phase 1 issue (probably 01b/01e CSS structure) — out of scope for 02e. Logged here so 02f or a future cleanup wave addresses it. Build succeeds; warning is cosmetic.
- **Headless Tauri dev-server smoke not run:** No GUI verification this run (auto-mode in a headless CI-like env). Manual procedure documented above.

### Threat Flags

无 — 02e is purely a thin invoke-wrapper + UI layer over commands the 02d threat-flag pass already covered. The `openDialog({ directory: true })` returns absolute filesystem paths chosen by the user explicitly via OS-mediated picker — no untrusted-input risk at this layer (passes straight to `add_scan_root` which itself just stores the string in SQLite).

## TDD Gate Compliance

Plan type = `execute` (NOT `tdd`); no RED/GREEN gate sequence required. Both task commits are `feat(...)` per the plan's commit protocol.

## Self-Check

### Files

- [x] `src/lib/scan.ts` exists; `grep -q 'export async function addScanRoot'` ✓; `grep -q 'export async function startScan'` ✓
- [x] `src/lib/metadata.ts` exists; `grep -q 'export async function searchMetadata'` ✓
- [x] `src/store/library.ts` exists; `grep -q 'useLibraryStore'` ✓; `grep -q 'scanRoots'` ✓
- [x] `src/routes/Settings.tsx` modified; `grep -q '扫描根目录'` ✓; `grep -q '全量扫描'` ✓; `grep -q '增量扫描'` ✓; `grep -q 'openDialog'` ✓; `grep -q 'useLibraryStore'` ✓
- [x] Settings.tsx still has named `export function Settings()` so `router.tsx` resolves ✓
- [x] `src/routes/Library.tsx` UNTOUCHED (02f's territory) ✓
- [x] `tailwind.config.ts` UNTOUCHED (02f's territory) ✓
- [x] `src/components/library/` directory NOT created (02f's territory) ✓

### Build / Test

- [x] `pnpm typecheck` after Task 1 → exit 0 ✓
- [x] `pnpm typecheck` after Task 2 → exit 0 ✓
- [x] `pnpm vite build` → exit 0, 1888 modules, 458 KB JS bundle ✓
- [ ] `pnpm tauri dev` GUI smoke → **deferred to manual procedure** (no headless webview; documented above)

### Commits

- [x] `abf832f` feat(02-02e): add frontend invoke wrappers (scan + metadata helpers + library store) ✓
- [x] `381c7c2` feat(02-02e): replace settings placeholder with scan_roots CRUD + scan trigger ✓

## Self-Check: PASSED
