/**
 * Library-domain Zustand store — scan roots cache + live scan progress + games.
 *
 * Mirrors the pattern of `src/store/app.ts` (single `create()` invocation
 * with shallow setters; no slice/middleware). Phase 2 scope:
 *   - `scanRoots`: cached read-through of `scan_roots` table
 *   - `scanProgress`: latest `scan-progress` event payload (null when idle)
 *   - `games`: cached read-through of `games` table (02f addition)
 *
 * Source-of-truth rule: backend (SQLite) owns these collections; frontend
 * cache is reconciled by re-calling the relevant `list*()` invoke after a
 * mutation. Avoids the optimistic-update vs. real-state divergence trap.
 */

import { create } from "zustand";
import type { ScanProgress, ScanRoot } from "@/lib/scan";
import type { Game } from "@/lib/games";

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

  setScanRoots: (rs: ScanRoot[]) => void;
  setScanProgress: (p: ScanProgress | null) => void;
  setGames: (gs: Game[]) => void;
}

export const useLibraryStore = create<LibraryState>((set) => ({
  scanRoots: [],
  scanProgress: null,
  games: [],
  setScanRoots: (rs) => set({ scanRoots: rs }),
  setScanProgress: (p) => set({ scanProgress: p }),
  setGames: (gs) => set({ games: gs }),
}));
