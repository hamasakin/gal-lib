---
phase: 03-launch-playtime
plan: 03f
type: execute
wave: 6
depends_on: [03a, 03b, 03c, 03d, 03e]
files_modified:
  - src/lib/launch.ts
  - src/store/library.ts
  - src/components/library/GameCard.tsx
  - src/components/library/ActiveSessionBar.tsx
  - src/routes/Library.tsx
  - src/routes/Detail.tsx
  - src/routes/Settings.tsx
  - src/router.tsx
  - src/main.tsx
autonomous: true
requirements: [LAUNCH-02, LAUNCH-03, LAUNCH-04, LAUNCH-05, TIME-04, TRAY-01]
must_haves:
  truths:
    - "src/lib/launch.ts: launchGame / endActiveSession / getActiveSession / listSessions / updateGameLaunchConfig / getLePath / setLePath helpers + onActiveSessionChanged event subscription"
    - "GameCard 卡片显示启动按钮（cover 右下角悬浮，hover 显现）+ DropdownMenu 追加 启动 / 强制结束（active 时）项"
    - "Library 主区追加 ActiveSessionBar（与 ScanProgressBar 同位置；优先级：scan > active session）"
    - "Detail 路由 (/games/:id) 最小版：cover + name + total_playtime + sessions list (倒序) + LE profile 选择 + 启动参数 + cwd + 启动 exe 候选 + 启动按钮"
    - "Settings 页追加 LE 路径 section（自动检测显示 + 手动覆盖按钮 + 路径选择 dialog）"
    - "router.tsx 追加 `path: 'games/:id'`；GameCard click → navigate(/games/:id) 替换 P2 的 toast 占位"
    - "main.tsx 订阅 active-session-changed event 写入 Zustand"
    - "首次 close-to-tray toast 显示『已最小化到系统托盘』+ 不再提示选项（localStorage flag）"
    - "pnpm typecheck 退出 0；vite build 成功"
  artifacts:
    - path: src/lib/launch.ts
      contains: "export async function launchGame"
    - path: src/components/library/ActiveSessionBar.tsx
      contains: "ActiveSession"
    - path: src/routes/Detail.tsx
      contains: "总时长"
    - path: src/router.tsx
      contains: "games/:id"
---

# Plan 03f — Frontend: Launch UI + Detail Page + Settings LE + Tray UX

## Tasks

<task name="Task 1: launch invoke layer + library store extensions + main.tsx event subscriptions">

<read_first>
- D:\project\gal-lib\src-tauri\src\commands.rs (7 launch/session commands)
- D:\project\gal-lib\src/lib/scan.ts (existing pattern from P02e)
- D:\project\gal-lib\src/store/library.ts (existing — add activeSession + sessionsByGame slices)
- D:\project\gal-lib\src/main.tsx (existing — add active-session-changed + close-to-tray subscriptions)
</read_first>

<action>

1. **`src/lib/launch.ts`**:
```ts
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface ActiveSession { session_id: number; game_id: number; game_name: string; started_at: string; }
export interface SessionRow {
  id: number; game_id: number; started_at: string; ended_at: string | null;
  duration_sec: number; status: "starting" | "running" | "completed" | "launch_failed" | "cancelled";
  exit_code: number | null;
}

export async function launchGame(gameId: number): Promise<ActiveSession> {
  return invoke<ActiveSession>("launch_game", { gameId });
}
export async function endActiveSession(): Promise<void> {
  await invoke("end_active_session");
}
export async function getActiveSession(): Promise<ActiveSession | null> {
  return invoke<ActiveSession | null>("get_active_session");
}
export async function listSessions(gameId: number): Promise<SessionRow[]> {
  return invoke<SessionRow[]>("list_sessions", { gameId });
}
export async function updateGameLaunchConfig(gameId: number, patch: { le_profile?: string; launch_args?: string; cwd?: string; executable_path?: string; }): Promise<void> {
  await invoke("update_game_launch_config", { gameId, leProfile: patch.le_profile ?? null, launchArgs: patch.launch_args ?? null, cwd: patch.cwd ?? null, executablePath: patch.executable_path ?? null });
}
export async function getLePath(): Promise<string | null> {
  return invoke<string | null>("get_le_path");
}
export async function setLePath(path: string): Promise<void> {
  await invoke("set_le_path", { path });
}
export async function onActiveSessionChanged(cb: (s: ActiveSession | null) => void): Promise<UnlistenFn> {
  return listen<ActiveSession | null>("active-session-changed", (e) => cb(e.payload));
}
export async function onCloseToTray(cb: () => void): Promise<UnlistenFn> {
  return listen<void>("close-to-tray", () => cb());
}
```

