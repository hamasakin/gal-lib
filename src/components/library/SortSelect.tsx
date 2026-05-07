/**
 * SortSelect — Library top-bar sort-key dropdown.
 *
 * Wraps shadcn `Select` with the 5 sort options whitelisted by the backend
 * (`search_games` ORDER BY mapping in 04b commands.rs):
 *   - last_played → 最近游玩 (NULLS LAST DESC; default)
 *   - created_at  → 添加日期 (DESC)
 *   - name        → 字母 (NOCASE ASC)
 *   - playtime    → 时长 (DESC)
 *   - rating      → 评分 (NULLS LAST DESC)
 *
 * Copy is LOCKED by 04d execution context — do not rename without a
 * coordinated UI-SPEC update.
 *
 * Mutation flow:
 *   - User picks an option → `onValueChange` writes the new SortBy value
 *     into `useLibraryStore.sortBy`.
 *   - Library.tsx subscribes to `sortBy` and re-runs `searchGames(...)`.
 *   - The store does NOT re-fetch automatically (state-only) — keeps this
 *     component dumb and the side-effect localized to one place.
 *
 * w-40 (160px) matches the locked top-bar width from 04d context.
 */

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLibraryStore } from "@/store/library";
import type { SortBy } from "@/lib/search";

interface SortOption {
  value: SortBy;
  label: string;
}

// Order matches the 04d locked copy: 最近游玩 / 添加日期 / 字母 / 时长 / 评分.
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
    <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortBy)}>
      <SelectTrigger className="w-40" aria-label="排序方式">
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
  );
}
