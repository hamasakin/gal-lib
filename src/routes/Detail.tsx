/**
 * Detail route ("/games/:id") — Phase 3 minimal detail page.
 *
 * 03-CONTEXT § Session History UI scope cap:
 *   - This is the minimal Phase-3 cut: cover + name + total_playtime +
 *     LE profile / launch_args / cwd config form + sessions list.
 *   - Phase 4 will replace this with a richer hero (description /
 *     screenshots / tags / rating / notes).
 *
 * Layout (locked Chinese copy from CONTEXT/UI-SPEC):
 *   ┌─────────────────────────────────────────────┐
 *   │ ← 返回                                      │
 *   ├─────────────────────────────────────────────┤
 *   │ ┌──────┐  {name_cn or name}                 │
 *   │ │cover │  {status badge}  总时长 {H 时 M 分}│
 *   │ │ 200× │  [启动] / [游戏中] / 未识别可执行  │
 *   │ │  267 │                                    │
 *   │ └──────┘                                    │
 *   ├─────────────────────────────────────────────┤
 *   │ 启动配置                                    │
 *   │ LE Profile [Japanese ▾]  启动参数 [...]    │
 *   │ 工作目录 (cwd) [...]                        │
 *   ├─────────────────────────────────────────────┤
 *   │ 会话历史                                    │
 *   │ {date}  {duration}  [completed]             │
 *   │ ...                                         │
 *   └─────────────────────────────────────────────┘
 *
 * Edge cases:
 *   - `executable_path == null` → render an inline yellow note "未识别
 *     可执行文件 — 请手动指定" and disable the launch button. The actual
 *     manual-override UX is deferred to Phase 4 (this is a Phase-3 stop-gap
 *     so the user understands why launch is unavailable).
 *   - `activeSession?.game_id === gameId` → button label "游戏中", disabled.
 *   - `activeSession != null && activeSession.game_id !== gameId` → tapping
 *     launch surfaces the locked toast "已有活动游戏 — 请先结束当前会话"
 *     (no UI gate; backend would also reject).
 *
 * State:
 *   - `game`: Game | null — the row for `:id`. `null` until first listGames()
 *     resolves AND the matching id is found; we render a "加载中..." stub
 *     while pending. (Avoids a flash of empty fields with default values.)
 *   - `profile / args / cwd`: form-mirror of the corresponding `games` cols.
 *     Defaults: profile = "Japanese" (matches the schema-v3 NOT NULL DEFAULT),
 *     args/cwd = "" (NULL in DB → empty string in form).
 *   - `sessionsByGame[gameId]`: read directly from the store; populated by
 *     listSessions() on mount.
 *
 * Form save semantics: launch button BOTH persists the form values AND
 * launches the game in a single round-trip pair. This avoids a "save → launch"
 * two-button UX in this minimal cut. Phase 4 will introduce a separate
 * "保存配置" button when more fields are added.
 */

import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ImageOff, Play, AlertTriangle } from "lucide-react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listGames, type Game } from "@/lib/games";
import {
  launchGame,
  listSessions,
  updateGameLaunchConfig,
  type SessionRow,
} from "@/lib/launch";
import { useLibraryStore } from "@/store/library";

/** Hard-coded LE profile aliases per 03-CONTEXT § LE Launch Pipeline. */
const LE_PROFILES = [
  "Japanese",
  "Simplified Chinese",
  "Traditional Chinese",
  "Custom",
] as const;

/**
 * Format a duration in seconds as the locked CONTEXT § §Detail Page format
 * "{H}时{M}分" (or "{M}分" when <1h). Mirrors ActiveSessionBar.formatElapsed
 * but without the "已游玩 " prefix — context here is "总时长" / per-session
 * duration, not live-tracked elapsed.
 */
