/**
 * UIPreferences — Settings page section for UI-only preferences.
 *
 * Phase 4 / 04f §Settings Page Polish (LIB-07) — exposes two knobs:
 *   1. 默认排序 — picks which `SortBy` the library grid uses on app boot.
 *      Persisted to localStorage under `gal-lib:default-sort`. Phase 5 may
 *      promote this to backend-side `config.json` (alongside `le_path` and
 *      friends); the localStorage key is the simplest cross-route
 *      persistence layer we have today, and the value space is small (a
 *      single SortBy string), so we don't need IndexedDB or a Tauri command.
 *   2. 主题 — disabled placeholder. Dark/light theme switching ships in
 *      Phase 5 (next-themes is already in package.json); this row exists
 *      so the Settings layout reflects the eventual final state and gives
 *      users an honest hint about scope.
 *
 * Reading the saved sort:
 *   - On app boot, the library route should call `loadDefaultSort()` once
 *     and seed `useLibraryStore.sortBy` with the result. We do NOT do that
 *     here because this component is owned by /settings and shouldn't
 *     reach across into the boot sequence — exposing a pure helper keeps
 *     the dependency direction clean.
 *
 * Locked copy (04f plan Critical guardrails):
 *   `UI 偏好` heading, `默认排序` row label, `主题` row label,
 *   `暗色（深浅色切换将在 Phase 5 加入）` hint text.
 */

import { useEffect, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SortBy } from "@/lib/search";

/** localStorage key for the default sort preference. */
export const DEFAULT_SORT_STORAGE_KEY = "gal-lib:default-sort";

/**
 * Sort options + locked Chinese labels — kept in sync with
 * `src/components/library/SortSelect.tsx` (same SortBy enum, same label
 * mapping). Duplicated rather than imported because the Library SortSelect
 * is a different component and we don't want a cross-route prop coupling
 * between them.
 */
const SORT_OPTIONS: ReadonlyArray<{ value: SortBy; label: string }> = [
  { value: "last_played", label: "最近游玩" },
  { value: "created_at", label: "添加日期" },
  { value: "name", label: "字母" },
  { value: "playtime", label: "时长" },
  { value: "rating", label: "评分" },
] as const;

/** Whitelist of valid SortBy values for storage validation. */
const VALID_SORTS = new Set<SortBy>(SORT_OPTIONS.map((o) => o.value));

/**
 * Read the persisted default sort from localStorage. Returns `null` if no
 * value is stored OR the stored value is not in the SortBy whitelist
 * (defensive — a corrupt write or a future schema change should not crash
 * the boot path; callers should fall back to the store's compile-time
 * default of `last_played`).
 *
 * Exported so the Library route can seed `useLibraryStore.sortBy` on boot.
 */
export function loadDefaultSort(): SortBy | null {
  try {
    const raw = window.localStorage.getItem(DEFAULT_SORT_STORAGE_KEY);
    if (raw === null) return null;
    if (VALID_SORTS.has(raw as SortBy)) return raw as SortBy;
    return null;
  } catch {
    // Privacy-mode browsers may throw on localStorage access. Silently
    // ignore — the in-memory default still applies.
    return null;
  }
}

/** Write a SortBy choice to localStorage. Errors are swallowed (private mode). */
function saveDefaultSort(sort: SortBy): void {
  try {
    window.localStorage.setItem(DEFAULT_SORT_STORAGE_KEY, sort);
  } catch {
    // ignore
  }
}

export function UIPreferences() {
  const [defaultSort, setDefaultSort] = useState<SortBy>("last_played");

  // Hydrate from localStorage on mount. We avoid `useState(() => loadDefaultSort())`
  // because the persisted value is also re-used by the Library boot path —
  // keeping the read in `useEffect` makes the side-effect explicit and SSR-safe
  // (Tauri renders client-side, but the discipline costs nothing).
  useEffect(() => {
    const persisted = loadDefaultSort();
    if (persisted !== null) {
      setDefaultSort(persisted);
    }
  }, []);

  function onChange(next: string) {
    const value = next as SortBy;
    setDefaultSort(value);
    saveDefaultSort(value);
  }

  return (
    <section className="space-y-4">
      <h2 className="text-base font-semibold text-foreground">UI 偏好</h2>

      {/* Row 1 — default sort. */}
      <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-card p-3">
        <span className="text-body text-foreground">默认排序</span>
        <Select value={defaultSort} onValueChange={onChange}>
          <SelectTrigger className="w-40" aria-label="默认排序">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Row 2 — theme placeholder (disabled until Phase 5). */}
      <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-card p-3 opacity-60">
        <span className="text-body text-foreground">主题</span>
        <span className="text-body text-muted-foreground">
          暗色（深浅色切换将在 Phase 5 加入）
        </span>
      </div>
    </section>
  );
}
