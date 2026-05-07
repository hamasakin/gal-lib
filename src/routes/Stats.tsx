/**
 * Stats route — `/stats` (Phase 5 / 05d).
 *
 * Composes the two read-only stats slices wired in 05a/05b/05c:
 *   - `getPlaytimeTrend(period, days)` → AreaChart of total hours per bucket
 *   - `getTopGames(15)`                → BarChart of top 15 games by lifetime
 *                                        playtime (descending)
 *
 * The page is a pure read-view: no mutations, no side-effects beyond the two
 * fetches. We treat the cached store slices (`trend`, `topGames`) as the
 * render source so re-mounts (e.g. after a sidebar nav round-trip) paint
 * instantly while the fresh data lands in the background.
 *
 * Period select drives both the bucket key passed to the backend AND the
 * lookback window (`days`):
 *   - daily   → 30 days  (≈ "last month, day-by-day")
 *   - weekly  → 84 days  (12 × 7; ≈ "last quarter, week-by-week")
 *   - monthly → 365 days (≈ "last year, month-by-month")
 *
 * Empty-data UX: each section shows a locked Chinese fallback line when its
 * series is empty — `还没有游玩记录 — 启动游戏开始记录` for the trend (no
 * terminal sessions in the window) and `还没有游戏 — 请到设置页扫描游戏库`
 * for the top-N (zero-playtime rows are filtered server-side, so an empty
 * top-N effectively means "no games or no plays yet").
 *
 * Recharts color tokens: `hsl(var(--ring))` for series fills/strokes and
 * `hsl(var(--muted-foreground))` for axis lines — matches the design tokens
 * used elsewhere in the shell so theme switches stay coherent. Tooltip
 * background uses `hsl(var(--card))` so popovers blend with the rest of the
 * surface palette.
 *
 * Locked Chinese copy (UI-SPEC contract — do not edit without re-locking):
 *   游玩统计 / 游玩时长趋势 / 游戏时长 Top 15 / 每日 / 每周 / 每月 /
 *   还没有游玩记录 — 启动游戏开始记录 / 还没有游戏 — 请到设置页扫描游戏库
 */

import { useEffect, useState } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getPlaytimeTrend, getTopGames, type TrendPeriod } from "@/lib/stats";
import { useLibraryStore } from "@/store/library";

/**
 * Lookback-window resolver. Centralized so the period→days mapping has a
 * single source of truth (used both in the effect deps and visually-implicit
 * via the section headings).
 */
function daysForPeriod(period: TrendPeriod): number {
  switch (period) {
    case "daily":
      return 30;
    case "weekly":
      return 12 * 7;
    case "monthly":
      return 365;
  }
}

export default function Stats() {
  const trend = useLibraryStore((s) => s.trend);
  const topGames = useLibraryStore((s) => s.topGames);
  const setTrend = useLibraryStore((s) => s.setTrend);
  const setTopGames = useLibraryStore((s) => s.setTopGames);

  const [period, setPeriod] = useState<TrendPeriod>("daily");
  const days = daysForPeriod(period);

  // Re-fetch trend whenever the period changes; top-N is period-independent
  // but we co-fetch on mount/period-change to keep the page coherent (cheap
  // single-row aggregate query — cost is negligible vs. the network-style
  // overhead of a Tauri invoke).
  useEffect(() => {
    getPlaytimeTrend(period, days)
      .then(setTrend)
      .catch((e: unknown) => {
        // eslint-disable-next-line no-console
        console.error("[Stats] getPlaytimeTrend failed:", e);
      });
    getTopGames(15)
      .then(setTopGames)
      .catch((e: unknown) => {
        // eslint-disable-next-line no-console
        console.error("[Stats] getTopGames failed:", e);
      });
  }, [period, days, setTrend, setTopGames]);

  // Pre-shape the top-games series for recharts: BarChart needs a `name` key
  // for the YAxis category and a numeric `hours` field. We fold name_cn over
  // name (Bangumi/VNDB sometimes omit a Chinese title) and convert the
  // server's lifetime seconds to hours here so the axis label reads naturally.
  const topGamesSeries = topGames.map((g) => ({
    name: g.name_cn ?? g.name,
    hours: g.total_playtime_sec / 3600,
  }));

  return (
    <ScrollArea className="h-full">
      <div className="p-6 max-w-[1080px] mx-auto space-y-8">
        {/* Header — locked title 游玩统计 + period selector */}
        <div className="flex items-center justify-between">
          <h1 className="text-h2 font-semibold">游玩统计</h1>
          <Select
            value={period}
            onValueChange={(v) => setPeriod(v as TrendPeriod)}
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="daily">每日</SelectItem>
              <SelectItem value="weekly">每周</SelectItem>
              <SelectItem value="monthly">每月</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Trend section — AreaChart (X 日期 / Y 小时) */}
        <section className="space-y-3">
          <h2 className="text-h3 font-semibold">游玩时长趋势</h2>
          {trend.length === 0 ? (
            <p className="text-body text-muted-foreground">
              还没有游玩记录 — 启动游戏开始记录
            </p>
          ) : (
            <div className="h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="hsl(var(--border))"
                  />
                  <XAxis
                    dataKey="bucket"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                  />
                  <YAxis
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                    unit="h"
                  />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 6,
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="hours"
                    stroke="hsl(var(--ring))"
                    fill="hsl(var(--ring))"
                    fillOpacity={0.25}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        {/* Top-N section — horizontal BarChart, top 15 by lifetime hours */}
        <section className="space-y-3">
          <h2 className="text-h3 font-semibold">游戏时长 Top 15</h2>
          {topGamesSeries.length === 0 ? (
            <p className="text-body text-muted-foreground">
              还没有游戏 — 请到设置页扫描游戏库
            </p>
          ) : (
            <div className="h-[420px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={topGamesSeries}
                  layout="vertical"
                  margin={{ left: 80 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="hsl(var(--border))"
                  />
                  <XAxis
                    type="number"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                    unit="h"
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                    width={120}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 6,
                    }}
                  />
                  <Bar dataKey="hours" fill="hsl(var(--ring))" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
      </div>
    </ScrollArea>
  );
}
