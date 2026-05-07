/**
 * SearchBar — Library top-bar full-text search input.
 *
 * UX contract (04-CONTEXT §Search & Filter):
 *   - Controlled <Input> bound to `useLibraryStore.searchQuery`
 *   - Local state `value` mirrors the input synchronously (no UI lag) while
 *     a 200ms debounced effect promotes it into the store. Only the store
 *     change triggers the parent's `searchGames(...)` re-fetch (subscription
 *     in Library.tsx) — so typing fast does NOT issue per-keystroke invokes.
 *   - lucide `Search` icon prefix (absolute-positioned 8px from the left,
 *     with `pl-9` on the input so text doesn't overlap the icon).
 *   - Empty input is allowed and means "no LIKE clause" (the searchGames
 *     wrapper trims to null itself; we still send the empty string so the
 *     store stays controlled).
 *
 * Why a *local* mirror state + a debounced commit:
 *   - The store is the source of truth for the actual query (the effect in
 *     Library.tsx re-fetches when `searchQuery` changes), but writing to
 *     the store on every keystroke would cause the entire grid to re-render
 *     (Zustand subscribers fire synchronously). Local state isolates the
 *     typing latency from the heavy grid.
 *   - 200ms is the established UX rule from 04-CONTEXT (faster feels jumpy,
 *     slower feels sluggish for ~1k row LIKE-search latency).
 */

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useLibraryStore } from "@/store/library";

const DEBOUNCE_MS = 200;

export function SearchBar() {
  const storeQuery = useLibraryStore((s) => s.searchQuery);
  const setSearchQuery = useLibraryStore((s) => s.setSearchQuery);

  // Local mirror — keeps the input snappy. Initialised from the store so
  // navigating away and back preserves the typed query.
  const [value, setValue] = useState(storeQuery);

  // If the store changes externally (e.g. FilterChip clears, sidebar resets
  // via "全部"), keep the local mirror in sync. Cheap equality check avoids
  // resetting the cursor on every keystroke we ourselves caused.
  useEffect(() => {
    if (storeQuery !== value) {
      setValue(storeQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeQuery]);

  // Debounced commit: promote local value into the store after 200ms idle.
  useEffect(() => {
    if (value === storeQuery) return; // nothing to do (avoid extra commits)
    const t = setTimeout(() => {
      setSearchQuery(value);
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [value, storeQuery, setSearchQuery]);

  return (
    <div className="relative flex-1">
      <Search
        size={16}
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        type="text"
        value={value}
        onChange={(e) => setValue(e.currentTarget.value)}
        placeholder="搜索游戏 — 标题 / 罗马音 / 品牌 / 标签"
        aria-label="搜索游戏"
        className="pl-9"
      />
    </div>
  );
}
