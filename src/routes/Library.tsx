/**
 * Library route ("/") — v1.1 redesign.
 *
 * Layout (top → bottom):
 *   <ScanProgressBar/>          — sticky top, auto-hides on idle/terminal
 *   <PageHeader>                — breadcrumb · serif H1 · sub · actions
 *   <ActiveSessionBar/>         — present iff active session
 *   <Toolbar row>               — StatusFilterChips · FilterChip
 *                                 · spacer · SearchBar · DensityToggle · SortSelect
 *   <GameGrid/> | <empty>       — uniform density grid (--card-w driven)
 *   <MetadataPicker/>           — controlled dialog
 *
 * Functional logic preserved from v1.0:
 *   - Single useEffect subscribed to (searchQuery, sortBy, filter) issues
 *     searchGames; sidebar / chip / chips / search-bar all just mutate the store.
 *   - Empty-state classification: noScanYet / scanFinishedZeroResults / filterFoundNothing.
 *
 * Routing-export note: router.tsx uses `import { Library }` — keep NAMED export.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { toastScanFinished } from "@/lib/toast";
import { useLibraryStore } from "@/store/library";
import {
  getSidebarCategories,
  searchGames,
  type SearchFilter,
} from "@/lib/search";
import type { Game } from "@/lib/games";
import { startScan, listScanRoots } from "@/lib/scan";
import { GameGrid } from "@/components/library/GameGrid";
import { GameList } from "@/components/library/GameList";
import { ViewToggle } from "@/components/library/ViewToggle";
import { FilterPanel } from "@/components/library/FilterPanel";
import { ScanProgressBar } from "@/components/library/ScanProgressBar";
import { ActiveSessionBar } from "@/components/library/ActiveSessionBar";
import { MetadataPicker } from "@/components/library/MetadataPicker";
import { SearchBar } from "@/components/library/SearchBar";
import { SortSelect } from "@/components/library/SortSelect";
import { FilterChip } from "@/components/library/FilterChip";
import { StatusFilterChips } from "@/components/library/StatusFilterChips";
import { DensityToggle } from "@/components/library/DensityToggle";
import { PageHeader } from "@/components/library/PageHeader";
import { usePreferencesStore } from "@/store/preferences";
import {
  type AdvancedFilter,
  applyAdvancedFilter,
  EMPTY_ADV_FILTER,
  isAdvFilterActive,
} from "@/lib/advancedFilter";
import { getFilterOptions, type FilterOptions } from "@/lib/persons";
import { RefreshCw, FolderPlus, Library as LibraryIcon, SearchX, AlertCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSmoothWheel } from "@/hooks/useSmoothWheel";

function isFilterEmpty(f: SearchFilter): boolean {
  return (
    f.tag_id == null &&
    f.status == null &&
    !f.favorite &&
    f.brand == null &&
    f.year_decade == null &&
    (f.brands == null || f.brands.length === 0) &&
    (f.staff_ids == null || f.staff_ids.length === 0) &&
    (f.official_tags == null || f.official_tags.length === 0)
  );
}

const TOOLBAR_BTN =
  "inline-flex h-8 items-center gap-2 border border-line bg-bg-1 px-3.5 text-[12.5px] text-ink-1 transition-colors hover:border-line-strong hover:bg-bg-2 hover:text-ink-0";

export function Library() {
  const games = useLibraryStore((s) => s.games);
  const setGames = useLibraryStore((s) => s.setGames);
  const setSidebar = useLibraryStore((s) => s.setSidebar);
  const scanProgress = useLibraryStore((s) => s.scanProgress);
  const searchQuery = useLibraryStore((s) => s.searchQuery);
  const sortBy = useLibraryStore((s) => s.sortBy);
  const filter = useLibraryStore((s) => s.filter);
  const setFilter = useLibraryStore((s) => s.setFilter);
  const setSearchQuery = useLibraryStore((s) => s.setSearchQuery);

  const [pickerGame, setPickerGame] = useState<Game | null>(null);
  const [advFilter, setAdvFilter] = useState<AdvancedFilter>(EMPTY_ADV_FILTER);
  const [filterOptions, setFilterOptions] = useState<FilterOptions | null>(null);
  const navigate = useNavigate();
  const viewMode = usePreferencesStore((s) => s.viewMode);

  // 20260509g — 滚动容器 ref，下放到 GameGrid 给 useVirtualizer 的
  // getScrollElement 用。Library 持有这个 ref 是因为 scroll 区是 toolbar
  // 之外的 flex-1 那一层（见 line ~258），它不在 GameGrid 内部。
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Wheel inertia — Windows wheel ticks are discrete (~100px each); lerp the
  // target scrollTop frame-by-frame for smooth motion. react-virtual stays
  // compatible because we still write to native scrollTop.
  useSmoothWheel(scrollContainerRef);

  const refetchGrid = useCallback(async () => {
    const trimmedQuery = searchQuery.trim();
    const queryArg = trimmedQuery === "" ? null : trimmedQuery;
    // Multi-dim facets that MUST go server-side: staff & official tags don't
    // ride on the Game row (no client-side fan-out is feasible). Brand can
    // be filtered either side; we send it to the server too so the row
    // count badge in PageHeader reflects the same intent (note: the legacy
    // sidebar `filter.brand` single-axis still works independently and is
    // ANDed with `brands` server-side).
    const merged: SearchFilter = {
      ...filter,
      brands: advFilter.brands.size > 0 ? Array.from(advFilter.brands) : undefined,
      staff_ids:
        advFilter.staffIds.size > 0 ? Array.from(advFilter.staffIds) : undefined,
      official_tags:
        advFilter.officialTags.size > 0
          ? Array.from(advFilter.officialTags)
          : undefined,
    };
    const filterArg = isFilterEmpty(merged) ? null : merged;
    try {
      const rows = await searchGames(queryArg, sortBy, filterArg);
      setGames(rows);
    } catch (e: unknown) {
      // eslint-disable-next-line no-console
      console.error("[Library] searchGames failed:", e);
    }
  }, [searchQuery, sortBy, filter, advFilter, setGames]);

  // Phase 11 multi-dim facet payload — fetch once on mount, then re-fetch
  // after each scan completes (the option set may shift if new brands /
  // persons / tags landed). The payload is small (a few KB even for
  // hundreds of games), so over-fetching is cheap; under-fetching produces
  // confusing UX (stale chips that filter out everything).
  const refreshFilterOptions = useCallback(async () => {
    try {
      const opts = await getFilterOptions();
      setFilterOptions(opts);
    } catch (e: unknown) {
      // eslint-disable-next-line no-console
      console.error("[Library] getFilterOptions failed:", e);
    }
  }, []);

  const refreshSidebar = useCallback(async () => {
    try {
      const cats = await getSidebarCategories();
      setSidebar(cats);
    } catch (e: unknown) {
      // eslint-disable-next-line no-console
      console.error("[Library] getSidebarCategories failed:", e);
    }
  }, [setSidebar]);

  useEffect(() => {
    void refetchGrid();
  }, [refetchGrid]);

  // Bootstrap fetch of multi-dim facet options on mount.
  useEffect(() => {
    void refreshFilterOptions();
  }, [refreshFilterOptions]);

  // Detect the running → completed edge once and fire the rich scan-finished
  // toast post-refresh. The ref guard prevents double-fires when refetchGrid
  // identity changes (deps below) while scanProgress is still in 'completed'.
  const prevScanStatus = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevScanStatus.current;
    const next = scanProgress?.status ?? null;
    prevScanStatus.current = next;
    if (prev !== "completed" && next === "completed") {
      const total = scanProgress?.total ?? 0;
      void (async () => {
        await refetchGrid();
        await refreshSidebar();
        await refreshFilterOptions();
        // Post-refresh read — refetchGrid setGames-through means the store
        // snapshot now carries the freshly inserted/updated rows.
        const latest = useLibraryStore.getState().games;
        const pending = latest.filter(
          (g) => g.match_confidence != null && g.match_confidence < 80,
        ).length;
        toastScanFinished(total, total - pending, pending);
      })();
    }
  }, [
    scanProgress?.status,
    scanProgress?.total,
    refetchGrid,
    refreshSidebar,
    refreshFilterOptions,
  ]);

  const onChildMutation = useCallback(() => {
    void refetchGrid();
    void refreshSidebar();
  }, [refetchGrid, refreshSidebar]);

  // Server-fetched array (already narrowed by backend SearchFilter +
  // sort + searchQuery). The advanced FilterPanel runs as a client-side
  // post-filter on top of this — keeps all complex multi-axis logic out
  // of the SQL builder.
  const visibleGames = applyAdvancedFilter(games, advFilter);
  const isEmpty = visibleGames.length === 0;
  const hasActiveSearch = searchQuery.trim() !== "";
  const hasActiveFilter = !isFilterEmpty(filter) || isAdvFilterActive(advFilter);
  const scanCompleted = scanProgress?.status === "completed";
  const noScanYet =
    isEmpty && !scanProgress && !hasActiveSearch && !hasActiveFilter;
  const scanFinishedZeroResults =
    isEmpty && scanCompleted && !hasActiveSearch && !hasActiveFilter;
  const filterFoundNothing = isEmpty && (hasActiveSearch || hasActiveFilter);
  const scanRunning = scanProgress?.status === "running";

  function clearAllFilters() {
    setFilter({});
    setSearchQuery("");
    setAdvFilter(EMPTY_ADV_FILTER);
  }

  async function onRescan() {
    if (scanRunning) return;
    try {
      const roots = await listScanRoots();
      if (roots.length === 0) {
        toast.error("还没有扫描根目录 — 请先到设置页添加");
        navigate("/settings");
        return;
      }
      await startScan("incremental");
      toast.info("已开始扫描");
    } catch (e: unknown) {
      toast.error(`扫描失败 — ${String(e)}`);
    }
  }

  // Page-header sub line — derive from latest game's last_scanned_at when
  // available; otherwise show a neutral message.
  const latestScan = games.reduce<string | null>((acc, g) => {
    if (!g.last_scanned_at) return acc;
    if (!acc || g.last_scanned_at > acc) return g.last_scanned_at;
    return acc;
  }, null);
  const subLine = latestScan
    ? `最近一次扫描 · ${new Date(latestScan).toLocaleString("zh-CN")} · ${games.length} 部作品`
    : games.length > 0
      ? `共 ${games.length} 部作品`
      : "尚未扫描";

  return (
    <div className="flex h-full w-full flex-col">
      <ScanProgressBar />

      <div className="flex min-h-0 flex-1 flex-col">
        <PageHeader
          crumb="图书馆"
          badge={
            isAdvFilterActive(advFilter)
              ? `${visibleGames.length} / ${games.length} 部`
              : `${games.length} 部作品`
          }
          title={
            <>
              本月你的<span className="text-brand italic">箱庭</span>
            </>
          }
          sub={subLine}
          actions={
            <>
              <button
                type="button"
                onClick={() => void onRescan()}
                disabled={scanRunning}
                className={cn(
                  TOOLBAR_BTN,
                  scanRunning && "cursor-not-allowed opacity-60",
                )}
                style={{ borderRadius: "var(--r-md)" }}
              >
                <RefreshCw size={14} strokeWidth={1.7} />
                <span>重新扫描</span>
              </button>
              <button
                type="button"
                onClick={() => navigate("/settings")}
                className={TOOLBAR_BTN}
                style={{ borderRadius: "var(--r-md)" }}
              >
                <FolderPlus size={14} strokeWidth={1.7} />
                <span>添加根目录</span>
              </button>
            </>
          }
        />

        <ActiveSessionBar />

        {/* Toolbar row — chips · filters | searchbar · density · sort */}
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-8 py-3.5">
          <StatusFilterChips />
          <FilterChip />
          <span className="flex-1" />
          <FilterPanel
            games={games}
            filter={advFilter}
            onChange={setAdvFilter}
            options={filterOptions}
          />
          <SearchBar />
          <ViewToggle />
          {viewMode === "grid" && <DensityToggle />}
          <SortSelect />
        </div>

        {/* Grid + empty states — only this region scrolls; header/toolbar stay fixed above */}
        <div
          ref={scrollContainerRef}
          className="flex min-h-0 flex-1 flex-col overflow-auto"
        >
        {noScanYet && (
          <EmptyPanel
            icon={LibraryIcon}
            title="你的箱庭还是空的"
            sub="添加一个根目录，让箱庭把那一堆乱糟糟的文件夹整理成你的私人书架。"
            actionLabel="+ 添加根目录"
            onAction={() => navigate("/settings")}
            hint="也可以稍后从设置页随时新增"
          />
        )}

        {scanFinishedZeroResults && (
          <EmptyPanel
            icon={AlertCircle}
            accent="#ffd166"
            title="扫描完成 · 未识别到游戏"
            sub="该根目录下没有符合深度规则的子文件夹。可能扫描深度不对，或目录里其实没有游戏。"
            actionLabel="回到设置调整"
            onAction={() => navigate("/settings")}
            hint="多数情况是把深度从「扁平」改成「按品牌分层」就能找到"
          />
        )}

        {filterFoundNothing && (
          <EmptyPanel
            icon={SearchX}
            title="没有匹配的游戏"
            sub="当前筛选条件一个都没匹配上。要不试试放宽条件，或者直接清除全部筛选。"
            actionLabel="清除筛选"
            onAction={clearAllFilters}
            hint={`已扫描 ${searchQuery ? "搜索词" : "筛选条件"}：尝试调整后重试`}
          />
        )}

        {!isEmpty && viewMode === "grid" && (
          <GameGrid
            games={visibleGames}
            onPickMetadata={setPickerGame}
            onChildMutation={onChildMutation}
            scrollContainerRef={scrollContainerRef}
          />
        )}
        {!isEmpty && viewMode === "list" && <GameList games={visibleGames} />}
        </div>
      </div>

      <MetadataPicker game={pickerGame} onClose={() => setPickerGame(null)} />
    </div>
  );
}

