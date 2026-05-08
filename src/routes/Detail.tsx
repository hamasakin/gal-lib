/**
 * Detail route ("/games/:id") — Phase 4 / 04e full Detail page.
 *
 * Replaces the P3 minimal cut (cover + name + launch config + sessions list)
 * with a 5-tab layout plus an enriched hero containing the daily-use
 * affordances (rating, favorite, status dropdown, launch button).
 *
 * Layout (locked Chinese copy from 04-CONTEXT § Detail Page + UI-SPEC):
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ ← 返回                                                        │
 *   ├──────────────────────────────────────────────────────────────┤
 *   │ ┌──────┐  {name_cn or name}                                  │
 *   │ │cover │  {name (when name_cn supplies displayName)}          │
 *   │ │ 200× │  状态 [未游玩 ▾]   [♥ 收藏]   ☆☆☆☆☆ (1-10)           │
 *   │ │  267 │  总时长 {H 时 M 分}                                  │
 *   │ └──────┘  [启动] / [游戏中] / 未识别可执行                    │
 *   ├──────────────────────────────────────────────────────────────┤
 *   │  Tabs: [简介] [标签] [笔记] [会话历史] [设置]                 │
 *   │  ────────────────────────────────────────                    │
 *   │  {active tab content}                                        │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * Tabs:
 *   - 简介 — `react-markdown` + `remark-gfm` render of `game.summary` (a
 *     placeholder field synthesized from `game.brand` + `release_year`
 *     because Phase 4 metadata schema doesn't store `summary` yet — TODO
 *     when META Phase populates the column). Falls back to "暂无简介" +
 *     brand / release_year / cover URL.
 *   - 标签 — current chip list + `<TagPicker>` editor. Re-fetches
 *     `listGameTags(gameId)` on save.
 *   - 笔记 — `<Textarea>` value=notes; debounced 800ms save via
 *     `updateGameNotes`. Status row under textarea: "保存中..." when a
 *     save is in flight, "已保存 N 秒前" when idle.
 *   - 会话历史 — preserved P3 sessions list (倒序) + locked empty state
 *     "还没有游玩记录 — 启动游戏开始记录".
 *   - 设置 — preserved P3 launch config (LE Profile / 启动参数 / cwd /
 *     已识别可执行文件 read-only Input). Save handled by an explicit
 *     "保存" button (split out from the launch button now that the hero
 *     has more affordances).
 *
 * Hero buttons:
 *   - Favorite Heart (toggle, fills on is_favorite)
 *   - Status Select (4 options, locked Chinese copy)
 *   - StarRating (5 stars half-precision; DB scale 1..=10)
 *   - 启动 button (preserved from P3, with the same `otherActive` /
 *     `noExe` / `isActive` gating). Now shares the row with the affordance
 *     buttons via flex-wrap.
 *
 * Mutation refetch contract:
 *   - All write paths (favorite / status / rating / notes / tags / launch
 *     config) re-fetch the game row via `listGames()` + filter to id, then
 *     call `setGame(updated)`. Sessions list is independent (refetched
 *     from `listSessions(gameId)` only after a session-end event).
 *   - We do NOT refresh the global library store from this route — the
 *     parent Library route owns that triple (search/sort/filter). When the
 *     user navigates back, `Library`'s mount-time refetch picks up changes.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ImageOff,
  Play,
  Heart,
  AlertTriangle,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { StarRating } from "@/components/library/StarRating";
import { TagPicker } from "@/components/library/TagPicker";
import { ScreenshotsTab } from "@/components/library/ScreenshotsTab";
import { SavesTab } from "@/components/library/SavesTab";
import {
  listGames,
  updateGameFavorite,
  updateGameNotes,
  updateGameRating,
  updateGameStatus,
  type Game,
} from "@/lib/games";
import {
  launchGame,
  listSessions,
  updateGameLaunchConfig,
  type SessionRow,
} from "@/lib/launch";
import { listGameTags, listTags, type Tag } from "@/lib/tags";
import {
  getScreenshotSettings,
  setScreenshotInterval,
} from "@/lib/screenshots";
import { useLibraryStore } from "@/store/library";
import { cn } from "@/lib/utils";

/** Hard-coded LE profile aliases per 03-CONTEXT § LE Launch Pipeline. */
const LE_PROFILES = [
  "Japanese",
  "Simplified Chinese",
  "Traditional Chinese",
  "Custom",
] as const;

