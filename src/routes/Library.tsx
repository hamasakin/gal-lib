/**
 * Library route ("/") — v1.1 redesign.
 *
 * Layout (top → bottom):
 *   <ScanProgressBar/>          — sticky top, auto-hides on idle/terminal
 *   <PageHeader>                — breadcrumb · serif H1 · sub · actions
 *   <ActiveSessionBar/>         — present iff active session
 *   <Toolbar row>               — StatusFilterChips · FilterChip
 *                                 · spacer · SearchBar · DensityToggle · SortSelect
 *   <GameGrid/> | <empty>       — magazine grid (hero band + stacks)
 *   <MetadataPicker/>           — controlled dialog
 *
 * Functional logic preserved from v1.0:
 *   - Single useEffect subscribed to (searchQuery, sortBy, filter) issues
 *     searchGames; sidebar / chip / chips / search-bar all just mutate the store.
 *   - Empty-state classification: noScanYet / scanFinishedZeroResults / filterFoundNothing.
 *
 * Routing-export note: router.tsx uses `import { Library }` — keep NAMED export.
 */

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useLibraryStore } from "@/store/library";
import {
  getSidebarCategories,
  searchGames,
  type SearchFilter,
} from "@/lib/search";
import type { Game } from "@/lib/games";
import { startScan, listScanRoots } from "@/lib/scan";
import { GameGrid } from "@/components/library/GameGrid";
import { ScanProgressBar } from "@/components/library/ScanProgressBar";
import { ActiveSessionBar } from "@/components/library/ActiveSessionBar";
import { MetadataPicker } from "@/components/library/MetadataPicker";
import { SearchBar } from "@/components/library/SearchBar";
import { SortSelect } from "@/components/library/SortSelect";
import { FilterChip } from "@/components/library/FilterChip";
import { StatusFilterChips } from "@/components/library/StatusFilterChips";
import { DensityToggle } from "@/components/library/DensityToggle";
import { PageHeader } from "@/components/library/PageHeader";
import { RefreshCw, FolderPlus } from "lucide-react";
import { cn } from "@/lib/utils";

function isFilterEmpty(f: SearchFilter): boolean {
  return (
    f.tag_id == null &&
    f.status == null &&
    !f.favorite &&
    f.brand == null &&
    f.year_decade == null
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
  const navigate = useNavigate();

  const refetchGrid = useCallback(async () => {
    const trimmedQuery = searchQuery.trim();
    const queryArg = trimmedQuery === "" ? null : trimmedQuery;
    const filterArg = isFilterEmpty(filter) ? null : filter;
    try {
      const rows = await searchGames(queryArg, sortBy, filterArg);
      setGames(rows);
    } catch (e: unknown) {
      // eslint-disable-next-line no-console
      console.error("[Library] searchGames failed:", e);
    }
  }, [searchQuery, sortBy, filter, setGames]);

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

  useEffect(() => {
    if (scanProgress?.status === "completed") {
      void refetchGrid();
      void refreshSidebar();
    }
  }, [scanProgress?.status, refetchGrid, refreshSidebar]);

  const onChildMutation = useCallback(() => {
    void refetchGrid();
    void refreshSidebar();
  }, [refetchGrid, refreshSidebar]);

  const isEmpty = games.length === 0;
  const hasActiveSearch = searchQuery.trim() !== "";
  const hasActiveFilter = !isFilterEmpty(filter);
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

      <div className="flex-1 overflow-auto">
        <PageHeader
          crumb="图书馆"
          badge={`${games.length} 部作品`}
          title={
            <>
              本月你的<span className="text-brand italic">私人书架</span>
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
          <SearchBar />
          <DensityToggle />
          <SortSelect />
        </div>

        {/* Grid + empty states */}
        {noScanYet && (
          <EmptyPanel
            title="还没有游戏"
            sub="请到设置页添加扫描根目录"
            actionLabel="打开设置"
            onAction={() => navigate("/settings")}
          />
        )}

        {scanFinishedZeroResults && (
          <EmptyPanel
            title="未识别到游戏"
            sub="请检查根目录扫描深度配置"
            actionLabel="回到设置"
            onAction={() => navigate("/settings")}
          />
        )}

        {filterFoundNothing && (
          <EmptyPanel
            title="无匹配结果"
            sub="尝试调整搜索或清除筛选条件"
            actionLabel="清除筛选"
            onAction={clearAllFilters}
          />
        )}

        {!isEmpty && (
          <GameGrid
            games={games}
            onPickMetadata={setPickerGame}
            onChildMutation={onChildMutation}
          />
        )}
      </div>

      <MetadataPicker game={pickerGame} onClose={() => setPickerGame(null)} />
    </div>
  );
}

interface EmptyPanelProps {
  title: string;
  sub: string;
  actionLabel: string;
  onAction: () => void;
}

function EmptyPanel({ title, sub, actionLabel, onAction }: EmptyPanelProps) {
  return (
    <div className="flex w-full items-center justify-center px-8 py-24">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <h2 className="font-serif text-[28px] font-medium text-ink-0">{title}</h2>
        <p className="font-mono text-[12px] text-ink-2">{sub}</p>
        <button
          type="button"
          onClick={onAction}
          className="inline-flex h-8 items-center border border-line bg-bg-1 px-4 text-[12.5px] text-ink-1 transition-colors hover:border-line-strong hover:bg-bg-2 hover:text-ink-0"
          style={{ borderRadius: "var(--r-md)" }}
        >
          {actionLabel}
        </button>
      </div>
    </div>
  );
}
