import { create } from "zustand";

/**
 * Application-wide ambient state.
 *
 * Phase 1 scope: only the resolved portable data directory absolute path
 * (filled at app boot via 01c's `getDataDir()` Tauri command). Future phases
 * will add scan progress, current selection, etc. — keep this surface minimal.
 */
interface AppState {
  /** Absolute path to portable `data/` dir; null until first resolved. */
  dataDir: string | null;
  setDataDir: (dir: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  dataDir: null,
  setDataDir: (dir) => set({ dataDir: dir }),
}));