/** Status enum → locked Chinese label (matches 04d FilterChip / GameCard). */
const STATUS_OPTIONS: Array<{
  value: "unplayed" | "playing" | "cleared" | "dropped";
  label: string;
}> = [
  { value: "unplayed", label: "未游玩" },
  { value: "playing", label: "游玩中" },
  { value: "cleared", label: "已通关" },
  { value: "dropped", label: "已弃" },
];

/**
 * Locked Chinese labels for the per-game screenshot cadence select (设置 tab,
 * Phase 5 / 05e). Backend stores the seconds value in
 * `games.screenshot_interval_sec` (0 = disabled). 60s lower-bound is enforced
 * by the orchestrator (silently clamped) so we never offer a value below it.
 */
const SCREENSHOT_INTERVAL_OPTIONS: Array<{
  value: number;
  label: string;
}> = [
  { value: 60, label: "60 秒" },
  { value: 300, label: "5 分钟" },
  { value: 600, label: "10 分钟" },
  { value: 1800, label: "30 分钟" },
  { value: 0, label: "关闭" },
];

const STATUS_LABELS: Record<Game["status"], string> = {
  unplayed: "未游玩",
  playing: "游玩中",
  cleared: "已通关",
  dropped: "已弃",
};

/**
 * Format a duration in seconds as the locked CONTEXT § §Detail Page format
 * "{H} 时 {M} 分" (or "{M} 分" when <1h).
 */
