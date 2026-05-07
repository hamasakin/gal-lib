---
phase: 03-launch-playtime
plan: 03f
subsystem: frontend
tags: [tauri, react, zustand, sonner, react-router, locale-emulator]
requires:
  - 03d (7 launch/session Tauri commands wired)
  - 03e (active-session-changed + close-to-tray events emitted by backend)
  - 02f (GameGrid + Library + Settings frontend baseline)
provides:
  - "src/lib/launch.ts (7 invoke helpers + 2 event subs)"
  - "src/store/library.ts: activeSession + sessionsByGame slices"
  - "src/components/library/ActiveSessionBar.tsx (sticky-top playing indicator)"
  - "src/routes/Detail.tsx (minimal /games/:id detail page)"
  - "GameCard launch / 强制结束 affordances + click → /games/:id navigation"
  - "Settings Locale Emulator section (path display + manual override)"
  - "main.tsx active-session boot hydration + close-to-tray toast"
affects:
  - "Library.tsx (mounts ActiveSessionBar)"
  - "router.tsx (/games/:id route added)"
  - "Settings.tsx (LE section prepended above 扫描操作)"
  - "GameCard.tsx (launch / 强制结束 button overlay; navigate replaces toast)"
tech-stack:
  added:
    - "@tauri-apps/api/event listen<T> for active-session-changed + close-to-tray"
  patterns:
    - "Module-scope event subscription in main.tsx (idempotency-guarded; outlives all routes)"
    - "Boot-time hydration via getActiveSession() before subscribing to lifecycle events"
    - "Aliased import (setLePath as applyLePath) to avoid clash with React state setter of same name"
    - "useLibraryStore.activeSession is the single source of truth — both ActiveSessionBar (visibility) and GameCard (button state) read from it"
    - "1Hz setInterval driving elapsed re-render; cleanup on activeSession=null via useEffect dep"
key-files:
  created:
    - src/lib/launch.ts
    - src/components/library/ActiveSessionBar.tsx
    - src/routes/Detail.tsx
  modified:
    - src/store/library.ts
    - src/main.tsx
    - src/components/library/GameCard.tsx
    - src/routes/Library.tsx
    - src/routes/Settings.tsx
    - src/router.tsx
decisions:
  - "Launch button hidden (not just disabled) when another game is active — avoids enabled button that would emit a backend rejection toast"
  - "Detail page bundles 'save config + launch' into the single 启动 button (single round-trip pair) — Phase 4 will add a 保存配置 button when more fields land"
  - "Empty-string cwd in form → undefined in updateGameLaunchConfig (preserves NULL semantics: 'use default'); empty-string launch_args is sent verbatim ('') so user can clear"
  - "Tray-toast first-time gate uses localStorage flag gal-lib:tray-toast-dismissed (purely UI affordance, no backend persistence needed)"
  - "Active-session boot hydration calls getActiveSession() before subscribing — survives webview reloads mid-session without waiting for next lifecycle event"
  - "ActiveSessionBar self-hides when activeSession is null (no auto-hide timer like ScanProgressBar — session lifecycle is binary in store)"
  - "GameCard active-game indicator uses destructive Square icon button (always visible at opacity-100); inactive-game launch button uses default Play (opacity-0 group-hover:opacity-100)"
metrics:
  duration: ~12min
  completed: 2026-05-07
requirements: [LAUNCH-02, LAUNCH-03, LAUNCH-04, LAUNCH-05, TIME-04, TRAY-01]
---

# Phase 3 Plan 03f: Frontend Launch UI + Detail Page + Settings LE + Tray UX Summary

**One-liner:** Wired the 7 launch/session Tauri commands + 2 lifecycle events into the React UI, surfacing a sticky ActiveSessionBar, per-card 启动/强制结束 affordances, a minimal /games/:id detail page (cover + total time + LE config + sessions list), Settings LE path override, and the first-time close-to-tray toast — completing the Phase 3 user-facing surface.

