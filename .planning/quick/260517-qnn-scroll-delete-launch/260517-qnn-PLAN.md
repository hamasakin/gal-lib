---
phase: quick-260517-qnn
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/hooks/useSmoothWheel.ts
  - src-tauri/src/commands.rs
  - src-tauri/src/lib.rs
  - src/lib/games.ts
  - src/components/library/GameCard.tsx
  - src/routes/Library.tsx
  - src/routes/Detail.tsx
  - src/components/library/LaunchButton.tsx
autonomous: true
requirements: [QNN-01, QNN-02, QNN-03]

must_haves:
  truths:
    - "On a fresh app launch, dragging the library grid scrollbar leaves the view at the dragged position (no snap-back)"
    - "Right-clicking a game card shows a『删除条目』menu item that opens a confirmation dialog"
    - "Confirming the delete dialog removes the games row, refreshes the grid + sidebar, and leaves the on-disk folder untouched"
    - "The Detail page launch method offers exactly two choices: 日区 LE 启动 and 直接启动"
    - "A game previously saved with a removed LE profile (简中/繁中/Custom) loads into the 日区 LE 启动 choice without error"
  artifacts:
    - path: "src/hooks/useSmoothWheel.ts"
      provides: "Smooth-wheel hook that re-syncs its lerp target on external scroll"
    - path: "src-tauri/src/commands.rs"
      provides: "delete_game Tauri command (DELETE FROM games WHERE id = ?)"
    - path: "src/lib/games.ts"
      provides: "deleteGame invoke wrapper"
  key_links:
    - from: "src/hooks/useSmoothWheel.ts"
      to: "el scroll event"
      via: "scroll listener comparing scrollTop against last hook-written value"
      pattern: "addEventListener\\(\"scroll\""
    - from: "src/components/library/GameCard.tsx"
      to: "delete_game"
      via: "deleteGame() wrapper after AlertDialog confirm"
      pattern: "deleteGame\\("
    - from: "src/lib/games.ts"
      to: "delete_game"
      via: "invoke"
      pattern: "invoke\\(\"delete_game\""
---

<objective>
Three independent improvements to gal-lib, one atomic commit each:

1. Fix the library grid scrollbar "snap-back" regression — dragging the
   scrollbar thumb on a fresh launch jumps the view back to the pre-drag
   position. Root cause is `useSmoothWheel`'s stale lerp `target`.
2. Add a "删除条目" feature — remove a game's library record (DB row only;
   disk files untouched), gated behind a confirmation dialog.
3. Simplify the Detail page launch method to exactly two choices —
   「日区 LE 启动」and「直接启动」— removing the 简中 / 繁中 / Custom
   LE profiles.

Purpose: Fix a visible scroll bug, give users a way to prune their library,
and cut launch-config clutter down to the only two methods that matter.
Output: Patched smooth-wheel hook, a new `delete_game` Rust command + TS
wrapper + UI entry points, and a two-choice launch selector.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@./CLAUDE.md

<interfaces>
<!-- Key contracts the executor needs — extracted from the codebase. Use directly. -->

src/lib/games.ts — existing invoke wrappers (the new deleteGame goes here):
```typescript
export async function listGames(): Promise<Game[]>
export async function updateGameStatus(gameId: number, status: ...): Promise<void>
export async function openGameDir(path: string): Promise<void>
// invoke arg convention: Rust snake_case params; pass camelCase JS keys,
// Tauri auto-converts (e.g. delete_game(game_id) ← invoke("delete_game", { gameId }))
```

