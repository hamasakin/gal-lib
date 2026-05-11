/**
 * Phase 13 (PER-02) — PersonTimeline
 *
 * Horizontal time-bubble strip on `/persons/:id`. Each row in `games` becomes
 * a circular bubble whose diameter maps to log(playtime). Games are grouped
 * by `release_year`; bubbles within the same year stack vertically inside
 * one column. Missing-year games land in a trailing "—" bucket.
 *
 * Decisions (locked in CONTEXT.md):
 *   • Diameter: sqrt(hours + 1) mapped to [8, 28] px — prevents a single
 *     100h game from monopolising the strip.
 *   • Hover tooltip shows name + playtime + status (uses shadcn Tooltip).
 *   • No click navigation — the bubble is a bird's-eye overview; GameCard
 *     grids below remain the primary navigation surface.
 *   • Empty input renders a single-line empty state, not a hidden node.
 */

import { useMemo } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Game } from "@/lib/games";

interface PersonTimelineProps {
  /** Dedup'd Game list across all 4 roles. */
  games: Game[];
}

const STATUS_LABELS: Record<Game["status"], string> = {
  unplayed: "未玩",
  playing: "在玩",
  cleared: "已通关",
  dropped: "弃坑",
};

/** Bubble diameter in px. Anchors: 0h → 8px, 1h → ~12px, 25h → ~22px, 100h → 28px. */
function bubbleSize(playtimeSec: number): number {
  const hours = Math.max(0, playtimeSec) / 3600;
  const scaled = Math.sqrt(hours + 1); // hours=0 → 1, hours=100 → ~10
  const minD = 8;
  const maxD = 28;
  const factor = Math.min(1, scaled / 10); // cap at 100h
  return Math.round(minD + (maxD - minD) * factor);
}

function formatPlaytime(sec: number): string {
  if (sec <= 0) return "未游玩";
  const hours = sec / 3600;
  if (hours < 1) return `${Math.round(sec / 60)} 分钟`;
  if (hours < 10) return `${hours.toFixed(1)} 小时`;
  return `${Math.round(hours)} 小时`;
}

export function PersonTimeline({ games }: PersonTimelineProps) {
  // Group by year. Missing year → "—" bucket sorts last.
  const buckets = useMemo(() => {
    const byYear = new Map<number | "unknown", Game[]>();
    for (const g of games) {
      const key: number | "unknown" =
        typeof g.release_year === "number" && g.release_year > 0
          ? g.release_year
          : "unknown";
      const arr = byYear.get(key);
      if (arr) arr.push(g);
      else byYear.set(key, [g]);
    }
    const years = [...byYear.keys()]
      .filter((k): k is number => typeof k === "number")
      .sort((a, b) => a - b);
    const ordered: Array<{ year: number | "unknown"; games: Game[] }> = years.map(
      (y) => ({ year: y, games: byYear.get(y) ?? [] }),
    );
    const unknown = byYear.get("unknown");
    if (unknown && unknown.length > 0) {
      ordered.push({ year: "unknown", games: unknown });
    }
    return ordered;
  }, [games]);

  if (games.length === 0) {
    return (
      <div className="font-mono text-[11px] text-ink-3">
        暂无作品可绘制时光轴
      </div>
    );
  }

  // Year-range caption.
  const yearNums = buckets
    .map((b) => b.year)
    .filter((y): y is number => typeof y === "number");
  const yearMin = yearNums[0];
  const yearMax = yearNums[yearNums.length - 1];
  const yearRange =
    yearMin && yearMax
      ? yearMin === yearMax
        ? `${yearMin}`
        : `${yearMin} – ${yearMax}`
      : "年份未知";

  return (
    <section className="mb-10">
      <header className="mb-2 flex items-baseline justify-between border-b border-line pb-1.5">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-1">
          时光轴
        </span>
        <span className="font-mono text-[10.5px] text-ink-3">{yearRange}</span>
      </header>

      <TooltipProvider delayDuration={120}>
        <div
          className="flex items-end gap-5 overflow-x-auto pb-2"
          style={{ scrollSnapType: "x proximity", scrollbarWidth: "thin" }}
        >
          {buckets.map((bucket, idx) => {
            const yearLabel =
              bucket.year === "unknown" ? "—" : String(bucket.year);
            const isUnknown = bucket.year === "unknown";
            const prevYear = idx > 0 ? buckets[idx - 1].year : null;
            const gap =
              typeof prevYear === "number" && typeof bucket.year === "number"
                ? bucket.year - prevYear
                : 0;
            return (
              <div
                key={`${yearLabel}-${idx}`}
                className="flex shrink-0 flex-col items-center gap-1.5"
                style={{ scrollSnapAlign: "start" }}
              >
                {gap > 1 ? (
                  <div className="absolute -ml-3 mt-3 h-px w-3 border-t border-dashed border-line" />
                ) : null}
                <div className="flex min-h-[60px] flex-col-reverse items-center justify-end gap-1.5">
                  {bucket.games.map((g) => {
                    const d = bubbleSize(g.total_playtime_sec);
                    return (
                      <Tooltip key={g.id}>
                        <TooltipTrigger asChild>
                          <div
                            aria-label={g.name}
                            className={
                              "rounded-full transition-opacity " +
                              (isUnknown
                                ? "bg-ink-3/30 ring-1 ring-line"
                                : "bg-brand-soft ring-1 ring-brand/30")
                            }
                            style={{ width: `${d}px`, height: `${d}px` }}
                          />
                        </TooltipTrigger>
                        <TooltipContent side="top" className="font-mono text-[11px]">
                          <div className="flex flex-col gap-0.5">
                            <span className="font-serif text-[12px]">
                              {g.name_cn ?? g.name}
                            </span>
                            <span className="text-[10px] opacity-80">
                              {formatPlaytime(g.total_playtime_sec)} ·{" "}
                              {STATUS_LABELS[g.status]}
                            </span>
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                </div>
                <span className="font-mono text-[10px] text-ink-3">
                  {yearLabel}
                </span>
              </div>
            );
          })}
        </div>
      </TooltipProvider>
    </section>
  );
}