## Tasks Completed

### Task 1: Launch invoke layer + library store extensions + main.tsx event subscriptions — `8303314`

- **`src/lib/launch.ts` (NEW)** — 7 typed invoke wrappers (`launchGame` / `endActiveSession` / `getActiveSession` / `listSessions` / `updateGameLaunchConfig` / `getLePath` / `setLePath`) + 2 event subscriptions (`onActiveSessionChanged` / `onCloseToTray`). `ActiveSession` and `SessionRow` interfaces mirror the backend's `orchestrator::ActiveSession` and `commands::SessionRow` 1:1 (snake_case fields preserved over the wire; no `rename_all` translation on either side).
- **`src/store/library.ts`** — appended `activeSession: ActiveSession | null` + `sessionsByGame: Record<number, SessionRow[]>` slices with shallow setters; consistent with the existing scanRoots/games pattern.
- **`src/main.tsx`** — added module-scope subscriptions for both new events (idempotency-guarded with module-let flags). Boot-time `getActiveSession()` hydrates the store before the listener attaches so a webview reload mid-session shows the bar immediately. `close-to-tray` toast is gated by `localStorage.getItem("gal-lib:tray-toast-dismissed")` — first occurrence shows the locked copy 已最小化到系统托盘 / 应用仍在后台运行；右键托盘图标可恢复或退出 with a 不再提示 action that flips the flag.

**Verification:** `pnpm typecheck` exit 0.

### Task 2: ActiveSessionBar + GameCard launch button + Detail route + Library/Settings/router updates — `4c0982e`, `acb1acf`

- **`src/components/library/ActiveSessionBar.tsx` (NEW)** — sticky-top h-14 bar mirroring ScanProgressBar's visual pattern (bg-background/95 backdrop-blur border-b). Renders cover thumbnail (40px from `convertFileSrc(dataDir + cover_path)`), 游戏中 — {name} title + 已游玩 {H}时{M}分 elapsed (1Hz tick via setInterval cleaned up when activeSession→null). Right-side ghost-variant 强制结束 button → AlertDialog 确定强制结束游戏？本次会话将记为已取消 → `endActiveSession()` + toast.info 已结束游戏会话.
- **`src/components/library/GameCard.tsx`** — added launch-button overlay at cover bottom-right (Play icon, opacity-0 group-hover:opacity-100). Active-game card shows a `destructive` `Square` icon button at opacity-100 wired to `endActiveSession()`. When some other game is active the launch button is hidden entirely (single-session lock mirrored in UI). Dropdown menu gains conditional 启动 / 强制结束 items (with separator from existing 重新匹配元数据 / 重新抓取封面). Card click changed from `toast.info("详情页 — 即将上线")` to `navigate(`/games/${game.id}`)`. Repositioned the no-exe badge from bottom-right to bottom-left so it doesn't collide with the launch button.
- **`src/routes/Detail.tsx` (NEW, default export)** — minimal /games/:id page. Hero: 200×267 cover (aspect-cover) + name (name_cn ?? name) + status badge + 总时长 {H} 时 {M} 分 + launch button (disabled when active, otherActive, or noExe; label 游戏中 vs 启动). When `executable_path` is null, a yellow inline AlertTriangle callout reads 未识别可执行文件 — 请手动指定 (manual override UX deferred to Phase 4 — Phase 3 just blocks the launch button). 启动配置 grid: LE Profile Select (Japanese / Simplified Chinese / Traditional Chinese / Custom hardcoded list) + 启动参数 Input + 工作目录 (cwd) Input (留空 = exe 同级目录 placeholder). 会话历史 list with locked empty-state copy 还没有游玩记录 — 启动游戏开始记录; rows show RFC3339→zh-CN locale-formatted timestamp + duration + status badge (已完成/进行中/启动中/已取消/启动失败). Form save semantics: 启动 button calls `updateGameLaunchConfig` with current form state THEN `launchGame` in a single round-trip pair (avoids a separate 保存配置 button in this minimal cut). cwd empty-string sent as `undefined` (preserves NULL semantics) while args empty-string is sent verbatim (lets user clear).
- **`src/router.tsx`** — added child route `{ path: "games/:id", element: <Detail /> }` + import.
- **`src/routes/Library.tsx`** — inserted `<ActiveSessionBar />` after `<ScanProgressBar />`. Both are sticky top-0 inside the same flex column; when both visible simultaneously, ScanProgressBar wins the top slot and ActiveSessionBar stacks below.
- **`src/routes/Settings.tsx`** — prepended Locale Emulator section before 扫描操作. Subtitle: 用于将日文游戏转区启动；自动检测如果失败请手动指定 LEProc.exe 路径. Readonly Input bound to `lePath ?? "未检测到"`; 选择 LEProc.exe button opens plugin-dialog (filters `[{ name: "LEProc", extensions: ["exe"] }]`), calls `applyLePath()` (aliased `setLePath` import to avoid clash with React state setter), refreshes display + emits 已设置 LE 路径 success toast. Backend's `get_le_path` already filters stale paths so a non-null return guarantees the file exists at-call.

