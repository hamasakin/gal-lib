/**
 * Stats route — `/stats` — v1.1 dashboard redesign.
 *
 * 12-column grid matching design contract:
 *   ┌── KPI(3) ── KPI(3) ── KPI(3) ── KPI(3) ──┐  (4 KPI cards)
 *   ├── Heatmap (12) ─────────────────────────┤  (6-month daily heatmap)
 *   ├── Timeline (8) ──── RingStack (4) ──────┤  (30-day bars + status ring)
 *   ├── TopList (6) ───── Breakdown (6) ──────┤  (Top 8 + brand/year breakdowns)
 *
 * KPIs:
 *   - 总游玩时长 — sum(total_playtime_sec)/3600
 *   - 本月新增 — games where created_at within current month
 *   - 通关率 — cleared/total %
 *   - 连续游玩 — current consecutive-days streak (computed from daily trend)
 *
 * Heatmap: builds a 7-row × ~26-col grid (one column per week) from a 180-day
 * daily trend. Intensity bucket via [0/.25/.5/.75]×max thresholds → l1..l4.
 *
 * Status ring: derives counts from useLibraryStore.games[] (cached); each row
 * shows label · 4-color bar · count.
 *
 * Breakdown: aggregate playtime by brand (top 6 + 其他) and game count by
 * release-decade buckets.
 */

import { useEffect, useMemo, useState } from "react";
import { useLibraryStore } from "@/store/library";
import {
  getPlaytimeTrend,
  getSessionCount,
  getTopGames,
  type TrendPeriod,
} from "@/lib/stats";
import { searchGames } from "@/lib/search";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { ImageOff } from "lucide-react";
import { PageHeader } from "@/components/library/PageHeader";
import { cn } from "@/lib/utils";
import type { Game } from "@/lib/games";

const HEATMAP_WEEKS = 26; // ~6 months
const HEATMAP_DAYS = HEATMAP_WEEKS * 7;

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function isoDay(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Build the heatmap grid: an array of HEATMAP_DAYS booleans+intensity values
 * indexed by daily-trend lookup.
 *
 * Returns array sorted oldest→newest (column-major in the design's CSS grid:
 * grid-auto-flow: column with 7 rows means cells fill top-to-bottom, left-to-right
 * in week columns).
 */
function buildHeatmap(
  trend: { bucket: string; hours: number }[],
): { day: string; level: 0 | 1 | 2 | 3 | 4; hours: number }[] {
  const map = new Map<string, number>();
  for (const t of trend) {
    map.set(t.bucket, t.hours);
  }
  const max = Math.max(0, ...trend.map((t) => t.hours));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const cells: { day: string; level: 0 | 1 | 2 | 3 | 4; hours: number }[] = [];
  for (let i = HEATMAP_DAYS - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = isoDay(d);
    const hours = map.get(key) ?? 0;
    let level: 0 | 1 | 2 | 3 | 4 = 0;
    if (max > 0) {
      const ratio = hours / max;
      if (ratio > 0.75) level = 4;
      else if (ratio > 0.5) level = 3;
      else if (ratio > 0.25) level = 2;
      else if (hours > 0) level = 1;
    }
    cells.push({ day: key, level, hours });
  }
  return cells;
}

/** Compute consecutive-days streak ending today from the daily trend. */
function computeStreak(
  trend: { bucket: string; hours: number }[],
): { current: number; longest: number } {
  const map = new Map<string, number>();
  for (const t of trend) map.set(t.bucket, t.hours);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let current = 0;
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const hours = map.get(isoDay(d)) ?? 0;
    if (hours > 0) current++;
    else break;
  }
  // longest streak in window
  let longest = 0;
  let run = 0;
  const sortedKeys = [...map.keys()].sort();
  let prev: Date | null = null;
  for (const k of sortedKeys) {
    if ((map.get(k) ?? 0) <= 0) continue;
    const cur = new Date(k);
    if (prev) {
      const diff = (cur.getTime() - prev.getTime()) / 86400000;
      if (Math.abs(diff - 1) < 0.001) {
        run++;
      } else {
        run = 1;
      }
    } else {
      run = 1;
    }
    longest = Math.max(longest, run);
    prev = cur;
  }
  return { current, longest };
}

function fmtHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)} 分`;
  return h % 1 === 0 ? `${h}` : h.toFixed(1);
}

export default function Stats() {
  const trend = useLibraryStore((s) => s.trend);
  const setTrend = useLibraryStore((s) => s.setTrend);
  const topGames = useLibraryStore((s) => s.topGames);
  const setTopGames = useLibraryStore((s) => s.setTopGames);
  const games = useLibraryStore((s) => s.games);
  const setGames = useLibraryStore((s) => s.setGames);
  const [dataDir, setDataDir] = useState<string | null>(null);

  // Daily trend cache for heatmap (180 days).
  const [heatmapTrend, setHeatmapTrend] = useState<
    { bucket: string; hours: number }[]
  >([]);

  // 30-day daily trend for the timeline (separate from heatmap window).
  const [period, setPeriod] = useState<TrendPeriod>("daily");

  // Phase 14 (POL-02) — real session count from sessions table; replaces
  // the previous `games.length` proxy that bore no relation to playthroughs.
  const [sessionCount, setSessionCount] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    getSessionCount()
      .then((n) => {
        if (!cancelled) setSessionCount(n);
      })
      .catch(() => {
        if (!cancelled) setSessionCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    invoke<string>("get_data_dir").then(setDataDir).catch(() => {});
  }, []);

  // Hydrate games if empty (route can be hit directly).
  useEffect(() => {
    if (games.length === 0) {
      void searchGames(null, "playtime", null)
        .then(setGames)
        .catch((e: unknown) => {
          // eslint-disable-next-line no-console
          console.error("[Stats] hydrate games failed:", e);
        });
    }
  }, [games.length, setGames]);

  // Trend for the timeline (driven by period select).
  useEffect(() => {
    const days = period === "daily" ? 30 : period === "weekly" ? 84 : 365;
    void getPlaytimeTrend(period, days)
      .then(setTrend)
      .catch((e: unknown) => {
        // eslint-disable-next-line no-console
        console.error("[Stats] getPlaytimeTrend failed:", e);
      });
  }, [period, setTrend]);

  // Heatmap always uses 180-day daily trend.
  useEffect(() => {
    void getPlaytimeTrend("daily", HEATMAP_DAYS)
      .then(setHeatmapTrend)
      .catch(() => {});
  }, []);

  // Top 8 for the toplist card.
  useEffect(() => {
    void getTopGames(8)
      .then(setTopGames)
      .catch((e: unknown) => {
        // eslint-disable-next-line no-console
        console.error("[Stats] getTopGames failed:", e);
      });
  }, [setTopGames]);

  // Derived KPIs
  const totalSec = games.reduce((a, g) => a + g.total_playtime_sec, 0);
  const totalHours = totalSec / 3600;
  // POL-02 — real session count, falling back to the games-length proxy
  // while the IPC is in flight or on error so the UI never shows "0 次会话"
  // mid-load on a populated library.
  const sessions = sessionCount ?? games.length;
  const cleared = games.filter((g) => g.status === "cleared").length;
  const playing = games.filter((g) => g.status === "playing").length;
  const dropped = games.filter((g) => g.status === "dropped").length;
  const unplayed = games.filter((g) => g.status === "unplayed").length;
  const completionPct =
    games.length > 0 ? Math.round((cleared / games.length) * 100) : 0;

  const thisMonth = games.filter((g) => {
    const d = new Date(g.created_at);
    const now = new Date();
    return (
      d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
    );
  }).length;

  const heatmap = useMemo(() => buildHeatmap(heatmapTrend), [heatmapTrend]);
  const streak = useMemo(() => computeStreak(heatmapTrend), [heatmapTrend]);

  const trendMax = Math.max(0, ...trend.map((t) => t.hours));

  // Brand breakdown (top 6 + 其他)
  const brandBreakdown = useMemo(() => {
    const byBrand = new Map<string, number>();
    for (const g of games) {
      if (!g.brand) continue;
      byBrand.set(g.brand, (byBrand.get(g.brand) ?? 0) + g.total_playtime_sec);
    }
    const all = [...byBrand.entries()]
      .map(([name, sec]) => ({ name, sec }))
      .sort((a, b) => b.sec - a.sec);
    const top = all.slice(0, 6);
    const otherSec = all.slice(6).reduce((a, x) => a + x.sec, 0);
    const items = otherSec > 0 ? [...top, { name: "其他", sec: otherSec }] : top;
    const totalBrandSec = items.reduce((a, x) => a + x.sec, 0) || 1;
    return items.map((b) => ({
      name: b.name,
      hours: b.sec / 3600,
      pct: Math.round((b.sec / totalBrandSec) * 100),
    }));
  }, [games]);

  // Year breakdown (count by decade-ish, but keep year resolution)
  const yearBreakdown = useMemo(() => {
    const byYear = new Map<number, number>();
    for (const g of games) {
      if (!g.release_year) continue;
      byYear.set(g.release_year, (byYear.get(g.release_year) ?? 0) + 1);
    }
    const sorted = [...byYear.entries()].sort((a, b) => b[0] - a[0]).slice(0, 6);
    const total = games.length || 1;
    return sorted.map(([year, count]) => ({
      year,
      count,
      pct: Math.round((count / total) * 100),
    }));
  }, [games]);

  return (
    <div className="h-full overflow-auto">
      <PageHeader
        crumb="游玩统计 / Dashboard"
        title={
          <>
            已经在书架前坐了
            <span className="text-brand italic">
              {" "}
              {Math.round(totalHours)}{" "}
            </span>
            个钟头
          </>
        }
        sub={`数据自 ${games.length > 0 ? new Date(games[games.length - 1]?.created_at ?? Date.now()).toLocaleDateString("zh-CN") : "—"} 起 · 跨 ${games.length} 部作品 · ${sessions} 次会话`}
      />

      <div className="px-8 pb-16 pt-6">
        <div className="grid grid-cols-12 gap-4">
          {/* KPIs */}
          <KpiCard
            label="总游玩时长"
            value={fmtHours(totalHours)}
            unit="小时"
            delta="累计"
          />
          <KpiCard
            label="本月新增"
            value={String(thisMonth)}
            unit="部"
            delta={
              thisMonth > 0
                ? `↑ ${thisMonth} 部，扫描发现`
                : "本月无新增"
            }
            deltaDown={thisMonth === 0}
          />
          <KpiCard
            label="通关率"
            value={String(completionPct)}
            unit="%"
            delta={`${cleared} / ${games.length} 部`}
          />
          <KpiCard
            label="当前连击"
            value={String(streak.current)}
            unit="天"
            delta={`最长 ${streak.longest} 天`}
          />

          {/* Heatmap */}
          <Card span={12} className="overflow-x-auto">
            <CardHeader
              title="游玩日历 · 最近 6 个月"
              hint="每方块 = 一天 · 颜色越深，时长越长"
            />
            <div
              className="mt-3 inline-grid"
              style={{
                gridTemplateRows: "repeat(7, 11px)",
                gridAutoFlow: "column",
                gridAutoColumns: "11px",
                gap: "3px",
              }}
            >
              {heatmap.map((c) => (
                <span
                  key={c.day}
                  title={`${c.day} · ${c.hours.toFixed(1)} 小时`}
                  className={cn("h-[11px] w-[11px]", levelClass(c.level))}
                  style={{ borderRadius: 2 }}
                />
              ))}
            </div>
            <div className="mt-3 flex items-center justify-end gap-1.5 font-mono text-[10px] text-ink-3">
              <span>少</span>
              <span className="h-[10px] w-[10px] bg-bg-2" />
              <span className="h-[10px] w-[10px]" style={{ background: "color-mix(in oklch, var(--accent) 22%, var(--bg-2))" }} />
              <span className="h-[10px] w-[10px]" style={{ background: "color-mix(in oklch, var(--accent) 45%, var(--bg-2))" }} />
              <span className="h-[10px] w-[10px]" style={{ background: "color-mix(in oklch, var(--accent) 70%, var(--bg-2))" }} />
              <span className="h-[10px] w-[10px] bg-brand" />
              <span>多</span>
            </div>
          </Card>

          {/* Timeline */}
          <Card span={8}>
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="font-serif text-[16px] font-medium text-ink-0">
                时长趋势 · 近{period === "daily" ? "30 天" : period === "weekly" ? "12 周" : "12 个月"}
              </h2>
              <Segmented
                value={period}
                options={[
                  { v: "daily", label: "日" },
                  { v: "weekly", label: "周" },
                  { v: "monthly", label: "月" },
                ]}
                onChange={(v) => setPeriod(v)}
              />
            </div>
            <div className="flex h-[180px] items-end gap-1.5">
              {trend.length === 0 ? (
                <div className="flex h-full w-full items-center justify-center font-mono text-[11px] text-ink-3">
                  还没有游玩记录 — 启动游戏开始记录
                </div>
              ) : (
                trend.map((t, i) => {
                  const pct = trendMax > 0 ? (t.hours / trendMax) * 100 : 0;
                  return (
                    <div
                      key={t.bucket + i}
                      className="flex flex-1 flex-col items-stretch"
                      title={`${t.bucket} · ${t.hours.toFixed(1)} 小时`}
                    >
                      <div className="relative flex h-full items-end">
                        <div
                          className="w-full bg-brand transition-opacity hover:opacity-70"
                          style={{
                            height: `${pct}%`,
                            minHeight: t.hours > 0 ? 2 : 0,
                            borderRadius: "2px 2px 0 0",
                          }}
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            {/* Sparse axis: first / mid / last */}
            {trend.length > 1 && (
              <div className="mt-2 flex justify-between font-mono text-[9.5px] text-ink-3">
                <span>{trend[0]?.bucket ?? ""}</span>
                <span>{trend[Math.floor(trend.length / 2)]?.bucket ?? ""}</span>
                <span>{trend[trend.length - 1]?.bucket ?? ""}</span>
              </div>
            )}
          </Card>

          {/* Status ring stack */}
          <Card span={4}>
            <CardHeader title="通关进度" />
            <div className="mt-4 flex flex-col gap-2.5">
              <RingRow
                label="已通关"
                value={cleared}
                max={Math.max(games.length, 1)}
                color="#6fd1c8"
              />
              <RingRow
                label="游玩中"
                value={playing}
                max={Math.max(games.length, 1)}
                color="var(--accent)"
              />
              <RingRow
                label="未开始"
                value={unplayed}
                max={Math.max(games.length, 1)}
                color="#ffd166"
              />
              <RingRow
                label="弃坑"
                value={dropped}
                max={Math.max(games.length, 1)}
                color="#d96f5a"
              />
            </div>
            <div className="mt-5 font-mono text-[10.5px] text-ink-3">
              通关定义：到达任意 ED · 可在设置改为「全 routes」
            </div>
          </Card>

          {/* Top list */}
          <Card span={6}>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="font-serif text-[16px] font-medium text-ink-0">
                累计时长 Top 8
              </h2>
              <span className="font-mono text-[10.5px] text-ink-3">
                — {topGames.length} 项
              </span>
            </div>
            {topGames.length === 0 ? (
              <p className="font-mono text-[11.5px] text-ink-3">
                还没有游戏 — 请到设置页扫描游戏库
              </p>
            ) : (
              <div className="flex flex-col">
                {topGames.map((g, i) => (
                  <TopRow
                    key={g.id}
                    rank={i + 1}
                    game={
                      games.find((x) => x.id === g.id) ?? {
                        ...emptyGame(g.id),
                        name: g.name,
                        name_cn: g.name_cn,
                        total_playtime_sec: g.total_playtime_sec,
                      }
                    }
                    dataDir={dataDir}
                  />
                ))}
              </div>
            )}
          </Card>

          {/* Breakdown */}
          <Card span={6}>
            <h2 className="mb-3 font-serif text-[16px] font-medium text-ink-0">
              按品牌时长分布
            </h2>
            {brandBreakdown.length === 0 ? (
              <p className="font-mono text-[11.5px] text-ink-3">
                暂无品牌数据
              </p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {brandBreakdown.map((b) => (
                  <BreakdownRow
                    key={b.name}
                    label={b.name}
                    valueLabel={`${Math.round(b.hours)} h`}
                    pct={b.pct}
                  />
                ))}
              </div>
            )}

            <h2 className="mt-6 mb-3 font-serif text-[16px] font-medium text-ink-0">
              按发行年份
            </h2>
            {yearBreakdown.length === 0 ? (
              <p className="font-mono text-[11.5px] text-ink-3">
                暂无年份数据
              </p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {yearBreakdown.map((y) => (
                  <BreakdownRow
                    key={y.year}
                    label={`${y.year} 年`}
                    valueLabel={`${y.count} 部`}
                    pct={y.pct}
                    color="#6fd1c8"
                  />
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

// ── Internal pieces ──────────────────────────────────────────────────────

function levelClass(level: 0 | 1 | 2 | 3 | 4): string {
  if (level === 0) return "bg-bg-2";
  if (level === 4) return "bg-brand";
  return "";
}

function Card({
  span,
  children,
  className,
}: {
  span: number;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "border border-line bg-bg-1 p-5",
        className,
      )}
      style={{
        gridColumn: `span ${span} / span ${span}`,
        borderRadius: "var(--r-md)",
      }}
    >
      {children}
    </div>
  );
}

function CardHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <h2 className="font-serif text-[16px] font-medium text-ink-0">{title}</h2>
      {hint ? (
        <span className="font-mono text-[10.5px] text-ink-3">{hint}</span>
      ) : null}
    </div>
  );
}

function KpiCard({
  label,
  value,
  unit,
  delta,
  deltaDown,
}: {
  label: string;
  value: string;
  unit: string;
  delta?: string;
  deltaDown?: boolean;
}) {
  return (
    <Card span={3}>
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
        {label}
      </div>
      <div className="mt-2 font-serif text-[30px] leading-[1.1] text-ink-0">
        {value}
        <span className="ml-1 font-mono text-[12px] text-ink-2">{unit}</span>
      </div>
      {delta ? (
        <div
          className={cn(
            "mt-1 font-mono text-[10.5px]",
            deltaDown ? "text-ink-2" : "text-brand",
          )}
        >
          {delta}
        </div>
      ) : null}
    </Card>
  );
}

interface RingRowProps {
  label: string;
  value: number;
  max: number;
  color: string;
}

function RingRow({ label, value, max, color }: RingRowProps) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div
      className="grid items-center text-[12px]"
      style={{ gridTemplateColumns: "64px 1fr 50px", gap: 10 }}
    >
      <span className="font-serif text-[12.5px] text-ink-1">{label}</span>
      <div
        className="relative h-[6px] overflow-hidden bg-bg-2"
        style={{ borderRadius: 3 }}
      >
        <div
          className="absolute left-0 top-0 h-full"
          style={{ width: `${pct}%`, background: color, borderRadius: 3 }}
        />
      </div>
      <span className="text-right font-mono text-[11px] text-ink-1">
        {value}
      </span>
    </div>
  );
}

interface BreakdownRowProps {
  label: string;
  valueLabel: string;
  pct: number;
  color?: string;
}

function BreakdownRow({ label, valueLabel, pct, color }: BreakdownRowProps) {
  return (
    <div className="flex flex-col">
      <div className="flex items-baseline justify-between">
        <span className="font-serif text-[12px] text-ink-1">{label}</span>
        <span className="font-mono text-[10.5px] text-ink-2">
          {valueLabel}
        </span>
      </div>
      <div
        className="mt-1 h-[12px] overflow-hidden bg-bg-2"
        style={{ borderRadius: 3 }}
      >
        <div
          className="h-full"
          style={{
            width: `${pct}%`,
            background: color ?? "var(--accent)",
          }}
        />
      </div>
    </div>
  );
}

function TopRow({
  rank,
  game,
  dataDir,
}: {
  rank: number;
  game: Pick<
    Game,
    | "id"
    | "name"
    | "name_cn"
    | "brand"
    | "status"
    | "total_playtime_sec"
    | "cover_path"
    | "last_scanned_at"
  >;
  dataDir: string | null;
}) {
  const displayName = game.name_cn ?? game.name;
  const coverSrc =
    game.cover_path && dataDir
      ? convertFileSrc(`${dataDir.replace(/\\/g, "/")}/${game.cover_path}`) +
        `?v=${encodeURIComponent(game.last_scanned_at ?? "")}`
      : null;
  const statusLabel: Record<Game["status"], string> = {
    unplayed: "未开始",
    playing: "游玩中",
    cleared: "已通关",
    dropped: "弃坑",
  };
  return (
    <div
      className="grid items-center border-b border-line py-2 last:border-b-0"
      style={{ gridTemplateColumns: "24px 36px 1fr 70px", gap: 12 }}
    >
      <span
        className={cn(
          "font-mono text-[10.5px]",
          rank <= 3 ? "text-brand" : "text-ink-3",
        )}
      >
        {pad2(rank)}
      </span>
      <div
        className="aspect-[3/4] w-9 overflow-hidden bg-bg-2"
        style={{ borderRadius: 2 }}
      >
        {coverSrc ? (
          <img
            src={coverSrc}
            alt=""
            className="h-full w-full object-cover"
            draggable={false}
            onError={(e) =>
              ((e.currentTarget as HTMLImageElement).style.display = "none")
            }
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-ink-3">
            <ImageOff size={10} />
          </div>
        )}
      </div>
      <div className="min-w-0">
        <div className="truncate font-serif text-[13px] text-ink-0">
          {displayName}
        </div>
        <div className="mt-0.5 truncate font-mono text-[10px] text-ink-3">
          {game.brand ?? "—"} · {statusLabel[game.status ?? "unplayed"]}
        </div>
      </div>
      <span className="text-right font-mono text-[11px] text-ink-1">
        {(game.total_playtime_sec / 3600).toFixed(1)} h
      </span>
    </div>
  );
}

interface SegOpt<T extends string> {
  v: T;
  label: string;
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: SegOpt<T>[];
  onChange: (next: T) => void;
}) {
  return (
    <div
      className="inline-flex overflow-hidden border border-line"
      style={{ borderRadius: "9999px" }}
    >
      {options.map((opt) => {
        const on = opt.v === value;
        return (
          <button
            key={opt.v}
            type="button"
            onClick={() => onChange(opt.v)}
            className={cn(
              "px-2.5 py-1 font-mono text-[10.5px] transition-colors",
              on ? "bg-brand-soft text-ink-0" : "text-ink-2 hover:text-ink-0",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Cheap sentinel for TopRow when getTopGames returns an id we don't have
 * in the cached games[] (rare — usually they overlap). Provides safe fallbacks
 * so the row renders even without complete metadata.
 */
function emptyGame(id: number) {
  return {
    id,
    path: "",
    cover_path: null,
    cover_url: null,
    bangumi_id: null,
    vndb_id: null,
    executable_path: null,
    last_played_at: null,
    status: "unplayed" as const,
    rating: null,
    notes: null,
    metadata_source: null,
    match_confidence: null,
    last_scanned_at: null,
    brand: null,
    release_year: null,
    is_favorite: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}
