/**
 * FilterChip — active-filter badges with per-slice clear (×).
 * v1.1 visual: matches design's `.chip` aesthetic — 28px height pill, line
 * border, hover bg-2.
 */

import { X } from "lucide-react";
import { useLibraryStore } from "@/store/library";
import { cn } from "@/lib/utils";

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
  slice: "tag_id" | "status" | "favorite" | "brand" | "year_decade";
  label: string;
}

export function FilterChip() {
  const filter = useLibraryStore((s) => s.filter);
  const setFilter = useLibraryStore((s) => s.setFilter);
  const tags = useLibraryStore((s) => s.tags);

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
  // 收藏 chip omitted here — StatusFilterChips already exposes it as a
  // top-level toggle. Showing it twice would be redundant.
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

  function clearSlice(slice: ChipDescriptor["slice"]) {
    const next = { ...filter };
    delete next[slice];
    setFilter(next);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => (
        <span
          key={chip.slice}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 border border-brand bg-brand-soft px-3 text-[11.5px] text-ink-0",
          )}
          style={{ borderRadius: "9999px" }}
        >
          <span>{chip.label}</span>
          <button
            type="button"
            onClick={() => clearSlice(chip.slice)}
            aria-label={`清除筛选 — ${chip.label}`}
            className="grid h-4 w-4 place-items-center rounded-sm text-ink-2 hover:text-ink-0"
          >
            <X size={11} aria-hidden />
          </button>
        </span>
      ))}
    </div>
  );
}
