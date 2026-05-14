/**
 * GameGrid — uniform density-controlled library grid using @tanstack/react-virtual
 * row-mode virtualization with manual lane indexing.
 *
 * Single density grid driven by `--card-w` (which the Tweaks panel /
 * DensityToggle sets via `[data-density]`). 3:4 cover container matches
 * typical portrait covers; `object-cover` causes minimal cropping.
 *
 * 20260509g — Re-introduced react-virtual after the v1.0 removal:
 *   - Scroll container is owned by Library.tsx (passed in via
 *     `scrollContainerRef`); GameGrid no longer wraps itself in
 *     `overflow-auto`. Single scrollable region (header + toolbar fixed,
 *     grid scrolls beneath).
 *   - Row-mode virtualization with `count = ceil(games.length / columnCount)`.
 *     `columnCount` is derived from a ResizeObserver on the inner container,
 *     reading `--card-w` from getComputedStyle so DensityToggle changes
 *     trigger reflow naturally.
 *   - Fixed `estimateSize = cardWidth * 4/3 + 56 (meta height) + 28 (row gap)`
 *     so virtualizer doesn't need to measure each row.
 *   - `overscan: 5` rows — default 1 leaves visible blank during fast scroll.
 *
 * The earlier magazine layout (hero band) was dropped earlier because it
 * ignored density and cropped portrait covers. Density-uniform grid is
 * preserved here.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { useVirtualizer } from "@tanstack/react-virtual";
import { GameCard } from "./GameCard";
import { refreshMetadata } from "@/lib/metadata";
import { listGames, type Game } from "@/lib/games";
import { useLibraryStore } from "@/store/library";
import { usePreferencesStore } from "@/store/preferences";
import { searchGames } from "@/lib/search";

interface GameGridProps {
  games: Game[];
  onPickMetadata: (game: Game) => void;
  onChildMutation?: () => void;
  /**
   * Scroll container owned by Library.tsx — useVirtualizer's `getScrollElement`
   * target. Required: GameGrid no longer wraps itself in overflow-auto.
   */
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  // Quick 20260510b — batch selection mode passthrough.
  selectMode?: boolean;
  selectedIds?: Set<number>;
  onToggleSelect?: (id: number) => void;
}

// Layout constants — must stay in sync with the inline style on the row div
// below. Any changes also touch the row-height estimate further down.
const COLUMN_GAP = 22;
const ROW_GAP = 28;
const META_HEIGHT = 56; // GameCard meta block (title + sub line) + bottom gap

