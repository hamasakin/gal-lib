/**
 * GameList — table-style alternate to GameGrid (supplementary §4 ListView).
 *
 * Dense rows of cover thumb + title + brand + year + status badge + rating +
 * total play time + last played. Click row → detail page (same target as
 * GameCard). Status uses the same color tokens as the sidebar dot palette so
 * grid ↔ list visual continuity stays.
 *
 * Skipped columns from the prototype design: sessions count + tags. Both
 * require additional aggregations the `games` row doesn't carry; adding them
 * would mean a backend join we don't have a demand signal for yet. Title +
 * playtime + status give the user enough at-a-glance to choose this view
 * over the grid for "find by name / sort by time" tasks.
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { ImageOff, Heart, Loader2 } from "lucide-react";
import type { Game } from "@/lib/games";
import { displayGameName } from "@/lib/display";
import { cn } from "@/lib/utils";
import { useLibraryStore } from "@/store/library";

interface GameListProps {
  games: Game[];
}

const STATUS_LABELS: Record<Game["status"], string> = {
  unplayed: "未游玩",
  playing: "游玩中",
  cleared: "已通关",
  dropped: "已弃",
};

const STATUS_COLORS: Record<Game["status"], string> = {
  playing: "var(--accent)",
  cleared: "#6fd1c8",
  unplayed: "var(--ink-stamp)",
  dropped: "var(--ink-2)",
};

function fmtDuration(seconds: number): string {
  if (seconds <= 0) return "—";
  const totalMin = Math.floor(seconds / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${m} 分`;
  return m > 0 ? `${h} 时 ${m} 分` : `${h} 时`;
}

function fmtLastPlayed(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("zh-CN", {
      year: "2-digit",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    return "—";
  }
}

export function GameList({ games }: GameListProps) {
  const navigate = useNavigate();
  // Quick 260515-loading — row-level fetching indicator. Subscribing to the
  // whole map (rather than per-row booleans like GameCard) is fine here:
  // the list view doesn't memo rows, so a single re-render of the table is
  // cheaper than wiring 200+ selectors.
  const fetchingMetaIds = useLibraryStore((s) => s.fetchingMetaIds);

  const [dataDir, setDataDir] = useState<string | null>(null);
  useEffect(() => {
    invoke<string>("get_data_dir")
      .then(setDataDir)
      .catch((e: unknown) => {
        // eslint-disable-next-line no-console
        console.error("[GameList] get_data_dir failed:", e);
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

  return (
    <div className="px-8 py-6">
      <div
        className="overflow-hidden border border-line"
        style={{ borderRadius: "var(--r-md)" }}
      >
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="bg-bg-1">
              <Th className="w-10 px-3 text-center"></Th>
              <Th>标题</Th>
              <Th className="hidden md:table-cell">品牌</Th>
              <Th className="hidden md:table-cell w-14 text-right">发行</Th>
              <Th className="w-20">状态</Th>
              <Th className="w-16 text-right">评分</Th>
              <Th className="w-24 text-right">时长</Th>
              <Th className="hidden lg:table-cell w-20 text-right">上次游玩</Th>
            </tr>
          </thead>
          <tbody>
            {games.map((g) => {
              const cover = resolveCover(g);
              const title = displayGameName(g);
              const isFetching = fetchingMetaIds[g.id] === true;
              // Quick 260515-pending-pulse — placeholders queued behind the
              // ingest concurrency slots are also "loading" from the user's
              // POV; treat them the same as active fetch so all loading rows
              // pulse uniformly. `bound` mirrors GameCard.getMetadataState.
              const bound =
                g.metadata_source === "bangumi" ||
                g.metadata_source === "vndb" ||
                g.metadata_source === "manual";
              const isPending = !bound && g.last_scanned_at == null;
              const isLoading = isFetching || isPending;
              return (
                <tr
                  key={g.id}
                  onClick={() => navigate(`/games/${g.id}`)}
                  className={cn(
                    "cursor-pointer border-t border-line transition-colors",
                    "hover:bg-bg-1",
                    // Quick 260515-loading — softly tint the row + pulse opacity
                    // while metadata fetch is in flight (or queued). Spinner
                    // next to the title is the focal cue, tint is supporting.
                    isLoading && "animate-pulse bg-[var(--accent-soft)]/40",
                  )}
                  title={isLoading ? "正在抓取元数据…" : undefined}
                >
                  <td className="px-3 py-2">
                    <div
                      className="relative h-9 w-7 overflow-hidden bg-bg-2"
                      style={{ borderRadius: "var(--r-sm)" }}
                    >
                      {cover ? (
                        <img
                          src={cover}
                          alt=""
                          aria-hidden
                          draggable={false}
                          loading="lazy"
                          className="h-full w-full object-cover"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.display =
                              "none";
                          }}
                        />
                      ) : (
                        <div className="grid h-full w-full place-items-center text-ink-3">
                          <ImageOff size={11} />
                        </div>
                      )}
                      {isLoading && (
                        <div className="absolute inset-0 grid place-items-center bg-black/55 text-[var(--accent)]">
                          <Loader2 size={12} className="animate-spin" />
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {g.is_favorite && (
                        <Heart
                          size={11}
                          fill="currentColor"
                          strokeWidth={1.5}
                          className="flex-shrink-0 text-brand"
                          aria-hidden
                        />
                      )}
                      <span
                        className="truncate font-serif text-[13px] text-ink-0"
                        title={title}
                      >
                        {title}
                      </span>
                      {isLoading && (
                        <span
                          className="flex flex-shrink-0 items-center gap-1 font-mono text-[10px] text-[var(--accent)]"
                          aria-label="正在抓取元数据"
                        >
                          <Loader2 size={10} className="animate-spin" />
                          获取中
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="hidden md:table-cell px-3 py-2 text-ink-1">
                    {g.brand ?? <span className="text-ink-3">—</span>}
                  </td>
                  <td className="hidden md:table-cell px-3 py-2 text-right font-mono text-ink-2">
                    {g.release_year ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className="inline-flex h-[18px] items-center border px-1.5 font-mono text-[9.5px] uppercase tracking-[0.12em]"
                      style={{
                        color: STATUS_COLORS[g.status],
                        borderColor: STATUS_COLORS[g.status],
                        borderRadius: "var(--r-sm)",
                      }}
                    >
                      {STATUS_LABELS[g.status]}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-ink-1">
                    {g.rating != null ? `★ ${g.rating}` : (
                      <span className="text-ink-3">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-ink-1 tabular-nums">
                    {fmtDuration(g.total_playtime_sec)}
                  </td>
                  <td className="hidden lg:table-cell px-3 py-2 text-right font-mono text-[10.5px] text-ink-3">
                    {fmtLastPlayed(g.last_played_at)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cn(
        "px-3 py-2 text-left font-mono text-[10px] font-normal uppercase tracking-[0.14em] text-ink-3",
        className,
      )}
    >
      {children}
    </th>
  );
}
