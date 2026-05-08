/**
 * SortSelect — Library top-bar sort-key selector.
 *
 * v1.1 visual: native styled `<select>` matching design's `.sort-sel`
 * (28px height, mono ↓ caret hint, line-strong border on hover).
 */

import { useLibraryStore } from "@/store/library";
import type { SortBy } from "@/lib/search";

interface SortOption {
  value: SortBy;
  label: string;
}

const SORT_OPTIONS: readonly SortOption[] = [
  { value: "last_played", label: "最近游玩" },
  { value: "created_at", label: "添加日期" },
  { value: "name", label: "字母" },
  { value: "playtime", label: "时长" },
  { value: "rating", label: "评分" },
] as const;

export function SortSelect() {
  const sortBy = useLibraryStore((s) => s.sortBy);
  const setSortBy = useLibraryStore((s) => s.setSortBy);

  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
        排序
      </span>
      <select
        value={sortBy}
        onChange={(e) => setSortBy(e.currentTarget.value as SortBy)}
        aria-label="排序方式"
        className="h-7 cursor-pointer appearance-none border border-line bg-bg-1 pr-7 pl-2.5 text-[11.5px] text-ink-1 outline-none transition-colors hover:border-line-strong hover:bg-bg-2 focus:border-brand"
        style={{
          borderRadius: "var(--r-md)",
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path fill='rgba(255,255,255,.45)' d='M0 0h10L5 6z'/></svg>\")",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "right 8px center",
        }}
      >
        {SORT_OPTIONS.map((opt) => (
          <option
            key={opt.value}
            value={opt.value}
            className="bg-bg-1 text-ink-0"
          >
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