function formatDuration(seconds: number): string {
  const totalMin = Math.floor(seconds / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h} 时 ${m} 分` : `${m} 分`;
}

/**
 * Map the schema-v3 `sessions.status` value to a Chinese-language label
 * + Badge variant. The CHECK constraint enumerates exactly 5 values, so
 * this switch is exhaustive — TS will flag if a new value is added later.
 */
function statusBadge(status: SessionRow["status"]): {
  label: string;
  variant: "default" | "secondary" | "destructive" | "outline";
} {
  switch (status) {
    case "completed":
      return { label: "已完成", variant: "default" };
    case "running":
      return { label: "进行中", variant: "secondary" };
    case "starting":
      return { label: "启动中", variant: "secondary" };
    case "cancelled":
      return { label: "已取消", variant: "outline" };
    case "launch_failed":
      return { label: "启动失败", variant: "destructive" };
  }
}

/**
 * Type-narrowing accessor for `games` columns that exist in the schema
 * but aren't yet exposed on `lib/games.ts::Game` (le_profile / launch_args /
 * cwd are read by Phase 3 but the Phase 2 `Game` interface predates them).
 *
 * Backend's `list_games` Tauri command returns the full row including these
 * cols, but the TS interface intentionally tracks Phase 2 fields. We cast
 * to the extended shape locally to keep the public Game interface stable.
 */
type LaunchExtras = {
  le_profile?: string | null;
  launch_args?: string | null;
  cwd?: string | null;
};

export default function Detail() {
  const { id } = useParams<{ id: string }>();
  const gameId = Number(id);
  const navigate = useNavigate();

  const activeSession = useLibraryStore((s) => s.activeSession);
  const sessionsByGame = useLibraryStore((s) => s.sessionsByGame);
  const setSessionsForGame = useLibraryStore((s) => s.setSessionsForGame);

  const [game, setGame] = useState<Game | null>(null);
  const [profile, setProfile] = useState<string>("Japanese");
  const [args, setArgs] = useState<string>("");
  const [cwd, setCwd] = useState<string>("");
  const [dataDir, setDataDir] = useState<string | null>(null);

  // Resolve dataDir for cover URL.
  useEffect(() => {
    invoke<string>("get_data_dir")
      .then(setDataDir)
      .catch((e: unknown) => {
        // eslint-disable-next-line no-console
        console.error("[Detail] get_data_dir failed:", e);
      });
  }, []);

  // Hydrate the game row + sessions on mount or :id change.
  useEffect(() => {
    if (!Number.isFinite(gameId)) return;
    listGames()
      .then((all) => {
        const g = all.find((x) => x.id === gameId) ?? null;
        setGame(g);
        if (g) {
          const x = g as Game & LaunchExtras;
          // Default to schema NOT-NULL value when the row predates 03a's
          // migration on a hot-reload edge case (shouldn't happen in
          // practice but the type is `string | null | undefined`).
          setProfile(x.le_profile ?? "Japanese");
          setArgs(x.launch_args ?? "");
          setCwd(x.cwd ?? "");
        }
      })
      .catch((e: unknown) => {
        // eslint-disable-next-line no-console
        console.error("[Detail] listGames failed:", e);
      });

    listSessions(gameId)
      .then((rows) => setSessionsForGame(gameId, rows))
      .catch((e: unknown) => {
        // eslint-disable-next-line no-console
        console.error("[Detail] listSessions failed:", e);
      });
  }, [gameId, setSessionsForGame]);

  if (!Number.isFinite(gameId)) {
    return (
      <div className="p-6 text-body text-muted-foreground">
        无效的游戏 id
      </div>
    );
  }
  if (!game) {
    return (
      <div className="p-6 text-body text-muted-foreground">加载中...</div>
    );
  }

  const sessions = sessionsByGame[gameId] ?? [];
  const isActive = activeSession?.game_id === gameId;
  const otherActive = activeSession != null && !isActive;
  const noExe = game.executable_path == null;
  const launchDisabled = isActive || otherActive || noExe;

  const displayName = game.name_cn ?? game.name;
  const coverSrc =
    game.cover_path && dataDir
      ? convertFileSrc(`${dataDir.replace(/\\/g, "/")}/${game.cover_path}`)
      : null;

  /**
   * Persist current form state then launch. We send empty strings as
   * empty strings (NOT null) because the user explicitly typed them —
   * `Some("")` clears the field per 03d's COALESCE semantics. cwd is the
   * one exception: an empty string here means "use default (exe parent
   * dir)", which is what NULL in the DB also signals; we send `undefined`
   * (→ null) so the next launch re-evaluates the default.
   */
  async function onLaunch() {
    if (otherActive) {
      toast.error("已有活动游戏 — 请先结束当前会话");
      return;
    }
    if (!game) return;
    try {
      await updateGameLaunchConfig(gameId, {
        le_profile: profile,
        launch_args: args,
        cwd: cwd.length > 0 ? cwd : undefined,
      });
      await launchGame(gameId);
      toast.info(`正在启动 — ${displayName}`);
    } catch (e: unknown) {
      toast.error(`启动失败 — ${String(e)}`);
    }
  }

  return (
    <ScrollArea className="h-full w-full">
      <div className="mx-auto max-w-[960px] space-y-6 p-6">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="mr-1 size-4" /> 返回
        </Button>

        {/* ── Hero ────────────────────────────────────────────────────── */}
        <div className="flex gap-6">
          <div className="aspect-cover w-[200px] flex-shrink-0 overflow-hidden rounded-md bg-secondary">
            {coverSrc ? (
              <img
                src={coverSrc}
                alt={displayName}
                draggable={false}
                className="h-full w-full object-cover"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = "none";
                }}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                <ImageOff className="size-8" aria-hidden />
              </div>
            )}
          </div>
          <div className="flex flex-1 flex-col gap-3">
            <h1 className="text-h2 font-semibold text-foreground">
              {displayName}
            </h1>
            {game.name_cn && game.name !== displayName && (
              <p className="text-body text-muted-foreground">{game.name}</p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="outline">{game.status}</Badge>
              <span className="text-body text-muted-foreground">
                总时长 {formatDuration(game.total_playtime_sec)}
              </span>
            </div>
            {noExe && (
              <div className="flex items-start gap-2 rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 text-body text-yellow-300">
                <AlertTriangle className="mt-0.5 size-4 flex-shrink-0" aria-hidden />
                <span>未识别可执行文件 — 请手动指定</span>
              </div>
            )}
            <div>
              <Button onClick={() => void onLaunch()} disabled={launchDisabled}>
                <Play className="mr-1 size-4" />
                {isActive ? "游戏中" : "启动"}
              </Button>
            </div>
          </div>
        </div>

        <Separator />

        {/* ── Launch config ───────────────────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="text-h3 font-semibold text-foreground">启动配置</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="space-y-1">
              <span className="text-label text-muted-foreground">LE Profile</span>
              <Select value={profile} onValueChange={setProfile}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LE_PROFILES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="space-y-1">
              <span className="text-label text-muted-foreground">启动参数</span>
              <Input
                value={args}
                onChange={(e) => setArgs(e.target.value)}
                placeholder="例如：-windowed"
              />
            </label>
            <label className="space-y-1 md:col-span-2">
              <span className="text-label text-muted-foreground">
                工作目录 (cwd)
              </span>
              <Input
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
                placeholder="留空 = exe 同级目录"
              />
            </label>
          </div>
        </section>

        <Separator />

        {/* ── Session history ─────────────────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="text-h3 font-semibold text-foreground">会话历史</h2>
          {sessions.length === 0 ? (
            <p className="text-body text-muted-foreground">
              还没有游玩记录 — 启动游戏开始记录
            </p>
          ) : (
            <ul className="space-y-2">
              {sessions.map((s) => {
                const sb = statusBadge(s.status);
                return (
                  <li
                    key={s.id}
                    className="flex items-center justify-between gap-3 rounded-md border border-border bg-card p-3"
                  >
                    <span className="text-body text-foreground">
                      {new Date(s.started_at).toLocaleString("zh-CN")}
                    </span>
                    <span className="text-body text-muted-foreground">
                      {formatDuration(s.duration_sec)}
                    </span>
                    <Badge variant={sb.variant}>{sb.label}</Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </ScrollArea>
  );
}