2. **`src/store/library.ts`** — extend:
```ts
import type { ActiveSession, SessionRow } from "@/lib/launch";
// add to interface:
activeSession: ActiveSession | null;
setActiveSession: (s: ActiveSession | null) => void;
sessionsByGame: Record<number, SessionRow[]>;
setSessionsForGame: (gameId: number, sessions: SessionRow[]) => void;
// add to create() body initial:
activeSession: null,
setActiveSession: (s) => set({ activeSession: s }),
sessionsByGame: {},
setSessionsForGame: (gameId, sessions) => set((st) => ({ sessionsByGame: { ...st.sessionsByGame, [gameId]: sessions } })),
```

3. **`src/main.tsx`** — append after the existing scan-progress subscription:
```tsx
import { onActiveSessionChanged, onCloseToTray } from "@/lib/launch";
import { toast } from "sonner";

let activeSessionUnsub: (() => void) | undefined;
if (!activeSessionUnsub) {
  void onActiveSessionChanged((s) => {
    useLibraryStore.getState().setActiveSession(s);
  }).then((u) => { activeSessionUnsub = u; });
}

let closeToTrayUnsub: (() => void) | undefined;
if (!closeToTrayUnsub) {
  void onCloseToTray(() => {
    if (localStorage.getItem("gal-lib:tray-toast-dismissed") === "1") return;
    toast.info("已最小化到系统托盘", {
      description: "应用仍在后台运行；右键托盘图标可恢复或退出",
      action: { label: "不再提示", onClick: () => localStorage.setItem("gal-lib:tray-toast-dismissed", "1") },
      duration: 6000,
    });
  }).then((u) => { closeToTrayUnsub = u; });
}
```

</action>

<verify>
<automated>
cd D:\project\gal-lib && \
test -f src/lib/launch.ts && \
grep -q "export async function launchGame" src/lib/launch.ts && \
grep -q "export async function listSessions" src/lib/launch.ts && \
grep -q "onActiveSessionChanged" src/lib/launch.ts && \
grep -q "activeSession" src/store/library.ts && \
grep -q "sessionsByGame" src/store/library.ts && \
grep -q "onActiveSessionChanged" src/main.tsx && \
grep -q "已最小化到系统托盘" src/main.tsx && \
pnpm typecheck
</automated>
</verify>

</task>

<task name="Task 2: ActiveSessionBar + GameCard launch button + Detail route + router">

<read_first>
- D:\project\gal-lib\src/components/library/GameCard.tsx (existing — append launch button + dropdown items)
- D:\project\gal-lib\src/components/library/ScanProgressBar.tsx (visual reference — same sticky bar pattern)
- D:\project\gal-lib\src/router.tsx (existing — add /games/:id route)
- D:\project\gal-lib\.planning\phases\03-launch-playtime\03-CONTEXT.md (§Detail Page minimal)
</read_first>

<action>

