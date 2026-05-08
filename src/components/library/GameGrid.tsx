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
import { searchGames } from "@/lib/search";

const CARD_MIN_WIDTH = 200; // px — UI-SPEC §Cover Grid minmax(200px,1fr)
const GAP = 16; // px — Tailwind gap-4
const ROW_HEIGHT = 340; // px — 200×4/3 cover + ~52 title row + 16 gap below = 343
const PADDING = 24; // px — Tailwind p-6

interface GameGridProps {
  games: Game[];
  onPickMetadata: (game: Game) => void;
  /**
   * Phase 4 / 04d: a child mutation (favorite toggle / status change) just
   * landed — refresh the grid + sidebar. Owner (Library route) decides how
   * to refresh (searchGames vs listGames depending on whether search/sort/
   * filter is active). Optional — falls back to a local listGames() refetch
   * when not provided (preserves backwards compat with any callers from
   * earlier phases).
   */
  onChildMutation?: () => void;
}

export function GameGrid({
  games,
  onPickMetadata,
  onChildMutation,
}: GameGridProps) {
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
  // Prefer the locally-cached file (cover_path) — fast, offline, no CSP
  // worries. Fall back to the remote cover_url when the local cache is
  // missing (e.g. ingest's network fetch was rate-limited or the
  // bind_metadata cover-cache step failed silently). The remote URL is
  // safe to render in the Tauri webview because tauri.conf.json's default
  // img-src CSP includes `https:`.
  const resolveCover = useMemo(() => {
    return (game: Game): string | null => {
      if (game.cover_path && dataDir) {
        const abs = `${dataDir.replace(/\\/g, "/")}/${game.cover_path}`;
        return convertFileSrc(abs);
      }
      return game.cover_url ?? null;
    };
  }, [dataDir]);

  // ── Refresh-cover handler (delegates to refresh_metadata then refetches list) ──
  // 04d: prefer the parent's onChildMutation (it knows the active
  // search/sort/filter triple). Fall back to searchGames with the current
  // store state — this preserves the user's filter view across cover
  // refreshes (pre-04d listGames() would have replaced the grid with the
  // unfiltered set).
  const onRefreshCover = useCallback(
    async (game: Game) => {
      try {
        await refreshMetadata(game.id);
        if (onChildMutation) {
          onChildMutation();
        } else {
          // No parent hook (legacy callers): re-issue searchGames using the
          // current store snapshot. Reading the store imperatively avoids
          // the useCallback dep churn that would otherwise re-recreate
          // this callback on every keystroke.
          const st = useLibraryStore.getState();
          const trimmed = st.searchQuery.trim();
          const queryArg = trimmed === "" ? null : trimmed;
          const filterArg =
            st.filter.tag_id == null &&
            st.filter.status == null &&
            !st.filter.favorite &&
            st.filter.brand == null &&
            st.filter.year_decade == null
              ? null
              : st.filter;
          try {
            const fresh = await searchGames(queryArg, st.sortBy, filterArg);
            setGames(fresh);
          } catch {
            // Last-resort fallback so the grid doesn't get stuck on stale data.
            const fresh = await listGames();
            setGames(fresh);
          }
        }
        toast.success("已刷新封面");
      } catch (e: unknown) {
        toast.error(`刷新封面失败 — ${String(e)}`);
      }
    },
    [setGames, onChildMutation],
  );

  // ── Child-mutation handler (favorite / status). Defer to the parent
  //    (Library route) when it provided onChildMutation — that's the only
  //    place that knows the current search/sort/filter triple. When the
  //    parent doesn't wire it, fall back to a plain listGames() refetch so
  //    any earlier (P2/P3) caller still works.
  const onChildMutated = useCallback(async () => {
    if (onChildMutation) {
      onChildMutation();
      return;
    }
    try {
      const fresh = await listGames();
      setGames(fresh);
    } catch (e: unknown) {
      // eslint-disable-next-line no-console
      console.error("[GameGrid] post-mutation refetch failed:", e);
    }
  }, [onChildMutation, setGames]);

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
                    onMutated={onChildMutated}
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