export function GameGrid({
  games,
  onPickMetadata,
  onChildMutation,
  scrollContainerRef,
  selectMode = false,
  selectedIds,
  onToggleSelect,
}: GameGridProps) {
  const setGames = useLibraryStore((s) => s.setGames);

  // Resolve dataDir once for cover-URL composition.
  const [dataDir, setDataDir] = useState<string | null>(null);
  useEffect(() => {
    invoke<string>("get_data_dir")
      .then(setDataDir)
      .catch((e: unknown) => {
        // eslint-disable-next-line no-console
        console.error("[GameGrid] get_data_dir failed:", e);
      });
  }, []);

  const resolveCover = useMemo(() => {
    return (game: Game): string | null => {
      if (game.cover_path && dataDir) {
        const abs = `${dataDir.replace(/\\/g, "/")}/${game.cover_path}`;
        return (
          convertFileSrc(abs) +
          `?v=${encodeURIComponent(game.last_scanned_at ?? "")}`
        );
      }
      return game.cover_url ?? null;
    };
  }, [dataDir]);

  // ── ResizeObserver-driven columnCount + cardWidth ────────────────────────
  // Measure the inner padded container (`px-8` = 32px each side), read
  // `--card-w` from CSS (set by [data-density] on a parent), derive columns:
  //   cols = floor((innerWidth + COLUMN_GAP) / (cardWidth + COLUMN_GAP))
  // — this is the auto-fill equivalent for `repeat(auto-fill, minmax(W, 1fr))`.
  const innerRef = useRef<HTMLDivElement>(null);
  const [columnCount, setColumnCount] = useState(1);
  // Quick 260515-overlap — the target width from --card-w (used to derive
  // column count) and the actual rendered column width post-`minmax(0, 1fr)`
  // stretch can differ by tens of pixels. We persist actualCardWidth and
  // feed it into rowStride; otherwise virtualizer underestimates row height
  // (most visible at the "大" density: rendered cover ~350px tall, but
  // rowStride only reserved ~320px → next row overlaps).
  const [actualCardWidth, setActualCardWidth] = useState(172);
  // Density preference subscription — changing density only mutates the
  // `--card-w` CSS variable, which doesn't trigger ResizeObserver
  // (clientWidth unchanged). Re-running the effect on density flips
  // re-reads the var so column count updates immediately.
  const density = usePreferencesStore((s) => s.density);

  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;

    const measure = () => {
      const cssCardW = parseFloat(
        getComputedStyle(el).getPropertyValue("--card-w").trim(),
      );
      const w = Number.isFinite(cssCardW) && cssCardW > 0 ? cssCardW : 172;

      // px-8 → 32px left + 32px right = 64 total.
      const inner = el.clientWidth - 64;
      const cols = Math.max(
        1,
        Math.floor((inner + COLUMN_GAP) / (w + COLUMN_GAP)),
      );
      setColumnCount(cols);

      // Quick 260515-overlap — actual rendered column width after
      // `minmax(0, 1fr)` stretch. Floor by 0.5px to stay conservative —
      // browsers occasionally round up sub-pixel grid cells, and an
      // under-estimated rowStride is what produces the overlap; an
      // over-estimate just adds a tiny harmless gap.
      const actual = Math.max(
        w,
        (inner - COLUMN_GAP * (cols - 1)) / cols,
      );
      setActualCardWidth(actual);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [density]);

  // Estimated row height — cover (3:4) + meta + row gap.
  // Used both for virtualizer estimateSize and for the absolute-positioned
  // row layout below. Use actualCardWidth (post-stretch) so the cover
  // reservation matches what's actually painted; using the target width
  // here is what caused the row-overlap bug at high density.
  const coverHeight = Math.ceil(actualCardWidth * (4 / 3));
  const rowHeight = coverHeight + META_HEIGHT;
  const rowStride = rowHeight + ROW_GAP;
  const rowCount = Math.ceil(games.length / columnCount);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => rowStride,
    overscan: 5,
  });

  // Re-measure on density changes — useVirtualizer needs to know rowStride
  // changed so it re-positions virtual rows. Calling measure() (provided by
  // react-virtual) invalidates its internal size cache.
  useEffect(() => {
    virtualizer.measure();
  }, [rowStride, columnCount, virtualizer]);

  // ── existing mutation callbacks (unchanged) ──────────────────────────────
  const onRefreshCover = useCallback(
    async (game: Game) => {
      try {
        await refreshMetadata(game.id);
        if (onChildMutation) {
          onChildMutation();
        } else {
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

  // ── render ───────────────────────────────────────────────────────────────
  // Inner padded container is the ResizeObserver target AND the virtualizer
  // viewport-relative container. Total height = sum of row strides; rows
  // are absolutely positioned by translateY at row.start (provided by the
  // virtualizer in pixel coordinates relative to the inner container's
  // start, not the scroll container — react-virtual handles that mapping).
  const virtualRows = virtualizer.getVirtualItems();
  const totalHeight = virtualizer.getTotalSize();

  return (
    <div ref={innerRef} className="px-8 pb-20 pt-7">
      <div
        style={{
          height: `${totalHeight}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {virtualRows.map((row) => {
          const start = row.index * columnCount;
          const end = Math.min(start + columnCount, games.length);
          const rowGames = games.slice(start, end);
          return (
            <div
              key={row.key}
              data-row-index={row.index}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${row.start}px)`,
                display: "grid",
                gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
                columnGap: `${COLUMN_GAP}px`,
                rowGap: `${ROW_GAP}px`,
                alignItems: "start",
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
                  selectMode={selectMode}
                  selected={selectedIds?.has(g.id) ?? false}
                  onToggleSelect={onToggleSelect}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