src-tauri/src/commands.rs — existing delete patterns to mirror:
```rust
// ~line 305 — single-table delete with explicit error path
async fn delete_from_review_queue(pool: &SqlitePool, game_id: i64) -> Result<(), String> {
    sqlx::query("DELETE FROM scan_review_queue WHERE game_id = ?")
        .bind(game_id).execute(pool).await.map_err(err_str)?;
    Ok(())
}
// ~line 1050 — split_game_into_subdirs deletes the parent games row.
// Comment there confirms: scan_review_queue rows cascade via the v9
// FK ON DELETE CASCADE. clear_all_data (~line 1079) lists the child
// tables: screenshots, save_backups, sessions, game_tags, scan_review_queue.
// A #[tauri::command] takes `state: State<'_, AppPaths>`; get the pool via
// `state.pool().await.map_err(err_str)?`.
```

src/lib/launch.ts — launch wrappers (unchanged, used by Task 3):
```typescript
// useLe: true → launch via Locale Emulator; false → direct launch (no LE)
export async function launchGame(gameId: number, useLe?: boolean): Promise<ActiveSession>
export interface LaunchConfigPatch { le_profile?: string; launch_args?: string; cwd?: string; executable_path?: string }
export async function updateGameLaunchConfig(gameId: number, patch: LaunchConfigPatch): Promise<void>
```

Backend launch fact (verified in src-tauri/src/launch/process_track.rs):
LEProc is always spawned with its DEFAULT (ja-JP) profile — `spawn_le`'s
`profile` param is explicitly unused (`let _ = profile`). So `le_profile`
is purely a frontend display/persistence string; it has no CHECK constraint
(0003 migration: `le_profile TEXT NOT NULL DEFAULT 'Japanese'`). Removing
profile values needs NO backend / DB migration — only frontend hydration
must map any stored non-"Japanese" value back to the Japanese-LE choice.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Fix grid scrollbar snap-back in useSmoothWheel</name>
  <files>src/hooks/useSmoothWheel.ts</files>
  <action>
Fix the lerp-target desync that makes the library grid scrollbar snap back
to the pre-drag position (QNN-01).

Root cause (already diagnosed — verify by reading the hook, then fix):
`useSmoothWheel` keeps a closure-scoped `target` (the lerp destination). It
only re-syncs `target` to the live `el.scrollTop` inside `onWheel` and only
when `raf == null`. When the user scrolls by any NON-wheel means (dragging
the scrollbar thumb, keyboard PageDown, programmatic writes) while the rAF
lerp loop is still running, the stale `target` makes `tick` compute a large
`diff` and pull `scrollTop` back toward the old position.

Fix — make the hook detect externally-driven scroll changes and stop
fighting them:
- Track the last `scrollTop` value the hook's own `tick` wrote (e.g. a
  `lastWritten` variable; update it every time `tick` assigns `el.scrollTop`,
  including the snap-to-target branch).
- Add a `scroll` event listener on `el`. In the handler, if the current
  `el.scrollTop` differs from `lastWritten` by more than a small epsilon
  (e.g. 1px) — meaning the change came from outside the hook (scrollbar
  drag / keyboard / programmatic write) — re-sync `target = el.scrollTop`
  and stop the running lerp loop (`if (raf != null) { cancelAnimationFrame(raf); raf = null; }`).
- Keep `lastWritten` in sync inside `onWheel` too is not required, but make
  sure the `scroll` event the hook's own `tick` triggers does NOT get
  misclassified as external — that is exactly what the `lastWritten`
  comparison prevents (tick writes scrollTop, then updates lastWritten;
  when the scroll event fires, scrollTop === lastWritten → ignored).
- Add the `scroll` listener removal to the existing `useEffect` cleanup.
- Do NOT remove or weaken wheel smoothing — wheel-driven scrolling must
  still lerp exactly as before. Update the hook's header comment to note
  the external-scroll re-sync behavior.
  </action>
  <verify>
    <automated>cd D:/project/gal-lib && npx tsc --noEmit -p tsconfig.json 2>&1 | Select-String -Pattern "useSmoothWheel" -SimpleMatch -Quiet; if ($LASTEXITCODE) { echo "no tsc errors in useSmoothWheel" }</automated>
  </verify>
  <done>
useSmoothWheel.ts adds a `scroll` listener that re-syncs `target` and
cancels the rAF loop on external scroll; `npx tsc --noEmit` reports no new
errors. Manual: on a fresh launch, dragging the grid scrollbar thumb keeps
the view at the dragged position (no snap-back); wheel scrolling is still
smooth.
  </done>
</task>

<task type="auto">
  <name>Task 2: Add delete_game command + 删除条目 UI with confirm dialog</name>
  <files>src-tauri/src/commands.rs, src-tauri/src/lib.rs, src/lib/games.ts, src/components/library/GameCard.tsx, src/routes/Library.tsx</files>
  <action>
Add a "删除条目" feature that removes ONLY the library record (QNN-02).
The on-disk game folder/files MUST NOT be touched — a later re-scan
legitimately re-adds the game, which is expected.

Backend (src-tauri/src/commands.rs):
- Add `#[tauri::command] pub async fn delete_game(game_id: i64, state: State<'_, AppPaths>) -> Result<(), String>`.
- Get the pool via `state.pool().await.map_err(err_str)?`.
- Mirror the cleanup done by `clear_all_data` (~line 1079) but scoped to one
  game id. Delete child rows first so it works regardless of the
  connection's `PRAGMA foreign_keys` state: `screenshots`, `save_backups`,
  `sessions`, `game_tags`, `scan_review_queue` — each
  `DELETE FROM <table> WHERE game_id = ?` — then `DELETE FROM games WHERE id = ?`.
  Also delete from any other table that has a `game_id` FK to `games` if grep
  reveals more (check `game_staff`, `game_official_tags`, custom-view link
  table — grep `game_id` in commands.rs / migrations; include each that
  exists so no orphan rows remain).