interface EmptyPanelProps {
  icon: LucideIcon;
  title: string;
  sub: string;
  actionLabel: string;
  onAction: () => void;
  /** Mono-style hint shown at the bottom of the card. */
  hint?: string;
  /**
   * Optional accent color for warning/error variants. When omitted the panel
   * uses the brand accent (`var(--accent)`).
   */
  accent?: string;
}

/**
 * State card styled per supplementary §8 (StatesWall): 64px glyph badge with
 * accent ring + tinted bg, serif title, sans sub copy, primary CTA, mono hint
 * footer. Three rendered variants in this route — empty library, scan
 * finished zero-results, and filter found nothing.
 */
function EmptyPanel({
  icon: Icon,
  title,
  sub,
  actionLabel,
  onAction,
  hint,
  accent,
}: EmptyPanelProps) {
  const glyphColor = accent ?? "var(--accent)";
  const glyphBg = accent ? `${accent}20` : "var(--accent-soft)";

  return (
    <div className="flex w-full justify-center px-8 py-16">
      <div
        className="flex w-full max-w-[420px] flex-col items-center border border-line bg-bg-1 px-8 py-10 text-center"
        style={{ borderRadius: "var(--r-lg)" }}
      >
        <div
          className="mb-5 grid h-16 w-16 place-items-center"
          style={{
            background: glyphBg,
            border: `1px solid ${glyphColor}`,
            borderRadius: "var(--r-md)",
            color: glyphColor,
          }}
          aria-hidden
        >
          <Icon size={28} strokeWidth={1.6} />
        </div>
        <h2 className="font-serif text-[17px] font-medium text-ink-0">{title}</h2>
        <p className="mt-2.5 max-w-[280px] text-[12.5px] leading-[1.7] text-ink-2">
          {sub}
        </p>
        <button
          type="button"
          onClick={onAction}
          className="mt-5 inline-flex h-9 items-center border bg-brand px-5 font-medium text-[12.5px] text-[var(--accent-on)] transition-colors hover:bg-brand-deep hover:text-white"
          style={{ borderRadius: "var(--r-md)", borderColor: "var(--accent)" }}
        >
          {actionLabel}
        </button>
        {hint && (
          <p className="mt-4 font-mono text-[10.5px] tracking-[0.04em] text-ink-3">
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}
