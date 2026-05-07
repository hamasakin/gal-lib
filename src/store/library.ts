/**
 * Library-domain Zustand store — scan roots cache + live scan progress.
 *
 * Mirrors the pattern of `src/store/app.ts` (single `create()` invocation
 * with shallow setters; no slice/middleware). Phase 2 keeps state surface
 * minimal — Phase 4 will likely extend with `games`, filters, sort, search.
 *
 * Why a store at all (not just per-component `useState`)?
 * - `scanRoots` is read by Settings (CRUD UI) AND eventually by Library
 *   (empty-state hint "请到设置页添加扫描根目录") — needs cross-route reuse.
 * - `scanProgress` is updated by the global event listener wired in App.tsx
 *   (one subscription, many consumers — sticky progress bar in Library + a
 *   future toast on completion) — exactly what stores are for.
 *
 * Source-of-truth rule: backend (SQLite) owns scan_roots; frontend cache is
 * always reconciled by re-calling `listScanRoots()` after any mutation.
 * Avoids the classic optimistic-update vs. real-state divergence trap.
 */

import { create } from "zustand";
import type { ScanProgress, ScanRoot } from "@/lib/scan";

interface LibraryState {
  /** Full list of scan_roots rows; refreshed after add/remove. */
  scanRoots: ScanRoot[];
  /**
   * Most recent scan-progress event payload, or `null` when no scan is or
   * has been active in this session. UI components null-check before
   * rendering the progress bar.
   */
  scanProgress: ScanProgress | null;

  setScanRoots: (rs: ScanRoot[]) => void;
  setScanProgress: (p: ScanProgress | null) => void;
}

export const useLibraryStore = create<LibraryState>((set) => ({
  scanRoots: [],
  scanProgress: null,
  setScanRoots: (rs) => set({ scanRoots: rs }),
  setScanProgress: (p) => set({ scanProgress: p }),
}));