- Return `Err("游戏不存在".to_string())` if the games DELETE affected 0 rows
  (check `result.rows_affected()`), consistent with split's "游戏不存在" copy.
- Do NOT touch the filesystem — no cover/screenshot/save directory removal
  (that is what `clear_all_data` does and what we explicitly avoid here).

Register (src-tauri/src/lib.rs): add `commands::delete_game,` to the
`invoke_handler!` list — put it near the Quick 260516-q3y subdir-split
entries (~line 280) with a `// Quick 260517-qnn — delete game entry` comment.

Frontend wrapper (src/lib/games.ts): add
`export async function deleteGame(gameId: number): Promise<void>` that does
`await invoke("delete_game", { gameId })`, with a doc comment stating it
removes only the DB record and leaves disk files intact.

UI entry — GameCard context menu (src/components/library/GameCard.tsx):
- Add a new `ContextMenuItem` "删除条目" at the bottom of the context menu
  (after the "整理子目录" item), styled destructive
  (`className="text-destructive focus:text-destructive"` — same as the
  existing 强制结束 item).
- Add a new prop `onRequestDelete: (game: Game) => void` to `GameCardProps`
  and call `onRequestDelete(game)` from the menu item's onClick. The card
  itself does NOT own the dialog — Library owns it (the card unmounts when
  its row is deleted, which would unmount an in-card dialog).
- Thread the prop through GameGrid.tsx (`GameGridProps` + the `<GameCard>`
  render call) — note this adds src/components/library/GameGrid.tsx to the
  touched files; include it.

Confirm dialog — Library.tsx (src/routes/Library.tsx):
- Add a `deleteCandidate` state (`useState<Game | null>(null)`); GameGrid's
  `onRequestDelete` sets it.
- Render an `AlertDialog` (same import + structure as the existing
  `splitCandidate` AlertDialog already in this file). Title e.g.
  「删除该条目？」; description must make clear ONLY the library record is
  removed and the game's local files are NOT deleted, and that a re-scan
  will bring it back — e.g. "仅从图书馆移除这条记录（游玩时长 / 笔记 / 评分
  等数据会一并丢失）。磁盘上的游戏文件不会被删除，重新扫描会再次找到它。"
- The AlertDialogAction confirm handler: call `deleteGame(candidate.id)`,
  then `void refetchGrid(); void refreshSidebar();` (existing callbacks in
  this file — the `onChildMutation` pattern), `toast.success("已删除条目")`,
  clear `deleteCandidate`. On error `toast.error`.

Verification accounts for the Rust change: a `cargo check` must pass.
  </action>
  <verify>
    <automated>cd D:/project/gal-lib/src-tauri && cargo check 2>&1 | Select-String -Pattern "^error" -Quiet; if (-not $?) { echo "cargo check clean" }</automated>
  </verify>
  <done>
`cargo check` passes with `delete_game` registered in `invoke_handler!`.
`delete_game` deletes all `game_id`-referencing child rows then the games
row, touches no filesystem path, and errors "游戏不存在" on a missing id.
`deleteGame` wrapper exists in games.ts. Right-clicking a card shows a
destructive "删除条目" item; confirming the AlertDialog removes the row and
refreshes grid + sidebar; the on-disk folder is untouched. `npx tsc --noEmit`
reports no new errors.
  </done>
</task>

<task type="auto">
  <name>Task 3: Collapse Detail launch method to 日区 LE 启动 / 直接启动</name>
  <files>src/routes/Detail.tsx, src/components/library/LaunchButton.tsx</files>
  <action>
Simplify the launch METHOD selector on the Detail page to exactly two
choices (QNN-03). KEEP all other launch-config fields untouched — 启动参数
(launch_args), 工作目录 (cwd), 已识别可执行文件 (executable_path).

Two choices ONLY:
- 「日区 LE 启动」— launch via Locale Emulator (`launchGame(gameId, true)`).
  The persisted `le_profile` value for this choice is `"Japanese"`.
- 「直接启动」— direct launch, no LE (`launchGame(gameId, false)`).

Remove the 简体中文 / 繁体中文 / Custom profiles entirely. No Chinese LE.

Detail.tsx changes:
- Replace the `LE_PROFILES` const + `LeProfile` type. Model the launch
  method as a two-value union, e.g.
  `type LaunchMethod = "le-jp" | "direct"` with a small label map
  (`日区 LE 启动` / `直接启动`). Replace the `profile` state with a
  `launchMethod` state of this type.