**Verification:** `pnpm typecheck` exit 0; `pnpm vite build` succeeds (531 kB main chunk gzipped to 165 kB; postcss `@import` ordering warning is pre-existing in `src/index.css`, unrelated to this plan); `cargo check` exit 0 with only pre-existing dead-code warnings.

## Locked Copy Verification

All copy verbatim from CONTEXT/UI-SPEC contracts:

| Surface | Locked text |
|---------|-------------|
| close-to-tray toast title | 已最小化到系统托盘 |
| close-to-tray toast desc | 应用仍在后台运行；右键托盘图标可恢复或退出 |
| close-to-tray dismiss action | 不再提示 |
| ActiveSessionBar elapsed | 已游玩 {H}时{M}分 / 已游玩 {M}分 |
| ActiveSessionBar action | 强制结束 |
| Force-end confirm title | 确定强制结束游戏？ |
| Force-end confirm desc | 本次会话将记为已取消 |
| Force-end success toast | 已结束游戏会话 |
| Card / Detail launch button | 启动 / 游戏中 |
| Card launch start toast | 正在启动 — {game.name} |
| Card launch failure toast | 启动失败 — ... |
| Single-session conflict toast | 已有活动游戏 — 请先结束当前会话 |
| Detail total time label | 总时长 |
| Detail config section | 启动配置 / LE Profile / 启动参数 / 工作目录 (cwd) |
| Detail history section | 会话历史 / 还没有游玩记录 — 启动游戏开始记录 |
| Detail no-exe inline callout | 未识别可执行文件 — 请手动指定 |
| Settings LE section title | Locale Emulator |
| Settings LE subtitle | 用于将日文游戏转区启动；自动检测如果失败请手动指定 LEProc.exe 路径 |
| Settings LE pick button | 选择 LEProc.exe |
| Settings LE empty value | 未检测到 |
| Settings LE success toast | 已设置 LE 路径 |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Removed unused `ActiveSession` type import in ActiveSessionBar**
- **Found during:** Task 2 typecheck (TS6133 'ActiveSession' is declared but its value is never read)
- **Issue:** Initial draft imported `ActiveSession` type alongside `endActiveSession`, but the bar reads `activeSession` directly from the store (typed at the store boundary), so the local import is unused.
- **Fix:** Removed `, type ActiveSession` from the launch import.
- **Commit:** `4c0982e`

**2. [Rule 2 - Critical UX] No-exe handling in Detail page**
- **Issue:** Plan said "if executable_path is null, defer the actual override UX to Phase 4 — for P3 just disable the launch button". The bare disabled button gives no signal to the user about why launch is unavailable.
- **Fix:** Added a yellow AlertTriangle inline callout 未识别可执行文件 — 请手动指定 above the launch button explaining the disabled state. Mirrors the locked copy from the no-exe GameCard badge.
- **Commit:** `4c0982e`

