/**
 * GameGrid — uniform density-controlled library grid.
 *
 * Single density grid driven by `--card-w` (which the Tweaks panel /
 * DensityToggle sets via `[data-density]`), so card size + column count
 * scale with user preference. 3:4 container matches typical portrait
 * covers; `object-cover` causes minimal cropping.
 *
 * The earlier magazine layout (hero band `1.6fr 1fr 1fr 1fr` + stack)
 * was dropped because (a) the hero band ignored density, and (b) when
 * the band was wider than tall, portrait covers got dramatically
 * cropped by `object-cover`. Recently-played emphasis is preserved by
 * GameCard's status stamp.
 *
 * Drops the v1.0 react-virtual virtualization. Galgame collections are
 * typically 50-300 games; modern browsers render that as plain DOM at 60fps.
 * Re-add virtualization if the library hits 1000+ games and scrolling stutters.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { GameCard } from "./GameCard";
import { refreshMetadata } from "@/lib/metadata";
import { listGames, type Game } from "@/lib/games";
import { useLibraryStore } from "@/store/library";
import { searchGames } from "@/lib/search";

interface GameGridProps {
  games: Game[];
  onPickMetadata: (game: Game) => void;
  onChildMutation?: () => void;
}

export function GameGrid({
  games,
  onPickMetadata,
  onChildMutation,
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
        return convertFileSrc(abs);
      }
      return game.cover_url ?? null;
    };
  }, [dataDir]);

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

  return (
    <div className="h-full w-full overflow-auto">
      <div className="px-8 pb-20 pt-7">
        <div
          className="grid items-start"
          style={{
            gridTemplateColumns:
              "repeat(auto-fill, minmax(var(--card-w, 172px), 1fr))",
            gap: "28px 22px",
          }}
        >
          {games.map((g) => (
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
      </div>
    </div>
  );
}
