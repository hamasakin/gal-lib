/**
 * GameGrid — magazine-asymmetric library grid.
 *
 * v1.1 redesign:
 *   - Top row (only when there ARE recent games): hero band
 *     `1.6fr 1fr 1fr 1fr` — first card is a large HeroCard with cover
 *     background, the next 3 are regular GameCards.
 *   - section-rule: serif "藏书 · Stacks" + count + ruled line
 *   - Rest: equal-density grid driven by `--card-w` (which the Tweaks panel
 *     sets via `[data-density]`), so card size scales with user preference.
 *
 * Drops the v1.0 react-virtual virtualization. Galgame collections are
 * typically 50-300 games; modern browsers render that as plain DOM at 60fps.
 * Re-add virtualization if the library hits 1000+ games and scrolling stutters.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { GameCard } from "./GameCard";
import { HeroCard } from "./HeroCard";
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

  // Magazine split — first 4 with last_played form the hero band.
  // Bare libraries (zero recent games) skip the hero band entirely.
  const recent = useMemo(() => {
    return games.filter((g) => g.last_played_at != null).slice(0, 4);
  }, [games]);

  const heroGame = recent[0] ?? null;
  const sideGames = recent.slice(1, 4);
  const heroIds = new Set(recent.map((g) => g.id));
  const stack = useMemo(
    () => games.filter((g) => !heroIds.has(g.id)),
    [games, heroIds],
  );

  return (
    <div className="h-full w-full overflow-auto">
      <div
        className="px-8 pb-20 pt-7"
        style={{ display: "flex", flexDirection: "column", gap: 28 }}
      >
        {heroGame && (
          <div
            className="grid gap-[22px]"
            style={{
              gridTemplateColumns:
                sideGames.length >= 3
                  ? "1.6fr 1fr 1fr 1fr"
                  : sideGames.length === 2
                    ? "1.6fr 1fr 1fr"
                    : sideGames.length === 1
                      ? "1.6fr 1fr"
                      : "1fr",
            }}
          >
            <HeroCard game={heroGame} coverDataUrl={resolveCover(heroGame)} />
            {sideGames.map((g) => (
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
        )}

        {stack.length > 0 && (
          <>
            <div className="flex items-center gap-3.5 pb-1 pt-2">
              <span className="font-serif text-[14px] uppercase tracking-[0.12em] text-ink-2">
                藏书 · Stacks
              </span>
              <hr className="flex-1 border-0 border-t border-line" />
              <span className="font-mono text-[10.5px] text-ink-3">
                — {stack.length} 部 ——
              </span>
            </div>

            <div
              className="grid items-end"
              style={{
                gridTemplateColumns:
                  "repeat(auto-fill, minmax(var(--card-w, 172px), 1fr))",
                gap: "28px 22px",
              }}
            >
              {stack.map((g) => (
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
          </>
        )}
      </div>
    </div>
  );
}
