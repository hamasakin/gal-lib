/**
 * Sidebar — left rail navigation.
 *
 * v1.1 redesign — adopts design contract `.sb-*` aesthetic:
 *   - Width driven by --sidebar-w (narrow/regular/wide via Tweaks)
 *   - Section labels in mono uppercase 9.5px tracking 0.14em
 *   - Status rows use colored 6px square dots (s-playing/cleared/dropped/todo)
 *   - Hover bg-2 / active bg-accent-soft + ink-stamp accent left bar replaced
 *     by a subtle background highlight (matches design's full-row active state)
 *   - 全部 / 收藏 / 通关状态 / 标签 / 品牌 / 年代 + 底部 统计 + 设置
 *
 * Functional logic preserved from v1.0:
 *   - Single-axis activation (clicking a leaf REPLACES filter slice)
 *   - "全部" resets filter AND searchQuery
 *   - Route bounce to "/" when clicking from Settings/Stats
 *   - Source-of-truth fetch of getSidebarCategories on mount
 */

import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useLibraryStore } from "@/store/library";
import { getSidebarCategories } from "@/lib/search";
import { listTags } from "@/lib/tags";
import type { SearchFilter } from "@/lib/search";

const STATUS_DISPLAY: Array<{
  value: "unplayed" | "playing" | "cleared" | "dropped";
  label: string;
  dotClass: string;
}> = [
  { value: "playing", label: "游玩中", dotClass: "bg-brand" },
  { value: "cleared", label: "已通关", dotClass: "bg-[#6fd1c8]" },
  { value: "unplayed", label: "未开始", dotClass: "bg-ink-stamp" },
  { value: "dropped", label: "弃坑", dotClass: "bg-ink-2" },
];

