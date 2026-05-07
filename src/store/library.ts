/**
 * Library-domain Zustand store — scan roots cache + live scan progress + games
 * + Phase 3 active session + per-game session history.
 *
 * Mirrors the pattern of `src/store/app.ts` (single `create()` invocation
 * with shallow setters; no slice/middleware).
 *
 * Phase 2 scope:
 *   - `scanRoots`: cached read-through of `scan_roots` table
 *   - `scanProgress`: latest `scan-progress` event payload (null when idle)
 *   - `games`: cached read-through of `games` table
 *
 * Phase 3 (03f) additions:
 *   - `activeSession`: latest payload of `active-session-changed` event
 *     (null when nothing is running). Hydrated from `getActiveSession()` on
 *     app boot, kept fresh by the module-scope subscription in `main.tsx`.
 *   - `sessionsByGame`: per-game session-history cache. Keyed by `game.id`,
 *     populated by the Detail page on mount via `listSessions(gameId)`. We
 *     keep this in the global store rather than per-route state so a future
 *     "totals across all games" view can subscribe without prop-drilling.
 *
 * Source-of-truth rule: backend (SQLite + Tauri events) owns these
 * collections; frontend cache is reconciled by re-calling the relevant
 * `list*()` invoke after a mutation, and updated by event listeners
 * subscribed at module scope. Avoids the optimistic-update vs. real-state
 * divergence trap.
 */

import { create } from "zustand";
import type { ScanProgress, ScanRoot } from "@/lib/scan";
import type { Game } from "@/lib/games";
import type { ActiveSession, SessionRow } from "@/lib/launch";

interface LibraryState {
  /** Full list of scan_roots rows; refreshed after add/remove. */
  scanRoots: ScanRoot[];
  /**
   * Most recent scan-progress event payload, or `null` when no scan is or
   * has been active in this session. UI components null-check before
   * rendering the progress bar.
   */
  scanProgress: ScanProgress | null;
  /**
   * Full list of games (rendered as the cover grid). Refreshed after every
   * scan completion + after every metadata bind/refresh. Empty array means
   * either "no scans yet" OR "scanned but zero hits" — the consumer
   * disambiguates via `scanProgress.status`.
   */
  games: Game[];

  /**
   * Currently-running game session, or null. Driven by the
   * `active-session-changed` event subscription in `main.tsx`. Used by:
   *   - `<ActiveSessionBar />` (sticky-top bar; null hides it)
   *   - `<GameCard />` (toggles 启动 ↔ 强制结束 button visibility)
   *   - `<Detail />` (disables the launch button on the active game's page)
   */
  activeSession: ActiveSession | null;
  /**
   * Per-game session history cache. Keyed by `game.id`; populated lazily by
   * the Detail page on mount. Not auto-evicted (typical libraries are
   * 50-500 games × ≤100 sessions = bounded memory).
   */
  sessionsByGame: Record<number, SessionRow[]>;

  setScanRoots: (rs: ScanRoot[]) => void;
  setScanProgress: (p: ScanProgress | null) => void;
  setGames: (gs: Game[]) => void;
  setActiveSession: (s: ActiveSession | null) => void;
  setSessionsForGame: (gameId: number, sessions: SessionRow[]) => void;
}

export const useLibraryStore = create<LibraryState>((set) => ({
  scanRoots: [],
  scanProgress: null,
  games: [],
  activeSession: null,
  sessionsByGame: {},
  setScanRoots: (rs) => set({ scanRoots: rs }),
  setScanProgress: (p) => set({ scanProgress: p }),
  setGames: (gs) => set({ games: gs }),
  setActiveSession: (s) => set({ activeSession: s }),
  setSessionsForGame: (gameId, sessions) =>
    set((st) => ({
      sessionsByGame: { ...st.sessionsByGame, [gameId]: sessions },
    })),
}));
