/**
 * FilterChip — Library top-bar active-filter indicator(s).
 *
 * Renders one Badge per non-empty slice of `useLibraryStore.filter`:
 *   - tag_id      → resolves to the tag.name via `tags` cache (or "标签 #id"
 *                   fallback if the cache hasn't loaded yet)
 *   - status      → 4-value enum mapped to locked Chinese copy
 *   - favorite    → 收藏 (only when true; false/undefined renders nothing)
 *   - brand       → exact brand string from sidebar 品牌 list
 *   - year_decade → "{decade}s 年代" (e.g. "2010s 年代")
 *
 * Each chip has an inline "×" button that clears ONLY that slice
 * (preserves other active filters — supports multi-axis filtering even
 * though the sidebar UI currently sets one axis at a time).
 *
 * No-active-filter case: returns null so the surrounding flex row collapses.
 *
 * Why a separate component (vs. inline in Library.tsx):
 *   - Sidebar sets filter slices via `setFilter({...})`; FilterChip is the
 *     ONLY visible affordance to clear them without going back to the
 *     sidebar. Centralising the per-slice clear logic here keeps the
 *     Library route lean and gives the chip room to grow (i18n, custom
 *     colors per status).
 */

import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useLibraryStore } from "@/store/library";

/**
 * Map status enum → Chinese label. LOCKED copy from 04d context:
 * 未游玩 / 游玩中 / 已通关 / 已弃.
 */
const STATUS_LABELS: Record<
  "unplayed" | "playing" | "cleared" | "dropped",
  string
> = {
  unplayed: "未游玩",
  playing: "游玩中",
  cleared: "已通关",
  dropped: "已弃",
};

interface ChipDescriptor {
  /** Stable react key (also doubles as the "slice name" for clearing). */
  slice: "tag_id" | "status" | "favorite" | "brand" | "year_decade";
  /** Displayed label (e.g. "标签 · 百合", "状态 · 已通关"). */
  label: string;
}

export function FilterChip() {
  const filter = useLibraryStore((s) => s.filter);
  const setFilter = useLibraryStore((s) => s.setFilter);
  const tags = useLibraryStore((s) => s.tags);

  // Compute all active chips up-front. Empty array → return null below.
  const chips: ChipDescriptor[] = [];

  if (filter.tag_id != null) {
    const tag = tags.find((t) => t.id === filter.tag_id);
    chips.push({
      slice: "tag_id",
      label: `标签 · ${tag?.name ?? `#${filter.tag_id}`}`,
    });
  }
  if (filter.status != null) {
    chips.push({
      slice: "status",
      label: `状态 · ${STATUS_LABELS[filter.status]}`,
    });
  }
  if (filter.favorite === true) {
    chips.push({ slice: "favorite", label: "收藏" });
  }
  if (filter.brand != null && filter.brand !== "") {
    chips.push({ slice: "brand", label: `品牌 · ${filter.brand}` });
  }
  if (filter.year_decade != null) {
    chips.push({
      slice: "year_decade",
      label: `年代 · ${filter.year_decade}s`,
    });
  }

  if (chips.length === 0) return null;

  /**
   * Clear a single slice while preserving the others. We rebuild the filter
   * object excluding the named key — `setFilter` replaces the whole slice.
   */
  function clearSlice(slice: ChipDescriptor["slice"]) {
    const next = { ...filter };
    delete next[slice];
    setFilter(next);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => (
        <Badge
          key={chip.slice}
          variant="outline"
          className="gap-1 pr-1 text-label"
        >
          <span>{chip.label}</span>
          <button
            type="button"
            onClick={() => clearSlice(chip.slice)}
            aria-label={`清除筛选 — ${chip.label}`}
            className="inline-flex size-4 items-center justify-center rounded-sm hover:bg-accent focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <X size={12} aria-hidden />
          </button>
        </Badge>
      ))}
    </div>
  );
}
