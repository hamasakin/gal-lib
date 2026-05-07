---
phase: 05-stats-media
plan: 05d
type: execute
wave: 4
depends_on: [05a, 05c]
files_modified:
  - src/routes/Stats.tsx
  - src/router.tsx
  - src/components/layout/Sidebar.tsx
autonomous: true
requirements: [STATS-01, STATS-02]
must_haves:
  truths:
    - "Stats route /stats — period select (daily/weekly/monthly) + AreaChart trend (X 日期 Y 小时) + BarChart top N games"
    - "Sidebar bottom nav 加 统计 (lucide BarChart3) + Settings 一起作为 nav links"
    - "router.tsx 加 /stats 路由"
    - "pnpm typecheck + vite build 全绿"
---

# Plan 05d — Stats Page + Sidebar nav

## Tasks

<task name="Task 1: Stats.tsx + router + Sidebar nav">

<read_first>
- D:\project\gal-lib\src/lib/stats.ts (05c)
- D:\project\gal-lib\src/store/library.ts (trend/topGames slices)
- D:\project\gal-lib\src/router.tsx
- D:\project\gal-lib\src/components/layout/Sidebar.tsx (P4)
- D:\project\gal-lib\.planning\phases\05-stats-media\05-CONTEXT.md (§Stats Page)
</read_first>

<action>

1. **`src/routes/Stats.tsx`** (NEW):
```tsx
import { useEffect, useState } from "react";
import { ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getPlaytimeTrend, getTopGames, type TrendPeriod } from "@/lib/stats";
import { useLibraryStore } from "@/store/library";

export default function Stats() {
  const { trend, topGames, setTrend, setTopGames } = useLibraryStore();
  const [period, setPeriod] = useState<TrendPeriod>("daily");
  const days = period === "daily" ? 30 : period === "weekly" ? 12 * 7 : 365;

  useEffect(() => {
    getPlaytimeTrend(period, days).then(setTrend);
    getTopGames(15).then(setTopGames);
  }, [period, days, setTrend, setTopGames]);

  return (
    <ScrollArea className="h-full">
      <div className="p-6 max-w-[1080px] mx-auto space-y-8">
        <div className="flex items-center justify-between">
          <h1 className="text-h2 font-semibold">游玩统计</h1>
          <Select value={period} onValueChange={(v) => setPeriod(v as TrendPeriod)}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="daily">每日</SelectItem>
              <SelectItem value="weekly">每周</SelectItem>
              <SelectItem value="monthly">每月</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <section className="space-y-3">
          <h2 className="text-h3 font-semibold">游玩时长趋势</h2>
          {trend.length === 0 ? (
            <p className="text-body text-muted-foreground">还没有游玩记录 — 启动游戏开始记录</p>
          ) : (
            <div className="h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="bucket" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} unit="h" />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6 }} />
                  <Area type="monotone" dataKey="hours" stroke="hsl(var(--ring))" fill="hsl(var(--ring))" fillOpacity={0.25} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-h3 font-semibold">游戏时长 Top 15</h2>
          {topGames.length === 0 ? (
            <p className="text-body text-muted-foreground">还没有游戏 — 请到设置页扫描游戏库</p>
          ) : (
            <div className="h-[420px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topGames.map(g => ({ name: g.name_cn ?? g.name, hours: g.total_playtime_sec / 3600 }))} layout="vertical" margin={{ left: 80 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={12} unit="h" />
                  <YAxis type="category" dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={12} width={120} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6 }} />
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
```

2. **`src/router.tsx`** — append child route `{ path: "stats", element: <Stats /> }` + import.

3. **`src/components/layout/Sidebar.tsx`** — append below the existing 设置 nav:
```tsx
{/* Stats nav */}
<NavLink to="/stats" ...>统计</NavLink>
```
Or, keep current Settings nav in place and add a Stats nav above it (per CONTEXT). Use lucide `BarChart3` icon.

4. pnpm typecheck + vite build green.

</action>

<verify>
<automated>
cd D:\project\gal-lib && \
test -f src/routes/Stats.tsx && \
grep -q "getPlaytimeTrend" src/routes/Stats.tsx && \
grep -q "AreaChart" src/routes/Stats.tsx && \
grep -q "BarChart" src/routes/Stats.tsx && \
grep -q "stats" src/router.tsx && \
grep -q "BarChart3\|统计" src/components/layout/Sidebar.tsx && \
pnpm typecheck && \
pnpm vite build
</automated>
</verify>

</task>

## Commit

`feat(05-05d): stats page (/stats) — period select + trend AreaChart + top games BarChart + sidebar nav`
