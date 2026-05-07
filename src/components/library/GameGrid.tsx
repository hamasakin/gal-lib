/**
 * GameGrid — virtualized 2D grid of GameCard tiles.
 *
 * 02-UI-SPEC §Cover Grid contract:
 *   - Layout: responsive `repeat(auto-fill, minmax(200px, 1fr))` columns
 *     (we approximate via measured columnCount; minmax CSS works visually
 *     but virtualization needs explicit lane count)
 *   - p-6 (24px) outer padding
 *   - @tanstack/react-virtual `useVirtualizer` 2D mode (count = totalRows,
 *     lanes = columnCount); recompute on container resize
 *   - 16px gap (gap-4) between cards
 *   - Over-render buffer ~30 cards (overscan 6 rows × 5 cols ≈ 30)
 *
 * Cover URL resolution:
 *   - Once per render, resolve dataDir via `get_data_dir` Tauri command
 *     (cached in a useRef to avoid re-fetching). Combined with each game's
 *     `cover_path` (relative, e.g. "covers/42.jpg") via convertFileSrc to
 *     produce a webview-safe `src` URL.
 *   - convertFileSrc handles tauri:// / asset:// / http://localhost:port
 *     transport per platform / dev-vs-prod automatically.
 *
 * Refetch trigger:
 *   - After user-initiated metadata refresh (rebind/cover-only), parent
 *     calls `listGames()` then setGames; GameGrid re-renders with the new
 *     row data. No internal cache here.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { GameCard } from "./GameCard";
import { refreshMetadata } from "@/lib/metadata";
import { listGames, type Game } from "@/lib/games";
import { useLibraryStore } from "@/store/library";

const CARD_MIN_WIDTH = 200; // px — UI-SPEC §Cover Grid minmax(200px,1fr)
const GAP = 16; // px — Tailwind gap-4
const ROW_HEIGHT = 340; // px — 200×4/3 cover + ~52 title row + 16 gap below = 343
const PADDING = 24; // px — Tailwind p-6

interface GameGridProps {
  games: Game[];
  onPickMetadata: (game: Game) => void;
}

export function GameGrid({ games, onPickMetadata }: GameGridProps) {
  const setGames = useLibraryStore((s) => s.setGames);

  // ── Resolve data_dir once for cover-URL composition ────────────────────
  const [dataDir, setDataDir] = useState<string | null>(null);
  useEffect(() => {
    invoke<string>("get_data_dir")
      .then(setDataDir)
      .catch((e: unknown) => {
        // eslint-disable-next-line no-console
        console.error("[GameGrid] get_data_dir failed:", e);
      });
  }, []);

  // ── Measure container to derive columnCount on resize ──────────────────
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [columnCount, setColumnCount] = useState(1);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    function recompute() {
      if (!el) return;
      const w = el.clientWidth - PADDING * 2;
      // floor((w + gap) / (cardMin + gap)) — derive how many minmax lanes fit.
      const cols = Math.max(1, Math.floor((w + GAP) / (CARD_MIN_WIDTH + GAP)));
      setColumnCount(cols);
    }
    recompute();

    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Virtualization (rows only; lanes = columnCount handled by manual indexing) ──
  const rowCount = Math.ceil(games.length / Math.max(1, columnCount));
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 6,
  });

  // ── Memoized cover-URL resolver (one closure per dataDir) ──────────────
  const resolveCover = useMemo(() => {
    if (!dataDir) return () => null;
    return (game: Game): string | null => {
      if (!game.cover_path) return null;
      // Use forward-slashes; convertFileSrc handles platform mapping. The
      // backend stores paths like "covers/42.jpg"; combine with the absolute
      // dataDir then run convertFileSrc.
      const abs = `${dataDir.replace(/\\/g, "/")}/${game.cover_path}`;
      return convertFileSrc(abs);
    };
  }, [dataDir]);

  // ── Refresh-cover handler (delegates to refresh_metadata then refetches list) ──
  const onRefreshCover = useCallback(
    async (game: Game) => {
      try {
        await refreshMetadata(game.id);
        const fresh = await listGames();
        setGames(fresh);
        toast.success("已刷新封面");
      } catch (e: unknown) {
        toast.error(`刷新封面失败 — ${String(e)}`);
      }
    },
    [setGames],
  );

  // ── Render ────────────────────────────────────────────────────────────
  const totalHeight = rowVirtualizer.getTotalSize();
  const virtualRows = rowVirtualizer.getVirtualItems();
  const colTemplate = `repeat(${columnCount}, minmax(0, 1fr))`;

  return (
    <div ref={scrollRef} className="h-full w-full overflow-auto">
      <div className="p-6">
        <div
          style={{ height: totalHeight, position: "relative", width: "100%" }}
        >
          {virtualRows.map((vrow) => {
            const startIdx = vrow.index * columnCount;
            const rowGames = games.slice(startIdx, startIdx + columnCount);
            return (
              <div
                key={vrow.key}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${vrow.start}px)`,
                  display: "grid",
                  gridTemplateColumns: colTemplate,
                  gap: `${GAP}px`,
                  // Reserve the row height so cards don't overflow the row band.
                  height: ROW_HEIGHT,
                  paddingBottom: GAP,
                }}
              >
                {rowGames.map((g) => (
                  <GameCard
                    key={g.id}
                    game={g}
                    coverDataUrl={resolveCover(g)}
                    onPickMetadata={onPickMetadata}
                    onRefreshCover={onRefreshCover}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