1. **`src/components/library/ActiveSessionBar.tsx`** (NEW):
   - Pattern from ScanProgressBar (sticky-top h-14 backdrop-blur)
   - Read `activeSession` from useLibraryStore. Hidden when null.
   - Display: cover thumbnail (24×24, fetched via convertFileSrc from current game's cover_path) + game name + elapsed time (re-render every 1s using `useEffect setInterval`)
   - Right side: `Button variant="ghost"` with text `强制结束` → AlertDialog `确定强制结束游戏？本次会话将记为已取消` → on confirm: `endActiveSession()` + toast.info("已结束游戏会话")
   - Format elapsed as `已游玩 {H}时{M}分` if ≥1h else `已游玩 {M}分`

2. **`src/components/library/GameCard.tsx`** — modifications:
   - Add launch button: bottom-right of cover, `absolute bottom-2 right-2`, opacity-0 group-hover:opacity-100, `Button size="icon" variant="default"` with lucide `Play` icon. onClick → `launchGame(game.id)` + toast.info("正在启动 — {game.name}"). If activeSession is non-null in store, hide the launch button (only one game can launch).
   - Add to DropdownMenu items: `启动` (only if no activeSession), `强制结束` (only if activeSession.game_id === game.id)
   - Card click: replace toast.info("详情页 — 即将上线") with `useNavigate()(`/games/${game.id}`)`

3. **`src/routes/Detail.tsx`** (NEW) — minimal Phase 3 detail page:
```tsx
import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { listGames, type Game } from "@/lib/games";
import { listSessions, launchGame, updateGameLaunchConfig, type SessionRow } from "@/lib/launch";
import { useLibraryStore } from "@/store/library";
import { toast } from "sonner";
import { ArrowLeft, Play } from "lucide-react";

const LE_PROFILES = ["Japanese", "Simplified Chinese", "Traditional Chinese", "Custom"] as const;

function formatDuration(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h} 时 ${m} 分` : `${m} 分`;
}