export function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const isSettingsActive = location.pathname === "/settings";
  const isStatsActive = location.pathname === "/stats";
  const isScreenshotsActive = location.pathname === "/screenshots";

  const sidebar = useLibraryStore((s) => s.sidebar);
  const setSidebar = useLibraryStore((s) => s.setSidebar);
  const setTags = useLibraryStore((s) => s.setTags);
  const filter = useLibraryStore((s) => s.filter);
  const setFilter = useLibraryStore((s) => s.setFilter);
  const setSearchQuery = useLibraryStore((s) => s.setSearchQuery);
  const totalGames = useLibraryStore((s) => s.games.length);

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

  function applyFilter(next: SearchFilter) {
    if (location.pathname !== "/") {
      navigate("/");
    }
    setFilter(next);
  }

  function resetAll() {
    if (location.pathname !== "/") {
      navigate("/");
    }
    setFilter({});
    setSearchQuery("");
  }

  const filterEmpty =
    filter.tag_id == null &&
    filter.status == null &&
    !filter.favorite &&
    filter.brand == null &&
    filter.year_decade == null;

  const onLibraryRoute = location.pathname === "/";
  const isAllActive = onLibraryRoute && filterEmpty;
  const isFavoriteActive = onLibraryRoute && filter.favorite === true && filter.tag_id == null && filter.status == null && filter.brand == null && filter.year_decade == null;

  function isStatusActive(status: string): boolean {
    return (
      onLibraryRoute &&
      filter.status === status &&
      filter.tag_id == null &&
      !filter.favorite &&
      filter.brand == null &&
      filter.year_decade == null
    );
  }

  function isTagActive(tagId: number): boolean {
    return (
      onLibraryRoute &&
      filter.tag_id === tagId &&
      filter.status == null &&
      !filter.favorite &&
      filter.brand == null &&
      filter.year_decade == null
    );
  }

  function isBrandActive(brand: string): boolean {
    return (
      onLibraryRoute &&
      filter.brand === brand &&
      filter.tag_id == null &&
      filter.status == null &&
      !filter.favorite &&
      filter.year_decade == null
    );
  }

  function isDecadeActive(decade: number): boolean {
    return (
      onLibraryRoute &&
      filter.year_decade === decade &&
      filter.tag_id == null &&
      filter.status == null &&
      !filter.favorite &&
      filter.brand == null
    );
  }

  return (
    <aside
      className="flex h-full shrink-0 flex-col border-r border-line bg-bg-1"
      style={{ width: "var(--sidebar-w, 248px)" }}
    >
      <ScrollArea className="flex-1">
        <div className="flex flex-col py-2">
          <SectionLabel>视图</SectionLabel>
          <SidebarRow
            label="图书馆全景"
            count={totalGames}
            active={isAllActive}
            onClick={resetAll}
          />
          <SidebarRow
            label="收藏夹"
            count={sidebar?.favorite_count ?? 0}
            active={isFavoriteActive}
            onClick={() => applyFilter({ favorite: true })}
          />

          <SectionLabel>通关状态</SectionLabel>
          {STATUS_DISPLAY.map(({ value, label, dotClass }) => {
            const count =
              sidebar?.statuses.find((s) => s.status === value)?.count ?? 0;
            return (
              <SidebarRow
                key={value}
                label={label}
                count={count}
                active={isStatusActive(value)}
                onClick={() => applyFilter({ status: value })}
                statusDotClass={dotClass}
              />
            );
          })}

          <SectionLabel>工具</SectionLabel>
          <SidebarRow
            label="游玩统计"
            active={isStatsActive}
            onClick={() => navigate("/stats")}
          />
          <SidebarRow
            label="截图集"
            active={isScreenshotsActive}
            onClick={() => navigate("/screenshots")}
          />
          <SidebarRow
            label="设置"
            active={isSettingsActive}
            onClick={() => navigate("/settings")}
          />

          {(sidebar?.tags ?? []).length > 0 && (
            <>
              <SectionLabel>自定义标签</SectionLabel>
              {sidebar!.tags.map(({ tag, count }) => (
                <SidebarRow
                  key={`t-${tag.id}`}
                  label={`# ${tag.name}`}
                  count={count}
                  active={isTagActive(tag.id)}
                  onClick={() => applyFilter({ tag_id: tag.id })}
                />
              ))}
            </>
          )}

          {(sidebar?.brands ?? []).length > 0 && (
            <>
              <SectionLabel>品牌 · 厂牌</SectionLabel>
              {sidebar!.brands.map(({ brand, count }) => (
                <SidebarRow
                  key={`b-${brand}`}
                  label={brand}
                  count={count}
                  active={isBrandActive(brand)}
                  onClick={() => applyFilter({ brand })}
                />
              ))}
            </>
          )}

          {(sidebar?.year_decades ?? []).length > 0 && (
            <>
              <SectionLabel>发行年份</SectionLabel>
              {sidebar!.year_decades.map(({ decade, count }) => (
                <SidebarRow
                  key={`y-${decade}`}
                  label={`${decade}s 年代`}
                  count={count}
                  active={isDecadeActive(decade)}
                  onClick={() => applyFilter({ year_decade: decade })}
                />
              ))}
            </>
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}

// ── Internals ────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="px-[18px] pt-[14px] pb-1 font-mono text-[9.5px] uppercase tracking-[0.14em] text-ink-3 select-none"
    >
      {children}
    </div>
  );
}

interface SidebarRowProps {
  label: string;
  count?: number;
  /** Status dot variant (renders 6px colored square left of label). */
  statusDotClass?: string;
  active?: boolean;
  onClick: () => void;
}

function SidebarRow({
  label,
  count,
  statusDotClass,
  active,
  onClick,
}: SidebarRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "mx-2 flex items-center gap-2.5 px-3.5 py-1.5 text-left transition-colors duration-100",
        "text-[12.5px] text-ink-1",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand",
        active
          ? "bg-brand-soft text-ink-0"
          : "hover:bg-bg-2 hover:text-ink-0",
      )}
      style={{ borderRadius: "var(--r-md)" }}
    >
      {statusDotClass && (
        <span
          aria-hidden
          className={cn("h-1.5 w-1.5 flex-shrink-0", statusDotClass)}
          style={{ borderRadius: "var(--r-sm)" }}
        />
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count != null && (
        <span
          className={cn(
            "font-mono text-[10.5px] tabular-nums",
            active ? "text-ink-0" : "text-ink-3",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}
