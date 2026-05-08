import { useLibraryStore } from "@/store/library";
import { cn } from "@/lib/utils";

const CHIPS: Array<{
  key: "all" | "playing" | "cleared" | "unplayed" | "favorite";
  label: string;
}> = [
  { key: "all", label: "全部" },
  { key: "playing", label: "游玩中" },
  { key: "cleared", label: "已通关" },
  { key: "unplayed", label: "未开始" },
  { key: "favorite", label: "收藏" },
];

/**
 * Top-of-Library quick filter chips. Single-axis selection (matches Sidebar
 * single-axis activation rule). Clicking the active chip is a no-op (the
 * chip already shows that state).
 */
export function StatusFilterChips() {
  const totalGames = useLibraryStore((s) => s.games.length);
  const sidebar = useLibraryStore((s) => s.sidebar);
  const filter = useLibraryStore((s) => s.filter);
  const setFilter = useLibraryStore((s) => s.setFilter);
  const setSearchQuery = useLibraryStore((s) => s.setSearchQuery);

  const isAllActive =
    filter.tag_id == null &&
    filter.status == null &&
    !filter.favorite &&
    filter.brand == null &&
    filter.year_decade == null;

  function counts(key: (typeof CHIPS)[number]["key"]): number {
    if (key === "all") return totalGames;
    if (key === "favorite") return sidebar?.favorite_count ?? 0;
    return sidebar?.statuses.find((s) => s.status === key)?.count ?? 0;
  }

  function isActive(key: (typeof CHIPS)[number]["key"]): boolean {
    switch (key) {
      case "all":
        return isAllActive;
      case "favorite":
        return filter.favorite === true && filter.status == null;
      default:
        return filter.status === key && !filter.favorite;
    }
  }

  function onClick(key: (typeof CHIPS)[number]["key"]) {
    if (key === "all") {
      setFilter({});
      setSearchQuery("");
      return;
    }
    if (key === "favorite") {
      setFilter({ favorite: true });
      return;
    }
    setFilter({ status: key });
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {CHIPS.map(({ key, label }) => {
        const active = isActive(key);
        const n = counts(key);
        return (
          <button
            key={key}
            type="button"
            onClick={() => onClick(key)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 whitespace-nowrap border px-3 text-[11.5px] transition-colors",
              active
                ? "border-brand bg-brand-soft text-ink-0"
                : "border-line bg-bg-1 text-ink-1 hover:border-line-strong hover:bg-bg-2 hover:text-ink-0",
            )}
            style={{ borderRadius: "9999px" }}
          >
            <span>{label}</span>
            <span
              className={cn(
                "font-mono text-[9.5px] tracking-[0.04em]",
                active ? "text-ink-0" : "text-ink-3",
              )}
            >
              {n}
            </span>
          </button>
        );
      })}
    </div>
  );
}
