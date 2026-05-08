/**
 * Sidebar — fixed-width 220px left rail, auto-derived categories.
 *
 * Phase 4 (04d) full rewrite (replaces the P1 placeholder):
 *
 *   On mount → calls `getSidebarCategories()` and stores the result in
 *   `useLibraryStore.sidebar`. Re-fetches on the same triggers as the games
 *   grid (after scan completion + post-launch session end + tag CRUD; the
 *   trigger pattern lives in higher routes — Sidebar simply re-fetches on
 *   `sidebar` becoming null OR when the games grid signals it).
 *
 *   Sections (top-to-bottom, all rendered as plain div lists; collapsible
 *   `<details>` is used for the 4 multi-row sections — keeps a11y intact
 *   without pulling in shadcn Accordion):
 *
 *     - 全部             — resets BOTH filter and searchQuery; always at top
 *     - 收藏 (count)     — sets filter.favorite = true
 *     - 通关状态         — collapsible, 4 children: 未游玩 / 游玩中 / 已通关 / 已弃 (each with count)
 *     - 标签             — collapsible, children = sidebar.tags list
 *     - 品牌             — collapsible, children = sidebar.brands list
 *     - 年代             — collapsible, children = sidebar.year_decades buckets
 *
 *   Click semantics: clicking any leaf item REPLACES `store.filter` with a
 *   single-axis filter (e.g. `{ status: "playing" }`). This is intentional
 *   — the sidebar is for "narrow to one axis" navigation; the FilterChip
 *   then exposes per-slice clear without going back to the sidebar. The
 *   `searchQuery` slice is preserved (search × filter compose per
 *   04-CONTEXT §Search & Filter UX).
 *
 *   Active state visual: 2px bg-ring left bar + bg-accent on the active
 *   leaf — matches the existing 设置 nav active style from P1.
 *
 *   Bottom nav: 设置 nav button preserved from P1 (separator above).
 *
 * UI-SPEC §Layout/Copywriting Contract — strings + width are LOCKED.
 *   Width: 220px arbitrary value syntax (no Tailwind alias, no inline style)
 *   Section headings: 分类
 *   Locked copy: 全部 / 收藏 / 标签 / 通关状态 / 品牌 / 年代 / 设置
 *                未游玩 / 游玩中 / 已通关 / 已弃
 */

import { useEffect } from "react";
import {
  BarChart3,
  ChevronDown,
  Settings as SettingsIcon,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useLibraryStore } from "@/store/library";
import { getSidebarCategories } from "@/lib/search";
import { listTags } from "@/lib/tags";
import type { SearchFilter } from "@/lib/search";

/**
 * Map the `status` enum to LOCKED Chinese copy. Order matches the
 * 04d execution-context list: 未游玩 / 游玩中 / 已通关 / 已弃.
 */
const STATUS_DISPLAY: Array<{
  value: "unplayed" | "playing" | "cleared" | "dropped";
  label: string;
}> = [
  { value: "unplayed", label: "未游玩" },
  { value: "playing", label: "游玩中" },
  { value: "cleared", label: "已通关" },
  { value: "dropped", label: "已弃" },
];