**3. [Rule 2 - UX correctness] Boot-time active-session hydration**
- **Issue:** Plan only specified the `onActiveSessionChanged` event listener. A webview reload mid-session would leave the bar invisible until the next lifecycle event (which only fires on transitions, not on each tick). The user would think their session was lost.
- **Fix:** Added `getActiveSession()` call BEFORE the listener attach in main.tsx — populates the store synchronously on boot if a session is in flight.
- **Commit:** `8303314`

**4. [Rule 2 - UX correctness] No-exe badge repositioned in GameCard**
- **Issue:** Pre-03f, the no-exe badge was at `bottom-right` of the cover. Adding the launch button at the same position created a visual collision.
- **Fix:** Moved the no-exe badge to `bottom-left`. The position is purely informational so the change is non-breaking.
- **Commit:** `4c0982e`

**5. [Rule 2 - UX correctness] Single-session lock mirrored in UI**
- **Issue:** Plan said "If activeSession is non-null in store, hide the launch button". Strict reading would hide the button on the active game's card too — but that's where 强制结束 needs to live.
- **Fix:** When the active game is THIS card, render the destructive Square 强制结束 button (always visible at opacity-100). When some OTHER game is active, hide the button entirely (avoid enabled button that would emit backend rejection toast). When no session is active, render the standard hover-revealed Play 启动 button.
- **Commit:** `4c0982e`

### Auth gates encountered: None.

## Phase 3 Completeness Check

| Plan | Status | Commit |
|------|--------|--------|
| 03a (DB schema v3) | ✓ done | (prior wave) |
| 03b (LE detection) | ✓ done | (prior wave) |
| 03c (process tracking + session lifecycle) | ✓ done | (prior wave) |
| 03d (orchestrator + 7 Tauri commands) | ✓ done | (prior wave) |
| 03e (system tray + close-to-tray + quit cleanup) | ✓ done | (prior wave) |
| 03f (frontend wire-up — THIS PLAN) | ✓ done | `8303314` `4c0982e` `acb1acf` |

**Phase 3 user-visible surface complete:**
- Settings → Locale Emulator section detects + manually overrides LEProc.exe
- Library → ActiveSessionBar shows currently-running game with live elapsed time
- GameCard → hover-shown 启动 button on each card; 强制结束 on the active game's card
- Detail page → /games/:id with cover + total time + LE Profile config + sessions history
- Tray → close-to-tray with first-time toast + 不再提示 dismissal
- Background timing → playtime keeps counting after window close (verified via 03c+03d backend)

## Self-Check: PASSED

**Files created — verified on disk:**
- ✓ `src/lib/launch.ts`
- ✓ `src/components/library/ActiveSessionBar.tsx`
- ✓ `src/routes/Detail.tsx`

**Files modified — verified via git log:**
- ✓ `src/store/library.ts` (commit `8303314`)
- ✓ `src/main.tsx` (commit `8303314`)
- ✓ `src/components/library/GameCard.tsx` (commit `4c0982e`)
- ✓ `src/routes/Library.tsx` (commit `4c0982e`)
- ✓ `src/router.tsx` (commit `acb1acf`)
- ✓ `src/routes/Settings.tsx` (commit `acb1acf`)

**Commits — verified via git log:**
- ✓ `8303314` feat(03-03f): add launch invoke helpers + library store extensions + main.tsx event subscriptions
- ✓ `4c0982e` feat(03-03f): GameCard launch button + ActiveSessionBar + Detail route
- ✓ `acb1acf` feat(03-03f): Settings LE path section + router /games/:id

**Build gates:**
- ✓ `pnpm typecheck` → exit 0
- ✓ `pnpm vite build` → exit 0 (1907 modules transformed; 531 kB main chunk)
- ✓ `cargo check` → exit 0 (no new warnings introduced; pre-existing dead-code warnings unchanged)
