/**
 * Tauri invoke wrappers for the Phase 3 launch + session subsystem.
 *
 * Wraps the 7 launch/session commands wired in 03d (`launch_game`,
 * `end_active_session`, `get_active_session`, `list_sessions`,
 * `update_game_launch_config`, `get_le_path`, `set_le_path`) plus two
 * Tauri-event subscriptions:
 *   - `active-session-changed` — emitted by 03d on session start AND by
 *     the watcher task when the underlying process exits or `.abort()` is
 *     called from `end_active_session`. Payload is `Option<ActiveSession>`
 *     (None / null = no active session).
 *   - `close-to-tray` — emitted by 03e's `WindowEvent::CloseRequested`
 *     interceptor; carries no payload (the visual side-effect is the
 *     frontend toast "已最小化到系统托盘").
 *
 * Shape sources of truth:
 *   - `ActiveSession` ↔ `src-tauri/src/launch/orchestrator.rs::ActiveSession`
 *     (no `rename_all` → snake_case fields preserved over the wire)
 *   - `SessionRow`    ↔ `src-tauri/src/commands.rs::SessionRow`
 *     (explicit `serde(rename_all = "snake_case")` even though Rust fields
 *      are already snake_case — kept for the same wire shape across both
 *      tauri::command serialize directions)
 *
 * Tauri 2.x invoke arg convention: snake_case Rust params; we pass the
 * camelCase JS keys here and Tauri auto-converts (verified by 03d e2e
 * launch test — `launch_game(game_id)` accepts JS `{ gameId }`).
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * Snapshot of the currently-running game session. Returned by `launch_game`
 * + `get_active_session`, also delivered via the `active-session-changed`
 * event payload (or `null` when no session is running).
 */
export interface ActiveSession {
  session_id: number;
  game_id: number;
  game_name: string;
  /** RFC3339 UTC timestamp; mirrors `sessions.started_at`. */
  started_at: string;
}

/**
 * One row from the `sessions` table after the schema-v3 (03a) migration.
 * `status` reflects the locked CHECK constraint values so the frontend can
 * exhaustively switch on them.
 */
export interface SessionRow {
  id: number;
  game_id: number;
  started_at: string;
  ended_at: string | null;
  duration_sec: number;
  status: "starting" | "running" | "completed" | "launch_failed" | "cancelled";
  exit_code: number | null;
}

// ── launch / session commands ───────────────────────────────────────────────

/**
 * Begin a new game session. Backend pre-checks that no other session is
 * active; returns the freshly-created `ActiveSession` (also emitted via
 * `active-session-changed`). Throws when:
 *   - another session is active
 *   - the game row is missing / has no executable_path
 *   - LE path can't be resolved
 *   - LEProc spawn fails (pre-launch IO error)
 */
export async function launchGame(gameId: number): Promise<ActiveSession> {
  return invoke<ActiveSession>("launch_game", { gameId });
}

/**
 * User-initiated "强制结束". Idempotent — calling when no session is active
 * is a no-op. Backend aborts the wait-for-exit task and marks the DB session
 * as `cancelled` (which still credits elapsed time to total_playtime_sec).
 */
export async function endActiveSession(): Promise<void> {
  await invoke("end_active_session");
}

/**
 * Read the in-memory active session, if any. Used on app boot to rehydrate
 * the active-session bar after a webview reload.
 */
export async function getActiveSession(): Promise<ActiveSession | null> {
  return invoke<ActiveSession | null>("get_active_session");
}

/**
 * Most recent 100 sessions for `gameId`, newest-first. Drives the Detail
 * page's "会话历史" list.
 */
export async function listSessions(gameId: number): Promise<SessionRow[]> {
  return invoke<SessionRow[]>("list_sessions", { gameId });
}

/**
 * Patch shape for `updateGameLaunchConfig`. Each field is optional; omitted
 * fields are left untouched on the row (`COALESCE(?, col)` semantics in 03d).
 *
 * Note: `Some("")` overwrites with empty string — intentional, lets the user
 * clear `launch_args` to "no extra args".
 */
export interface LaunchConfigPatch {
  le_profile?: string;
  launch_args?: string;
  cwd?: string;
  executable_path?: string;
}

export async function updateGameLaunchConfig(
  gameId: number,
  patch: LaunchConfigPatch,
): Promise<void> {
  // Tauri 2 serializes `undefined` JS values as `null` over IPC; this maps
  // to Rust's `Option<String>::None` which COALESCE treats as "keep current".
  await invoke("update_game_launch_config", {
    gameId,
    leProfile: patch.le_profile ?? null,
    launchArgs: patch.launch_args ?? null,
    cwd: patch.cwd ?? null,
    executablePath: patch.executable_path ?? null,
  });
}

// ── LE path config ──────────────────────────────────────────────────────────

/**
 * Read the persisted LE path. Backend filters out stale entries (file no
 * longer exists), so a returned non-null is guaranteed to point at an extant
 * file at the time of the call.
 */
export async function getLePath(): Promise<string | null> {
  return invoke<string | null>("get_le_path");
}

/**
 * Persist a manual LE path. Backend validates `path.exists()` before
 * writing — throws on invalid path so the Settings page can render a
 * precise error toast.
 */
export async function setLePath(path: string): Promise<void> {
  await invoke("set_le_path", { path });
}

// ── event subscriptions ─────────────────────────────────────────────────────

/**
 * Subscribe to `active-session-changed`. Payload is `ActiveSession | null`
 * (null = session ended). Caller MUST invoke the returned `UnlistenFn` on
 * cleanup. The default subscription site is `src/main.tsx` (module-scope,
 * outlives all routes).
 */
export async function onActiveSessionChanged(
  cb: (session: ActiveSession | null) => void,
): Promise<UnlistenFn> {
  return listen<ActiveSession | null>("active-session-changed", (e) => cb(e.payload));
}

/**
 * Subscribe to `close-to-tray` (emitted by 03e when the user closes the
 * main window). No payload — the frontend's only job is to surface the
 * "已最小化到系统托盘" toast on first occurrence (after which the user can
 * dismiss permanently via the localStorage flag, see `main.tsx`).
 */
export async function onCloseToTray(cb: () => void): Promise<UnlistenFn> {
  return listen<null>("close-to-tray", () => cb());
}