- Hydration (`refreshGame`, ~line 489): the saved value comes from
  `le_profile`. Map it to a `LaunchMethod` — decide the cleanest rule and
  document it. Recommended: treat the persisted string as a method hint —
  only an explicit "direct"/"Direct" sentinel maps to `"direct"`; EVERY
  other stored value (`"Japanese"`, the now-removed `"Simplified Chinese"`,
  `"Traditional Chinese"`, `"Custom"`, empty) falls back to `"le-jp"`.
  This means games previously saved with a removed Chinese/Custom profile
  load gracefully as 日区 LE 启动 and break nothing.
- Remove the `isCnVersionExe` auto-pick of a Chinese profile. The function
  `isCnVersionExe` becomes unused — delete it (and its header comment) so
  there is no dead code / no lint warning.
- Persistence: when saving (`onLaunchClick` ~line 716 and `onSaveLaunchConfig`
  ~line 759), set `le_profile` to a stable sentinel for the chosen method —
  `"Japanese"` for `le-jp`, `"direct"` for `direct` — via the existing
  `updateGameLaunchConfig` patch. Keep `launch_args` / `cwd` /
  `executable_path` in the patch exactly as they are now.
- Launch dispatch: `onLaunchClick` currently always does
  `launchGame(gameId, true)`. Change it to
  `launchGame(gameId, launchMethod === "le-jp")` so 直接启动 launches
  without LE. Update the `toastLaunchSuccess(...)` call's second arg
  accordingly (pass a human label like "日区 LE" / "直接" instead of the
  old profile string).
- 启动配置 tab (~line 1333): replace the "LE Profile" `ConfigField` +
  `Select` (which maps over `LE_PROFILES`) with a "启动方式" `ConfigField`
  whose Select has exactly two `SelectItem`s — value `le-jp` label
  「日区 LE 启动」and value `direct` label「直接启动」, bound to
  `launchMethod`. Leave the 启动参数 / 工作目录 / 已识别可执行文件 /
  截图间隔 fields exactly as-is.
- The hero `<LaunchButton>` (~line 1163) currently takes
  `profile` / `onProfileChange`. Update the props passed to it to the new
  two-value model (see LaunchButton change below).

LaunchButton.tsx changes:
- Replace the internal `LE_PROFILES` array (4 entries) with the two
  launch methods: `le-jp` → label「日区 LE 启动」, `direct` → label
  「直接启动」. Update the `LaunchProfile` type (rename to `LaunchMethod`
  or keep the prop name — keep the public prop shape minimal but consistent
  with Detail.tsx).
- The popover still works the same way (hover-expand list of choices), it
  just lists two items instead of four. Keep the active-state stop button
  and all styling/animation unchanged.
- Update the `profile`/`onProfileChange` prop names if you rename the type;
  ensure Detail.tsx's `<LaunchButton>` call site matches. Keep the change
  surface limited to these two files.

No backend or DB migration — `le_profile` is a free TEXT column the LE
launch path ignores (it always uses the default ja-JP profile); storing
"Japanese" or "direct" is safe.
  </action>
  <verify>
    <automated>cd D:/project/gal-lib && npx tsc --noEmit -p tsconfig.json 2>&1 | Select-String -Pattern "Detail.tsx|LaunchButton.tsx" -SimpleMatch -Quiet; if (-not $?) { echo "no tsc errors in Detail/LaunchButton" }</automated>
  </verify>
  <done>
The Detail 启动配置 tab and the hero LaunchButton each expose exactly two
launch methods: 日区 LE 启动 and 直接启动. 直接启动 calls
`launchGame(gameId, false)`; 日区 LE 启动 calls `launchGame(gameId, true)`.
启动参数 / 工作目录 / 已识别可执行文件 fields are unchanged. A game with a
stored removed-profile `le_profile` (简中/繁中/Custom) hydrates into
日区 LE 启动 without error. `isCnVersionExe` is deleted (no dead code).
`npx tsc --noEmit` reports no new errors.
  </done>
</task>

</tasks>

<verification>
- `npx tsc --noEmit` (frontend) reports no new type errors.
- `cargo check` in src-tauri passes with `delete_game` registered.
- Manual smoke (deferred to milestone audit per autonomous-run policy):
  fresh-launch scrollbar drag has no snap-back; right-click → 删除条目 →
  confirm removes the card and disk folder still exists; Detail launch
  selector shows only two methods and 直接启动 launches without LE.
</verification>

<success_criteria>
- Three atomic commits, one per task (scroll fix / delete feature / launch
  simplification).
- `useSmoothWheel` no longer fights externally-driven scroll.
- `delete_game` removes only the DB record (all child rows + games row),
  never the filesystem.
- Detail launch method is exactly 日区 LE 启动 / 直接启动; old saved
  profiles degrade gracefully to 日区 LE 启动.
</success_criteria>

<output>
After completion, create `.planning/quick/260517-qnn-scroll-delete-launch/260517-qnn-SUMMARY.md`
</output>