export default function Detail() {
  const { id } = useParams<{ id: string }>();
  const gameId = Number(id);
  const navigate = useNavigate();
  const { activeSession, sessionsByGame, setSessionsForGame } = useLibraryStore();
  const [game, setGame] = useState<Game | null>(null);
  const [profile, setProfile] = useState("Japanese");
  const [args, setArgs] = useState("");
  const [cwd, setCwd] = useState("");

  useEffect(() => {
    listGames().then((all) => {
      const g = all.find((x) => x.id === gameId);
      setGame(g ?? null);
      if (g) {
        setProfile((g as Game & { le_profile?: string }).le_profile ?? "Japanese");
        setArgs((g as Game & { launch_args?: string }).launch_args ?? "");
        setCwd((g as Game & { cwd?: string }).cwd ?? "");
      }
    });
    listSessions(gameId).then((rows) => setSessionsForGame(gameId, rows));
  }, [gameId, setSessionsForGame]);

  if (!game) {
    return <div className="p-6 text-body text-muted-foreground">加载中...</div>;
  }

  const sessions = sessionsByGame[gameId] ?? [];
  const isActive = activeSession?.game_id === gameId;

  async function onLaunch() {
    if (activeSession) {
      toast.error("已有活动游戏 — 请先结束当前会话");
      return;
    }
    try {
      await updateGameLaunchConfig(gameId, { le_profile: profile, launch_args: args, cwd: cwd || undefined });
      await launchGame(gameId);
      toast.info(`正在启动 — ${game?.name}`);
    } catch (e) {
      toast.error(`启动失败 — ${String(e)}`);
    }
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-6 max-w-[960px] mx-auto space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="size-4 mr-1" /> 返回
        </Button>

        <div className="flex gap-6">
          <div className="aspect-cover w-[200px] flex-shrink-0 rounded-md overflow-hidden bg-secondary">
            {game?.cover_path && <img src={`/${game.cover_path}`} alt={game.name} className="w-full h-full object-cover" />}
          </div>
          <div className="flex-1 space-y-4">
            <h1 className="text-h2 font-semibold">{game?.name_cn ?? game?.name}</h1>
            <div className="flex gap-2 items-center">
              <Badge>{game?.status}</Badge>
              <span className="text-body text-muted-foreground">总时长 {formatDuration(game?.total_playtime_sec ?? 0)}</span>
            </div>
            <Button onClick={onLaunch} disabled={isActive}>
              <Play className="size-4 mr-1" /> {isActive ? "游戏中" : "启动"}
            </Button>
          </div>
        </div>

        <Separator />

        <section className="space-y-3">
          <h2 className="text-h3 font-semibold">启动配置</h2>
          <div className="grid grid-cols-2 gap-4">
            <label className="space-y-1">
              <span className="text-label">LE Profile</span>
              <Select value={profile} onValueChange={setProfile}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LE_PROFILES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
            <label className="space-y-1">
              <span className="text-label">启动参数</span>
              <Input value={args} onChange={(e) => setArgs(e.target.value)} placeholder="例如：-windowed" />
            </label>
            <label className="space-y-1 col-span-2">
              <span className="text-label">工作目录 (cwd)</span>
              <Input value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder="留空 = exe 同级目录" />
            </label>
          </div>
        </section>

        <Separator />

        <section className="space-y-3">
          <h2 className="text-h3 font-semibold">会话历史</h2>
          {sessions.length === 0 ? (
            <p className="text-body text-muted-foreground">还没有游玩记录 — 启动游戏开始记录</p>
          ) : (
            <ul className="space-y-1">
              {sessions.map((s) => (
                <li key={s.id} className="flex items-center justify-between rounded-md border border-border p-3">
                  <span className="text-body">{new Date(s.started_at).toLocaleString("zh-CN")}</span>
                  <span className="text-body text-muted-foreground">{formatDuration(s.duration_sec)}</span>
                  <Badge variant={s.status === "completed" ? "default" : "destructive"}>{s.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </ScrollArea>
  );
}
```

4. **`src/router.tsx`** — add child route:
```tsx
{ path: "games/:id", element: <Detail /> },
```
+ `import Detail from "@/routes/Detail";`

5. **`src/routes/Settings.tsx`** — append a 3rd section before the existing "扫描操作" section:
```tsx
<section className="space-y-4">
  <div>
    <h2 className="text-h3 font-semibold">Locale Emulator</h2>
    <p className="text-body text-muted-foreground">用于将日文游戏转区启动；自动检测如果失败请手动指定 LEProc.exe 路径</p>
  </div>
  <div className="flex items-center gap-3">
    <Input readOnly value={lePath ?? "未检测到"} className="flex-1" />
    <Button variant="secondary" onClick={onPickLePath}>选择 LEProc.exe</Button>
  </div>
</section>
```
With state + handlers:
```tsx
const [lePath, setLePath] = useState<string | null>(null);
useEffect(() => { getLePath().then(setLePath); }, []);
async function onPickLePath() {
  const picked = await openDialog({ filters: [{ name: "LEProc", extensions: ["exe"] }], multiple: false });
  if (typeof picked !== "string") return;
  await setLeP(picked);   // alias to avoid name clash with state setter
  setLePath(picked);
  toast.success("已设置 LE 路径");
}
```
(import getLePath + setLePath from `@/lib/launch`; alias setLePath import to avoid name clash with state setter — use `setLePath as setLeP`)

6. **`src/routes/Library.tsx`** — append `<ActiveSessionBar />` after `<ScanProgressBar />` so both can be visible (ActiveSessionBar may overlap; if scan + session simultaneously, scan stays priority; ActiveSessionBar simply renders conditionally on `activeSession != null`).

7. cargo check + pnpm typecheck + pnpm vite build green.

</action>

<verify>
<automated>
cd D:\project\gal-lib && \
test -f src/components/library/ActiveSessionBar.tsx && \
test -f src/routes/Detail.tsx && \
grep -q "ActiveSession" src/components/library/ActiveSessionBar.tsx && \
grep -q "强制结束" src/components/library/ActiveSessionBar.tsx && \
grep -q "总时长" src/routes/Detail.tsx && \
grep -q "会话历史" src/routes/Detail.tsx && \
grep -q "启动配置" src/routes/Detail.tsx && \
grep -q "games/:id" src/router.tsx && \
grep -q "Locale Emulator" src/routes/Settings.tsx && \
grep -q "ActiveSessionBar" src/routes/Library.tsx && \
pnpm typecheck && \
pnpm vite build
</automated>
</verify>

</task>

## Commit Protocol

3 atomic commits:
- `feat(03-03f): add launch invoke helpers + library store extensions + main.tsx event subscriptions`
- `feat(03-03f): GameCard launch button + ActiveSessionBar + Detail route`
- `feat(03-03f): Settings LE path section + router /games/:id`