export function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const isSettingsActive = location.pathname === "/settings";
  const isStatsActive = location.pathname === "/stats";

  const sidebar = useLibraryStore((s) => s.sidebar);
  const setSidebar = useLibraryStore((s) => s.setSidebar);
  const setTags = useLibraryStore((s) => s.setTags);
  const filter = useLibraryStore((s) => s.filter);
  const setFilter = useLibraryStore((s) => s.setFilter);
  const setSearchQuery = useLibraryStore((s) => s.setSearchQuery);

  // Initial load — categories + tag cache. Both feed sidebar rendering.
  useEffect(() => {
    getSidebarCategories()
      .then(setSidebar)
      .catch((e: unknown) => {
        // eslint-disable-next-line no-console
        console.error("[Sidebar] getSidebarCategories failed:", e);
      });
    listTags()
      .then(setTags)
      .catch((e: unknown) => {
        // eslint-disable-next-line no-console
        console.error("[Sidebar] listTags failed:", e);
      });
  }, [setSidebar, setTags]);

  /**
   * Replace the entire filter slice with a single-axis filter (clearing
   * any other axes). Sidebar leaves are mutually exclusive by design.
   * Bounces back to the Library route so the click has visible effect
   * when invoked from /settings or /stats.
   */
  function applyFilter(next: SearchFilter) {
    if (location.pathname !== "/") {
      navigate("/");
    }
    setFilter(next);
  }

  /**
   * "全部" — reset everything (filter + searchQuery). Restores the boot
   * view: full library, default sort. Same route-bounce as applyFilter.
   */
  function resetAll() {
    if (location.pathname !== "/") {
      navigate("/");
    }
    setFilter({});
    setSearchQuery("");
  }

  // Compute the "is this leaf active?" flag for each axis. We treat the
  // filter as active on a leaf only when EXACTLY that one slice is set
  // (matches the single-axis-at-a-time activation rule).
  const isAllActive =
    filter.tag_id == null &&
    filter.status == null &&
    !filter.favorite &&
    filter.brand == null &&
    filter.year_decade == null;

  const isFavoriteActive =
    filter.favorite === true &&
    filter.tag_id == null &&
    filter.status == null &&
    filter.brand == null &&
    filter.year_decade == null;

  function isStatusActive(status: string): boolean {
    return (
      filter.status === status &&
      filter.tag_id == null &&
      !filter.favorite &&
      filter.brand == null &&
      filter.year_decade == null
    );
  }

  function isTagActive(tagId: number): boolean {
    return (
      filter.tag_id === tagId &&
      filter.status == null &&
      !filter.favorite &&
      filter.brand == null &&
      filter.year_decade == null
    );
  }

  function isBrandActive(brand: string): boolean {
    return (
      filter.brand === brand &&
      filter.tag_id == null &&
      filter.status == null &&
      !filter.favorite &&
      filter.year_decade == null
    );
  }

  function isDecadeActive(decade: number): boolean {
    return (
      filter.year_decade === decade &&
      filter.tag_id == null &&
      filter.status == null &&
      !filter.favorite &&
      filter.brand == null
    );
  }

  return (
    <aside className="flex h-full w-[220px] shrink-0 flex-col bg-card border-r border-border">
      <ScrollArea className="flex-1">
        <div className="flex flex-col py-2">
          {/* Section heading: 分类 */}
          <div className="px-4 py-2 text-label text-muted-foreground select-none">
            分类
          </div>

          <ul className="flex flex-col">
            {/* 全部 — resets everything */}
            <SidebarLeaf
              label="全部"
              active={isAllActive}
              onClick={resetAll}
            />

            {/* 收藏 — single-leaf with count badge */}
            <SidebarLeaf
              label="收藏"
              count={sidebar?.favorite_count ?? 0}
              active={isFavoriteActive}
              onClick={() => applyFilter({ favorite: true })}
            />

            {/* 通关状态 — collapsible group, 4 children */}
            <SidebarGroup label="通关状态" defaultOpen>
              {STATUS_DISPLAY.map(({ value, label }) => {
                const count =
                  sidebar?.statuses.find((s) => s.status === value)?.count ?? 0;
                return (
                  <SidebarLeaf
                    key={value}
                    label={label}
                    count={count}
                    indent
                    active={isStatusActive(value)}
                    onClick={() => applyFilter({ status: value })}
                  />
                );
              })}
            </SidebarGroup>

            {/* 标签 — collapsible group; sidebar.tags list */}
            <SidebarGroup label="标签">
              {(sidebar?.tags ?? []).length === 0 ? (
                <li
                  className="px-4 pl-8 py-1 text-label text-muted-foreground select-none"
                  aria-disabled="true"
                >
                  无
                </li>
              ) : (
                sidebar!.tags.map(({ tag, count }) => (
                  <SidebarLeaf
                    key={tag.id}
                    label={tag.name}
                    count={count}
                    indent
                    active={isTagActive(tag.id)}
                    onClick={() => applyFilter({ tag_id: tag.id })}
                  />
                ))
              )}
            </SidebarGroup>

            {/* 品牌 — collapsible group; sidebar.brands list */}
            <SidebarGroup label="品牌">
              {(sidebar?.brands ?? []).length === 0 ? (
                <li
                  className="px-4 pl-8 py-1 text-label text-muted-foreground select-none"
                  aria-disabled="true"
                >
                  无
                </li>
              ) : (
                sidebar!.brands.map(({ brand, count }) => (
                  <SidebarLeaf
                    key={brand}
                    label={brand}
                    count={count}
                    indent
                    active={isBrandActive(brand)}
                    onClick={() => applyFilter({ brand })}
                  />
                ))
              )}
            </SidebarGroup>

            {/* 年代 — collapsible group; decade buckets */}
            <SidebarGroup label="年代">
              {(sidebar?.year_decades ?? []).length === 0 ? (
                <li
                  className="px-4 pl-8 py-1 text-label text-muted-foreground select-none"
                  aria-disabled="true"
                >
                  无
                </li>
              ) : (
                sidebar!.year_decades.map(({ decade, count }) => (
                  <SidebarLeaf
                    key={decade}
                    label={`${decade}s`}
                    count={count}
                    indent
                    active={isDecadeActive(decade)}
                    onClick={() => applyFilter({ year_decade: decade })}
                  />
                ))
              )}
            </SidebarGroup>
          </ul>
        </div>
      </ScrollArea>

      {/* Bottom: Separator + 统计 nav (above) + 设置 nav (below).
          Order is locked by 05-CONTEXT.md §Stats Page — 统计 sits above 设置
          so the stats entry-point is more prominent than the catch-all
          settings page. Both share the same active-state visual (2px bg-ring
          left bar + bg-accent) so they feel like a coherent nav group. */}
      <div className="flex flex-col">
        <Separator />
        <button
          type="button"
          onClick={() => navigate("/stats")}
          aria-current={isStatsActive ? "page" : undefined}
          className={cn(
            "relative flex items-center gap-2 px-4 py-2 text-body text-foreground",
            "transition-colors duration-150",
            "hover:bg-accent",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            isStatsActive && "bg-accent"
          )}
        >
          {isStatsActive && (
            <span
              aria-hidden="true"
              className="absolute left-0 top-0 h-full w-[2px] bg-ring"
            />
          )}
          <BarChart3 size={16} />
          <span>统计</span>
        </button>
        <button
          type="button"
          onClick={() => navigate("/settings")}
          aria-current={isSettingsActive ? "page" : undefined}
          className={cn(
            "relative flex items-center gap-2 px-4 py-2 text-body text-foreground",
            "transition-colors duration-150",
            "hover:bg-accent",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            isSettingsActive && "bg-accent"
          )}
        >
          {isSettingsActive && (
            <span
              aria-hidden="true"
              className="absolute left-0 top-0 h-full w-[2px] bg-ring"
            />
          )}
          <SettingsIcon size={16} />
          <span>设置</span>
        </button>
      </div>
    </aside>
  );
}

