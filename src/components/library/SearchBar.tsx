/**
 * SearchBar — top-of-Library full-text search input.
 *
 * Logic preserved from v1.0:
 *   - Local mirror state for snappy typing; 200ms debounced commit to store
 *   - Library.tsx subscribes to store.searchQuery and re-issues searchGames
 *
 * v1.1 visual: design's `.sb-search` aesthetic — bg-2 surface, mono kbd hint,
 * 30px left padding, 32px height, focus border accent.
 */

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { useLibraryStore } from "@/store/library";

const DEBOUNCE_MS = 200;

export function SearchBar() {
  const storeQuery = useLibraryStore((s) => s.searchQuery);
  const setSearchQuery = useLibraryStore((s) => s.setSearchQuery);

  const [value, setValue] = useState(storeQuery);

  useEffect(() => {
    if (storeQuery !== value) {
      setValue(storeQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeQuery]);

  useEffect(() => {
    if (value === storeQuery) return;
    const t = setTimeout(() => {
      setSearchQuery(value);
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [value, storeQuery, setSearchQuery]);

  return (
    <div className="relative w-72">
      <Search
        size={14}
        strokeWidth={1.7}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3"
        aria-hidden
      />
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.currentTarget.value)}
        placeholder="搜索游戏 / 标签 / 品牌…"
        aria-label="搜索游戏"
        className="h-8 w-full border border-line bg-bg-2 pl-9 pr-12 text-[12.5px] text-ink-0 outline-none transition-colors focus:border-brand"
        style={{ borderRadius: "var(--r-md)" }}
      />
      <span
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 border border-line px-1 font-mono text-[9.5px] text-ink-3"
        style={{ borderRadius: "var(--r-sm)" }}
      >
        ⌘K
      </span>
    </div>
  );
}