function formatDuration(seconds: number): string {
  const totalMin = Math.floor(seconds / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h} 时 ${m} 分` : `${m} 分`;
}

/**
 * Render a session.status as a badge label + variant. Matches the P3
 * Detail palette so users see the same indicator across phases.
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
 * Type-narrowing accessor for the Phase-3 launch-config columns the public
 * `Game` type doesn't yet expose (le_profile / launch_args / cwd /
 * executable_path lives on Game directly via P2; the launch trio is
 * filled by P3a). Backend's `list_games` returns the full row.
 */
type LaunchExtras = {
  le_profile?: string | null;
  launch_args?: string | null;
  cwd?: string | null;
};

/**
 * NOTE: `summary` is not yet in the Game type / DB schema as of Phase 4
 * (no `summary` column in schema v4). We synthesize a markdown blurb from
 * brand + release_year for the 简介 tab so the markdown rendering pipeline
 * is exercised and the UX shows what's available. When META phase adds
 * `summary` (TEXT), replace this with `game.summary` directly.
 */
function buildSummaryMarkdown(game: Game): string | null {
  const lines: string[] = [];
  if (game.brand) lines.push(`**品牌：** ${game.brand}`);
  if (game.release_year) lines.push(`**发售年份：** ${game.release_year}`);
  if (game.cover_url) lines.push(`**封面来源：** ${game.cover_url}`);
  return lines.length > 0 ? lines.join("\n\n") : null;
}

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
  const [exePath, setExePath] = useState<string>("");
  const [dataDir, setDataDir] = useState<string | null>(null);

  // ── 笔记 / autosave state ─────────────────────────────────────────────────
  const [notes, setNotes] = useState<string>("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  // 1Hz tick used to compose the "已保存 N 秒前" label without re-storing
  // a string per-second. nowTick is incremented to drive a re-render.
  const [nowTick, setNowTick] = useState<number>(() => Date.now());

  // ── 标签 state ────────────────────────────────────────────────────────────
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [gameTags, setGameTags] = useState<Tag[]>([]);

  // ── 截图间隔 state (05e / 设置 tab) ──────────────────────────────────────
  // `null` while the initial fetch is in flight; once resolved we bind the
  // Select to the integer (seconds). The Select's value is stringified for
  // shadcn compatibility (Radix only takes string values), and converted
  // back to number on change.
  const [screenshotInterval, setScreenshotIntervalState] = useState<
    number | null
  >(null);

  // Track whether the notes textarea content was just hydrated from the DB
  // (vs. user-edited). Prevents the autosave effect from firing once on
  // mount with the freshly-loaded value.
  const notesHydratedRef = useRef(false);

  // ── Hydration: data dir + game row + sessions + tags ──────────────────────
  useEffect(() => {
    invoke<string>("get_data_dir")
      .then(setDataDir)
      .catch((e: unknown) => {
        // eslint-disable-next-line no-console
        console.error("[Detail] get_data_dir failed:", e);
      });
  }, []);

  const refreshGame = useCallback(async () => {
    if (!Number.isFinite(gameId)) return;
    const all = await listGames();
    const g = all.find((x) => x.id === gameId) ?? null;
    setGame(g);
    if (g) {
      const x = g as Game & LaunchExtras;
      setProfile(x.le_profile ?? "Japanese");
      setArgs(x.launch_args ?? "");
      setCwd(x.cwd ?? "");
      setExePath(g.executable_path ?? "");
      // Hydrate notes from DB; suppress the next autosave-effect fire.
      notesHydratedRef.current = true;
      setNotes(g.notes ?? "");
    }
  }, [gameId]);

  useEffect(() => {
    if (!Number.isFinite(gameId)) return;
    void refreshGame().catch((e: unknown) => {
      // eslint-disable-next-line no-console
      console.error("[Detail] refreshGame failed:", e);
    });

    listSessions(gameId)
      .then((rows) => setSessionsForGame(gameId, rows))
      .catch((e: unknown) => {
        // eslint-disable-next-line no-console
        console.error("[Detail] listSessions failed:", e);
      });

    listTags()
      .then(setAllTags)
      .catch((e: unknown) => {
        // eslint-disable-next-line no-console
        console.error("[Detail] listTags failed:", e);
      });

    listGameTags(gameId)
      .then(setGameTags)
      .catch((e: unknown) => {
        // eslint-disable-next-line no-console
        console.error("[Detail] listGameTags failed:", e);
      });

    // Hydrate the screenshot-cadence select. Defaults to 300s on the backend
    // when the row was created pre-05e (column has DEFAULT 300).
    getScreenshotSettings(gameId)
      .then(setScreenshotIntervalState)
      .catch((e: unknown) => {
        // eslint-disable-next-line no-console
        console.error("[Detail] getScreenshotSettings failed:", e);
      });
  }, [gameId, setSessionsForGame, refreshGame]);

  // ── 笔记 autosave: debounce 800ms ────────────────────────────────────────
  useEffect(() => {
    if (!Number.isFinite(gameId)) return;
    // Skip the first fire after hydration (initial load shouldn't trigger save).
    if (notesHydratedRef.current) {
      notesHydratedRef.current = false;
      return;
    }
    const timer = setTimeout(() => {
      setSavingNotes(true);
      // Empty string means "no notes" — backend stores "" verbatim.
      // Could send null to clear; we preserve the string for round-trip
      // parity with the textarea (no value-flips between focus/blur).
      updateGameNotes(gameId, notes)
        .then(() => {
          setLastSavedAt(Date.now());
        })
        .catch((e: unknown) => {
          // eslint-disable-next-line no-console
          console.error("[Detail] updateGameNotes failed:", e);
          toast.error(`保存笔记失败 — ${String(e)}`);
        })
        .finally(() => {
          setSavingNotes(false);
        });
    }, 800);
    return () => clearTimeout(timer);
  }, [notes, gameId]);

  // ── "已保存 N 秒前" 1Hz tick (only while we have a savedAt timestamp) ────
  useEffect(() => {
    if (lastSavedAt == null) return;
    const interval = setInterval(() => {
      setNowTick(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, [lastSavedAt]);

  // ── Refetch sessions when the active session for this game ENDS ──────────
  // The store's activeSession turns null when the game stops; that's a
  // signal to refetch the sessions list (a new completed row was inserted).
  const prevActiveRef = useRef(activeSession);
  useEffect(() => {
    const prev = prevActiveRef.current;
    prevActiveRef.current = activeSession;
    // Was active for THIS game, now ended (null) → refetch.
    if (prev?.game_id === gameId && activeSession == null) {
      listSessions(gameId)
        .then((rows) => setSessionsForGame(gameId, rows))
        .catch((e: unknown) => {
          // eslint-disable-next-line no-console
          console.error("[Detail] post-session refetch failed:", e);
        });
      void refreshGame();
    }
  }, [activeSession, gameId, setSessionsForGame, refreshGame]);

  if (!Number.isFinite(gameId)) {
    return (
      <div className="p-6 text-body text-muted-foreground">无效的游戏 id</div>
    );
  }
  if (!game) {
    return <div className="p-6 text-body text-muted-foreground">加载中...</div>;
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

  // ── Hero handlers ────────────────────────────────────────────────────────
  async function onToggleFavorite() {
    if (!game) return;
    const next = !game.is_favorite;
    try {
      await updateGameFavorite(game.id, next);
      await refreshGame();
    } catch (e: unknown) {
      toast.error(`操作失败 — ${String(e)}`);
    }
  }

  async function onSetStatus(next: Game["status"]) {
    if (!game || next === game.status) return;
    try {
      await updateGameStatus(game.id, next);
      await refreshGame();
    } catch (e: unknown) {
      toast.error(`状态更新失败 — ${String(e)}`);
    }
  }

  async function onSetRating(next: number | null) {
    if (!game) return;
    try {
      await updateGameRating(game.id, next);
      await refreshGame();
    } catch (e: unknown) {
      toast.error(`评分更新失败 — ${String(e)}`);
    }
  }

  async function onTagsChanged() {
    try {
      const [tags, gtags] = await Promise.all([
        listTags(),
        listGameTags(gameId),
      ]);
      setAllTags(tags);
      setGameTags(gtags);
    } catch (e: unknown) {
      // eslint-disable-next-line no-console
      console.error("[Detail] tag refetch failed:", e);
    }
  }

  /**
   * Persist current launch-config form state then launch. Same semantics as
   * the P3 minimal Detail (cwd empty-string → undefined so backend re-evals
   * the default; launch_args empty-string sent verbatim).
   */
  async function onLaunch(useLe: boolean = false) {
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
        executable_path: exePath.length > 0 ? exePath : undefined,
      });
      await launchGame(gameId, useLe);
      toast.info(`正在启动 — ${displayName}${useLe ? "（日区）" : ""}`);
    } catch (e: unknown) {
      toast.error(`启动失败 — ${String(e)}`);
    }
  }

  /**
   * Persist the per-game screenshot cadence (设置 tab → 截图间隔 select).
   * Optimistically updates local state on success; backend handles the
   * "0 = disable, < 60 silently clamps to 60" edge cases (see
   * `set_screenshot_interval` in commands.rs).
   */
  async function onSetScreenshotInterval(next: number) {
    try {
      await setScreenshotInterval(gameId, next);
      setScreenshotIntervalState(next);
      toast.success("已设置截图间隔");
    } catch (e: unknown) {
      toast.error(`设置截图间隔失败 — ${String(e)}`);
    }
  }

  /** Save launch config without launching (设置 tab affordance). */
  async function onSaveLaunchConfig() {
    if (!game) return;
    try {
      await updateGameLaunchConfig(gameId, {
        le_profile: profile,
        launch_args: args,
        cwd: cwd.length > 0 ? cwd : undefined,
        executable_path: exePath.length > 0 ? exePath : undefined,
      });
      toast.success("已保存启动配置");
      await refreshGame();
    } catch (e: unknown) {
      toast.error(`保存失败 — ${String(e)}`);
    }
  }

  // ── 简介 markdown source (synthesized; see buildSummaryMarkdown JSDoc) ───
  const summaryMd = buildSummaryMarkdown(game);

  // ── 笔记 status footer text ──────────────────────────────────────────────
  let notesStatusLabel = "";
  if (savingNotes) {
    notesStatusLabel = "保存中...";
  } else if (lastSavedAt != null) {
    const secondsAgo = Math.max(0, Math.floor((nowTick - lastSavedAt) / 1000));
    notesStatusLabel = `已保存 ${secondsAgo} 秒前`;
  }

  return (
    <ScrollArea className="h-full w-full">
      <div className="mx-auto max-w-[960px] space-y-6 p-6">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="mr-1 size-4" /> 返回
        </Button>

        {/* ── Hero ────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap gap-6">
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
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <h1 className="text-h2 font-semibold text-foreground">
              {displayName}
            </h1>
            {game.name_cn && game.name !== displayName && (
              <p className="text-body text-muted-foreground">{game.name}</p>
            )}

            {/* Total time + status row */}
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-body text-muted-foreground">
                总时长 {formatDuration(game.total_playtime_sec)}
              </span>
              <Badge variant="outline">{STATUS_LABELS[game.status]}</Badge>
            </div>

            {/* Affordance row: status / favorite / rating */}
            <div className="flex flex-wrap items-center gap-3">
              <Select
                value={game.status}
                onValueChange={(v) => void onSetStatus(v as Game["status"])}
              >
                <SelectTrigger className="h-8 w-32" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void onToggleFavorite()}
                aria-pressed={game.is_favorite}
                className={cn(
                  "gap-1.5",
                  game.is_favorite && "border-rose-400/40 text-rose-400",
                )}
              >
                <Heart
                  className={cn(
                    "size-3.5",
                    game.is_favorite && "fill-rose-400 text-rose-400",
                  )}
                  aria-hidden
                />
                <span>收藏</span>
              </Button>

              <StarRating
                value={game.rating}
                onChange={(v) => void onSetRating(v)}
              />
            </div>

            {noExe && (
              <div className="flex items-start gap-2 rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 text-body text-yellow-300">
                <AlertTriangle
                  className="mt-0.5 size-4 flex-shrink-0"
                  aria-hidden
                />
                <span>未识别可执行文件 — 请手动指定</span>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={() => void onLaunch(false)}
                disabled={launchDisabled}
              >
                <Play className="mr-1 size-4" />
                {isActive ? "游戏中" : "启动"}
              </Button>
              <Button
                variant="outline"
                onClick={() => void onLaunch(true)}
                disabled={launchDisabled}
                title="用日区启动器包装启动（在设置页配置 LEProc / ntleas / LEx 等路径）"
              >
                用日区启动器
              </Button>
            </div>
          </div>
        </div>

        {/* ── Tabs ────────────────────────────────────────────────────── */}
        <Tabs defaultValue="summary" className="w-full">
          <TabsList variant="line" className="w-full">
            <TabsTrigger value="summary">简介</TabsTrigger>
            <TabsTrigger value="tags">标签</TabsTrigger>
            <TabsTrigger value="notes">笔记</TabsTrigger>
            <TabsTrigger value="sessions">会话历史</TabsTrigger>
            <TabsTrigger value="screenshots">截图</TabsTrigger>
            <TabsTrigger value="saves">存档</TabsTrigger>
            <TabsTrigger value="settings">设置</TabsTrigger>
          </TabsList>

          {/* ── 简介 ─────────────────────────────────────────────────── */}
          <TabsContent value="summary" className="pt-4">
            {summaryMd ? (
              <div className="prose prose-sm prose-invert max-w-none text-body text-foreground">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {summaryMd}
                </ReactMarkdown>
              </div>
            ) : (
              <p className="text-body text-muted-foreground">暂无简介</p>
            )}
          </TabsContent>

          {/* ── 标签 ─────────────────────────────────────────────────── */}
          <TabsContent value="tags" className="space-y-3 pt-4">
            {gameTags.length === 0 ? (
              <p className="text-body text-muted-foreground">还没有标签</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {gameTags.map((tag) => (
                  <Badge
                    key={tag.id}
                    variant="outline"
                    className="gap-1 text-label"
                  >
                    {tag.color && (
                      <span
                        aria-hidden
                        className="inline-block size-2 rounded-full"
                        style={{ backgroundColor: tag.color }}
                      />
                    )}
                    <span>{tag.name}</span>
                  </Badge>
                ))}
              </div>
            )}
            <TagPicker
              gameId={gameId}
              allTags={allTags}
              selectedTags={gameTags}
              onChange={() => void onTagsChanged()}
            />
          </TabsContent>

          {/* ── 笔记 ─────────────────────────────────────────────────── */}
          <TabsContent value="notes" className="space-y-2 pt-4">
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="写下你对这部游戏的感受、攻略要点、心愿..."
              className="min-h-[200px]"
            />
            <div
              className="flex justify-end text-label text-muted-foreground"
              aria-live="polite"
            >
              {notesStatusLabel}
            </div>
          </TabsContent>

          {/* ── 会话历史 ─────────────────────────────────────────────── */}
          <TabsContent value="sessions" className="pt-4">
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
          </TabsContent>

          {/* ── 截图 (05e) ───────────────────────────────────────────── */}
          <TabsContent value="screenshots" className="pt-4">
            <ScreenshotsTab gameId={gameId} dataDir={dataDir} />
          </TabsContent>

          {/* ── 存档 (05e) ───────────────────────────────────────────── */}
          <TabsContent value="saves" className="pt-4">
            <SavesTab game={game} dataDir={dataDir} />
          </TabsContent>

          {/* ── 设置 (启动配置) ──────────────────────────────────────── */}
          <TabsContent value="settings" className="space-y-4 pt-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="space-y-1">
                <span className="text-label text-muted-foreground">
                  LE Profile
                </span>
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
                <span className="text-label text-muted-foreground">
                  启动参数
                </span>
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
              <label className="space-y-1 md:col-span-2">
                <span className="text-label text-muted-foreground">
                  已识别可执行文件
                </span>
                <Input
                  value={exePath}
                  onChange={(e) => setExePath(e.target.value)}
                  placeholder="留空 = 自动识别"
                />
              </label>
              <label className="space-y-1">
                <span className="text-label text-muted-foreground">
                  截图间隔
                </span>
                <Select
                  value={String(screenshotInterval ?? 300)}
                  onValueChange={(v) => void onSetScreenshotInterval(Number(v))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SCREENSHOT_INTERVAL_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={String(opt.value)}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            </div>
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void onSaveLaunchConfig()}
              >
                保存
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </ScrollArea>
  );
}