// ── Internal sub-components ────────────────────────────────────────────────

interface SidebarLeafProps {
  label: string;
  /** Optional count badge after the label. Hidden when undefined. */
  count?: number;
  /** Indented one extra level (used for items inside SidebarGroup). */
  indent?: boolean;
  /** Active state — renders the 2px bg-ring left bar + bg-accent. */
  active?: boolean;
  onClick: () => void;
}

/**
 * One clickable sidebar row. Encapsulates the shared active-state visual
 * (left accent bar + bg-accent) and the count-badge layout, so the
 * top-level Sidebar render stays declarative.
 */
function SidebarLeaf({
  label,
  count,
  indent,
  active,
  onClick,
}: SidebarLeafProps) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-current={active ? "true" : undefined}
        className={cn(
          "relative flex w-full items-center gap-2 py-1.5 pr-4 text-body text-foreground",
          indent ? "pl-8" : "pl-4",
          "transition-colors duration-150 hover:bg-accent",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0",
          active && "bg-accent"
        )}
      >
        {active && (
          <span
            aria-hidden="true"
            className="absolute left-0 top-0 h-full w-[2px] bg-ring"
          />
        )}
        <span className="flex-1 text-left line-clamp-1">{label}</span>
        {count != null && (
          <span className="text-label text-muted-foreground tabular-nums">
            {count}
          </span>
        )}
      </button>
    </li>
  );
}

interface SidebarGroupProps {
  label: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

/**
 * Collapsible heading + nested list. Uses the native <details>/<summary>
 * pair for zero-dep collapsible behavior — Tailwind's group-open: variants
 * pick up the `details[open]` attribute via `[&[open]>summary>svg]` so we
 * rotate the chevron on open.
 *
 * Note: <details>'s default disclosure marker is suppressed via
 * `[&::-webkit-details-marker]:hidden` and `list-none` (Firefox).
 */
function SidebarGroup({ label, defaultOpen, children }: SidebarGroupProps) {
  return (
    <li>
      <details open={defaultOpen} className="group/sidebar-grp">
        <summary
          className={cn(
            "flex w-full cursor-pointer items-center gap-2 px-4 py-1.5 text-body text-foreground",
            "list-none [&::-webkit-details-marker]:hidden",
            "transition-colors duration-150 hover:bg-accent",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          )}
        >
          <ChevronDown
            size={14}
            className="text-muted-foreground transition-transform duration-150 -rotate-90 group-open/sidebar-grp:rotate-0"
            aria-hidden
          />
          <span className="flex-1 text-left">{label}</span>
        </summary>
        <ul className="flex flex-col">{children}</ul>
      </details>
    </li>
  );
}
