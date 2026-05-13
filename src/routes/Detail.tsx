/**
 * Detail route ("/games/:id") — v1.1 immersive redesign.
 *
 * Layout:
 *   ┌────────────────────────────────────────────────────────────┐
 *   │ HERO (380px, blurred cover bg + linear veil)                │
 *   │ ┌──────┐  ← 图书馆 · Brand · Year                            │
 *   │ │COVER │  〈SERIF H1 TITLE〉                                 │
 *   │ │220px │  alt name                                           │
 *   │ │ 3:4  │  pills row · status · time · rating · meta          │
 *   │ └──────┘                                       [♥]  [44px ↑] │
 *   ├────────────────────────────────────────────────────────────┤
 *   │ BODY (1fr + 320px)                                           │
 *   │ ┌─tabs───────────────────────────┐  Right meta sidebar        │
 *   │ │总览 · 笔记 · 会话历史 · 截图 · 存档 · 启动配置│ 条目信息 / 标签 / 路径 │
 *   │ └─                              ─┘                            │
 *   └────────────────────────────────────────────────────────────┘
 *
 * Hero cover: position absolute bg = full-bleed cover img, filter blur(36px)
 * brightness(.5). The 220×293 cover-big sits in the inner grid with
 * margin-bottom: -60px so it overflows the hero downward and overlaps body.
 *
 * Tabs use shadcn variant="line" + custom `.detail-tabs` class which recolors
 * the underline indicator to var(--accent) (see src/index.css).
 *
 * Right sidebar: 320px column with kv-list (条目信息) + tag-list + 路径
 * actions. Tags stay editable via the embedded TagPicker modal.
 *
 * Logic preserved from v1.0:
 *   - refreshGame on mount + after mutations
 *   - notes 800ms debounced autosave
 *   - sessions auto-refetch when active session ENDS for this game
 *   - per-game screenshot interval (Phase 5 / 05e)
 *   - launch config save flow (LE profile / args / cwd / exe)
 *   - ScreenshotsTab + SavesTab unchanged (re-skin happens at the component
 *     level via design tokens; no functional changes here)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  Brush,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  FolderOpen,
  Heart,
  ImageDown,
  ImageOff,
  Mic2,
  MoreHorizontal,
  Music,
  PenLine,
  RefreshCw,
  Search,
} from "lucide-react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { toastLaunchSuccess } from "@/lib/toast";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { LaunchButton } from "@/components/library/LaunchButton";
import {
  listGames,
  openGameDir,
  updateGameFavorite,
  updateGameNotes,
  updateGameRating,
  updateGameStatus,
  type Game,
} from "@/lib/games";
import {
  endActiveSession,
  launchGame,
  listSessions,
  updateGameLaunchConfig,
  type SessionRow,
} from "@/lib/launch";
import { listGameTags, listTags, type Tag } from "@/lib/tags";
import {
  bangumiSubjectUrl,
  listOfficialTagsForGame,
  listPersonsForGame,
  openExternalUrl,
  vndbVnUrl,
  type GameStaffRow,
  type OfficialTagRow,
  type StaffRole,
} from "@/lib/persons";
import {
  getScreenshotSettings,
  setScreenshotInterval,
} from "@/lib/screenshots";
import { useLibraryStore } from "@/store/library";
import { cn } from "@/lib/utils";
import {
  bangumiPageUrl,
  bangumiSearchUrl,
  displayGameName,
  openExternal,
  vndbPageUrl,
  vndbSearchUrl,
} from "@/lib/display";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MetadataPicker } from "@/components/library/MetadataPicker";
import { refreshMetadata } from "@/lib/metadata";
import {
  addGamesToView,
  createCustomView,
  type CustomViewRow,
} from "@/lib/customViews";
import { getSidebarCategories } from "@/lib/search";

const LE_PROFILES = [
  "Japanese",
  "Simplified Chinese",
  "Traditional Chinese",
  "Custom",
] as const;
type LeProfile = (typeof LE_PROFILES)[number];

const STATUS_OPTIONS: Array<{ value: Game["status"]; label: string }> = [
  { value: "unplayed", label: "未游玩" },
  { value: "playing", label: "游玩中" },
  { value: "cleared", label: "已通关" },
  { value: "dropped", label: "已弃" },
];

const STATUS_LABELS: Record<Game["status"], string> = {
  unplayed: "未游玩",
  playing: "游玩中",
  cleared: "已通关",
  dropped: "已弃",
};

const SCREENSHOT_INTERVAL_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 60, label: "60 秒" },
  { value: 300, label: "5 分钟" },
  { value: 600, label: "10 分钟" },
  { value: 1800, label: "30 分钟" },
  { value: 0, label: "关闭" },
];

function formatDuration(seconds: number): string {
  const totalMin = Math.floor(seconds / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h} 时 ${m} 分` : `${m} 分`;
}

function formatSessionDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`;
  return formatDuration(seconds);
}

function statusBadgeText(status: SessionRow["status"]): string {
  switch (status) {
    case "completed":
      return "已完成";
    case "running":
      return "进行中";
    case "starting":
      return "启动中";
    case "cancelled":
      return "已取消";
    case "launch_failed":
      return "启动失败";
  }
}

type LaunchExtras = {
  le_profile?: string | null;
  launch_args?: string | null;
  cwd?: string | null;
};

/** Display order for staff role groups in 总览 → 制作团队. */
const STAFF_ROLE_ORDER: StaffRole[] = [
  "scenario",
  "artist",
  "voice",
  "music",
];

const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  scenario: "剧本 / 编剧",
  artist: "原画 / 画师",
  voice: "声优",
  music: "音乐",
};

const STAFF_ROLE_ICONS: Record<
  StaffRole,
  React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>
> = {
  scenario: PenLine,
  artist: Brush,
  voice: Mic2,
  music: Music,
};

/**
 * Fetch + cache the staff list for a single game. Re-runs whenever `gameId`
 * changes; consumers can call `refresh()` after a metadata refetch.
 * Failures are toasted but don't crash the page (returns empty array).
 */
function useGameStaff(gameId: number): {
  data: GameStaffRow[];
  loading: boolean;
  refresh: () => Promise<void>;
} {
  const [data, setData] = useState<GameStaffRow[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!Number.isFinite(gameId)) return;
    setLoading(true);
    try {
      const rows = await listPersonsForGame(gameId);
      setData(rows);
    } catch (e: unknown) {
      // eslint-disable-next-line no-console
      console.error("[Detail] listPersonsForGame failed:", e);
      toast.error(`加载制作团队失败 — ${String(e)}`);
    } finally {
      setLoading(false);
    }
  }, [gameId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, loading, refresh };
}

/**
 * Fetch + cache official tags (Bangumi/VNDB) for a single game. Backend
 * already returns rows sorted by weight DESC — UI preserves that order.
 */
function useGameOfficialTags(gameId: number): {
  data: OfficialTagRow[];
  loading: boolean;
  refresh: () => Promise<void>;
} {
  const [data, setData] = useState<OfficialTagRow[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!Number.isFinite(gameId)) return;
    setLoading(true);
    try {
      const rows = await listOfficialTagsForGame(gameId);
      setData(rows);
    } catch (e: unknown) {
      // eslint-disable-next-line no-console
      console.error("[Detail] listOfficialTagsForGame failed:", e);
      toast.error(`加载官方标签失败 — ${String(e)}`);
    } finally {
      setLoading(false);
    }
  }, [gameId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, loading, refresh };
}

/**
 * Group staff rows by role, preserving backend insertion order within each
 * role bucket. Returns groups in `STAFF_ROLE_ORDER`; empty buckets omitted.
 */
function groupStaffByRole(
  rows: GameStaffRow[],
): Array<{ role: StaffRole; items: GameStaffRow[] }> {
  const buckets: Record<StaffRole, GameStaffRow[]> = {
    scenario: [],
    artist: [],
    voice: [],
    music: [],
  };
  for (const r of rows) {
    if (r.role in buckets) buckets[r.role].push(r);
  }
  return STAFF_ROLE_ORDER.filter((r) => buckets[r].length > 0).map((role) => ({
    role,
    items: buckets[role],
  }));
}

// Phase 14 (POL-01) — valid tab values for the controlled `?tab=` deeplink.
const DETAIL_TABS = [
  "overview",
  "notes",
  "sessions",
  "screenshots",
  "saves",
  "config",
] as const;
type DetailTab = (typeof DETAIL_TABS)[number];

function parseTab(raw: string | null): DetailTab {
  if (raw && (DETAIL_TABS as readonly string[]).includes(raw)) {
    return raw as DetailTab;
  }
  return "overview";
}

export default function Detail() {
  const { id } = useParams<{ id: string }>();
  const gameId = Number(id);
  const navigate = useNavigate();
  // POL-01 — controlled tab. Read once on mount + sync into URL on change.
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: DetailTab = parseTab(searchParams.get("tab"));
  function setTab(next: string) {
    const nextTab = parseTab(next);
    const params = new URLSearchParams(searchParams);
    params.set("tab", nextTab);
    setSearchParams(params, { replace: true });
  }

  const activeSession = useLibraryStore((s) => s.activeSession);
  const sessionsByGame = useLibraryStore((s) => s.sessionsByGame);
  const setSessionsForGame = useLibraryStore((s) => s.setSessionsForGame);
  const games = useLibraryStore((s) => s.games);
  const setFilter = useLibraryStore((s) => s.setFilter);
  const sidebar = useLibraryStore((s) => s.sidebar);
  const setSidebar = useLibraryStore((s) => s.setSidebar);
  const customViews: CustomViewRow[] = sidebar?.custom_views ?? [];

  async function refreshSidebarFromDetail() {
    try {
      const cats = await getSidebarCategories();
      setSidebar(cats);
    } catch (e: unknown) {
      // eslint-disable-next-line no-console
      console.error("[Detail] sidebar refresh failed:", e);
    }
  }

  async function onAddToView(viewId: number, viewName: string) {
    if (!game) return;
    try {
      const inserted = await addGamesToView(viewId, [game.id]);
      toast.success(
        inserted > 0 ? `已加入「${viewName}」` : `已在「${viewName}」中`,
      );
      await refreshSidebarFromDetail();
    } catch (e: unknown) {
      toast.error(`添加失败 — ${String(e)}`);
    }
  }

  async function onCreateAndAddView() {
    if (!game) return;
    const name = window.prompt("新视图名称")?.trim();
    if (!name) return;
    try {
      const newId = await createCustomView(name);
      await addGamesToView(newId, [game.id]);
      toast.success(`已创建视图「${name}」并加入`);
      await refreshSidebarFromDetail();
    } catch (e: unknown) {
      toast.error(`创建视图失败 — ${String(e)}`);
    }
  }

  const [game, setGame] = useState<Game | null>(null);
  const [profile, setProfile] = useState<LeProfile>("Japanese");
  const [args, setArgs] = useState<string>("");
  const [cwd, setCwd] = useState<string>("");
  const [exePath, setExePath] = useState<string>("");
  const [dataDir, setDataDir] = useState<string | null>(null);

  const [notes, setNotes] = useState<string>("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [, setNowTick] = useState<number>(() => Date.now());

  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [gameTags, setGameTags] = useState<Tag[]>([]);

  const [screenshotIntervalState, setScreenshotIntervalState] = useState<
    number | null
  >(null);

  // 重新匹配元数据 modal — open ↔ pickerOpen
  const [pickerOpen, setPickerOpen] = useState(false);
  // 重新抓取封面 button busy state (prevents double-click during the IPC roundtrip)
  const [refreshingCover, setRefreshingCover] = useState(false);

  const {
    data: staffRows,
    refresh: refreshStaff,
  } = useGameStaff(gameId);
  const {
    data: officialTags,
    refresh: refreshOfficialTags,
  } = useGameOfficialTags(gameId);
  const staffGroups = groupStaffByRole(staffRows);

  const notesHydratedRef = useRef(false);

  // ── data dir ─────────────────────────────────────────────────────────────
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
      const p = (LE_PROFILES as readonly string[]).includes(x.le_profile ?? "")
        ? (x.le_profile as LeProfile)
        : "Japanese";
      setProfile(p);
      setArgs(x.launch_args ?? "");
      setCwd(x.cwd ?? "");
      setExePath(g.executable_path ?? "");
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
    getScreenshotSettings(gameId)
      .then(setScreenshotIntervalState)
      .catch((e: unknown) => {
        // eslint-disable-next-line no-console
        console.error("[Detail] getScreenshotSettings failed:", e);
      });
  }, [gameId, setSessionsForGame, refreshGame]);

  // notes autosave 800ms debounced
  useEffect(() => {
    if (!Number.isFinite(gameId)) return;
    if (notesHydratedRef.current) {
      notesHydratedRef.current = false;
      return;
    }
    const timer = setTimeout(() => {
      setSavingNotes(true);
      updateGameNotes(gameId, notes)
        .then(() => setLastSavedAt(Date.now()))
        .catch((e: unknown) => {
          // eslint-disable-next-line no-console
          console.error("[Detail] updateGameNotes failed:", e);
          toast.error(`保存笔记失败 — ${String(e)}`);
        })
        .finally(() => setSavingNotes(false));
    }, 800);
    return () => clearTimeout(timer);
  }, [notes, gameId]);

  // 1Hz tick for "已保存 N 秒前"
  useEffect(() => {
    if (lastSavedAt == null) return;
    const interval = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [lastSavedAt]);

  // refetch sessions when active session for THIS game ends
  const prevActiveRef = useRef(activeSession);
  useEffect(() => {
    const prev = prevActiveRef.current;
    prevActiveRef.current = activeSession;
    if (prev?.game_id === gameId && activeSession == null) {
      listSessions(gameId)
        .then((rows) => setSessionsForGame(gameId, rows))
        .catch((e: unknown) => {
          // eslint-disable-next-line no-console
          console.error("[Detail] post-session refetch failed:", e);
        });
      void refreshGame();
      // Metadata may have been refreshed via context menu while the session
      // was running — re-pull staff + official tags to stay in sync.
      void refreshStaff();
      void refreshOfficialTags();
    }
  }, [
    activeSession,
    gameId,
    setSessionsForGame,
    refreshGame,
    refreshStaff,
    refreshOfficialTags,
  ]);

  // Esc → back. Window-level listener — Radix Dialog primitives (used by
  // every modal in the app) trap focus and call stopPropagation on their
  // own Esc handlers, so this only fires when no dialog is open.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        navigate(-1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  if (!Number.isFinite(gameId)) {
    return <div className="p-8 font-mono text-[12px] text-ink-2">无效的游戏 id</div>;
  }
  if (!game) {
    return (
      <div className="p-8 font-mono text-[12px] text-ink-2">加载中…</div>
    );
  }

  const sessions = sessionsByGame[gameId] ?? [];
  // Prev/next sibling navigation in the top bar — driven by the current
  // (filtered/sorted) games array. When the user deep-linked here before
  // Library hydrated, idx === -1 → arrows disable + counter blank.
  const idx = games.findIndex((g) => g.id === gameId);
  const total = games.length;
  const position = idx >= 0 ? idx + 1 : null;
  const prevId = idx > 0 ? games[idx - 1].id : null;
  const nextId =
    idx >= 0 && idx < games.length - 1 ? games[idx + 1].id : null;

  function onBrandCrumbClick() {
    if (!game?.brand) return;
    setFilter({ brand: game.brand });
    navigate("/");
  }

  const isActive = activeSession?.game_id === gameId;
  const otherActive = activeSession != null && !isActive;
  const noExe = game.executable_path == null;
  const launchDisabled = otherActive || noExe;
  const reviewNeeded = game.match_confidence != null && game.match_confidence < 80;

  const displayName = displayGameName(game);
  // Alt line: only show when name_cn carries the primary title; the
  // secondary line is then the raw `name` (cleaned upstream title).
  const altName = game.name_cn ? game.name : null;
  const coverSrc =
    game.cover_path && dataDir
      ? convertFileSrc(`${dataDir.replace(/\\/g, "/")}/${game.cover_path}`) +
        `?v=${encodeURIComponent(game.last_scanned_at ?? "")}`
      : null;

  // ── Hero handlers ────────────────────────────────────────────────────────
  async function onToggleFavorite() {
    if (!game) return;
    try {
      await updateGameFavorite(game.id, !game.is_favorite);
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

  async function onLaunchClick() {
    if (isActive) {
      try {
        await endActiveSession();
        toast.info("已结束游戏会话");
      } catch (e: unknown) {
        toast.error(`结束失败 — ${String(e)}`);
      }
      return;
    }
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
      // 详情页的启动按钮只暴露 LE profile（Japanese / 简中 / 繁中 / Custom），
      // 设计上始终走 Locale Emulator。主界面的「直接启动」走 GameCard 的菜单。
      await launchGame(gameId, true);
      toastLaunchSuccess(displayName, profile);
    } catch (e: unknown) {
      toast.error(`启动失败 — ${String(e)}`);
    }
  }

  async function onSetScreenshotInterval(next: number) {
    try {
      await setScreenshotInterval(gameId, next);
      setScreenshotIntervalState(next);
      toast.success("已设置截图间隔");
    } catch (e: unknown) {
      toast.error(`设置截图间隔失败 — ${String(e)}`);
    }
  }

  async function onPickExePath() {
    if (!game) return;
    try {
      const picked = await openDialog({
        multiple: false,
        directory: false,
        title: "选择可执行文件",
        defaultPath: exePath.length > 0 ? exePath : game.path,
        filters: [{ name: "Executable", extensions: ["exe"] }],
      });
      if (typeof picked === "string" && picked.length > 0) {
        setExePath(picked);
      }
    } catch (e: unknown) {
      toast.error(`选择失败 — ${String(e)}`);
    }
  }

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

  async function onRefreshCover() {
    if (!game || refreshingCover) return;
    setRefreshingCover(true);
    try {
      await refreshMetadata(game.id);
      await refreshGame();
      await refreshStaff();
      await refreshOfficialTags();
      toast.success("已刷新封面");
    } catch (e: unknown) {
      toast.error(`刷新封面失败 — ${String(e)}`);
    } finally {
      setRefreshingCover(false);
    }
  }

  function onClosePicker() {
    setPickerOpen(false);
    // After bindMetadata succeeds, MetadataPicker refreshes the library store
    // but Detail.tsx hydrates `game` via its own listGames roundtrip — so
    // re-fire refreshGame + staff/tag fetches to surface the new metadata.
    void refreshGame();
    void refreshStaff();
    void refreshOfficialTags();
  }

  async function onCopyPath() {
    if (!game) return;
    try {
      await navigator.clipboard.writeText(game.path);
      toast.success("已复制路径");
    } catch (e: unknown) {
      toast.error(`复制失败 — ${String(e)}`);
    }
  }

  async function onOpenDir() {
    if (!game) return;
    try {
      await openGameDir(game.path);
    } catch (e: unknown) {
      toast.error(`打开目录失败 — ${String(e)}`);
    }
  }

  const summaryParagraphs = game.summary
    ? game.summary
        .replace(/\r\n/g, "\n")
        .split(/\n{2,}/)
        .map((para) => para.trim())
        .filter((para) => para.length > 0)
    : [];
  const lastSavedSeconds = lastSavedAt
    ? Math.max(0, Math.floor((Date.now() - lastSavedAt) / 1000))
    : null;
  const notesStatusLabel = savingNotes
    ? "保存中..."
    : lastSavedSeconds != null
      ? `已保存 ${lastSavedSeconds} 秒前`
      : "";

  return (
    <div className="relative h-full w-full overflow-auto">
      {/* ── TOP NAV BAR ──────────────────────────────────────────────── */}
      <header
        className="sticky top-0 z-30 flex h-[52px] items-center justify-between border-b border-line bg-bg-0/85 px-5 backdrop-blur"
      >
        {/* Left: back + breadcrumb */}
        <div className="flex min-w-0 items-center gap-3.5">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="inline-flex h-8 items-center gap-1.5 border border-line bg-bg-1 pl-2 pr-2.5 font-mono text-[11px] text-ink-1 transition-colors hover:border-line-strong hover:bg-bg-2 hover:text-ink-0"
            style={{ borderRadius: "var(--r-md)" }}
          >
            <ArrowLeft size={12} strokeWidth={2} />
            <span>返回图书馆</span>
            <kbd
              className="ml-1 inline-flex h-[18px] items-center border border-line bg-bg-2 px-1.5 font-mono text-[9.5px] uppercase tracking-[0.06em] text-ink-3"
              style={{ borderRadius: "var(--r-sm)" }}
            >
              Esc
            </kbd>
          </button>

          <nav
            aria-label="breadcrumb"
            className="flex min-w-0 items-center gap-2 font-mono text-[11px] text-ink-3"
          >
            <button
              type="button"
              onClick={() => navigate("/")}
              className="text-ink-2 transition-colors hover:text-ink-0"
            >
              图书馆
            </button>
            {game.brand ? (
              <>
                <span aria-hidden className="text-ink-3">/</span>
                <button
                  type="button"
                  onClick={onBrandCrumbClick}
                  className="max-w-[140px] truncate text-ink-2 transition-colors hover:text-ink-0"
                >
                  {game.brand}
                </button>
              </>
            ) : null}
            <span aria-hidden className="text-ink-3">/</span>
            <span
              className="min-w-0 max-w-[280px] truncate font-serif text-[12.5px] text-ink-1"
              title={displayName}
            >
              {displayName}
            </span>
          </nav>
        </div>

        {/* Right: prev/next + counter */}
        <div className="flex flex-shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => prevId != null && navigate(`/games/${prevId}`)}
            disabled={prevId == null}
            aria-label="上一部"
            title="上一部"
            className="grid h-7 w-7 place-items-center border border-line bg-bg-1 text-ink-2 transition-colors hover:border-line-strong hover:bg-bg-2 hover:text-ink-0 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-bg-1 disabled:hover:text-ink-2"
            style={{ borderRadius: "var(--r-sm)" }}
          >
            <ChevronLeft size={13} strokeWidth={2} />
          </button>
          <span className="min-w-[58px] text-center font-mono text-[11px] text-ink-2">
            {position != null ? `${position} / ${total}` : "—"}
          </span>
          <button
            type="button"
            onClick={() => nextId != null && navigate(`/games/${nextId}`)}
            disabled={nextId == null}
            aria-label="下一部"
            title="下一部"
            className="grid h-7 w-7 place-items-center border border-line bg-bg-1 text-ink-2 transition-colors hover:border-line-strong hover:bg-bg-2 hover:text-ink-0 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-bg-1 disabled:hover:text-ink-2"
            style={{ borderRadius: "var(--r-sm)" }}
          >
            <ChevronRight size={13} strokeWidth={2} />
          </button>
        </div>
      </header>

      {/* ── HERO ──────────────────────────────────────────────────────── */}
      <section className="relative h-[380px] overflow-hidden border-b border-line">
        {/* Blurred bg */}
        <div className="absolute inset-0">
          {coverSrc ? (
            <img
              src={coverSrc}
              alt=""
              aria-hidden
              draggable={false}
              className="h-full w-full object-cover"
              style={{
                filter: "blur(36px) saturate(1.1) brightness(.5)",
                transform: "scale(1.15)",
              }}
            />
          ) : (
            <div className="h-full w-full bg-bg-2" />
          )}
        </div>
        {/* Veil */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, rgba(14,13,16,.2) 0%, var(--bg-0) 100%)",
          }}
        />

        {/* Hero inner — 220px cover + info + actions */}
        <div
          className="relative grid h-full items-end gap-7 px-8 pb-6 pt-9"
          style={{ gridTemplateColumns: "220px 1fr auto" }}
        >
          {/* Cover-big with overflow */}
          <div
            className="relative z-[2] aspect-[3/4] w-[220px] overflow-hidden bg-bg-2"
            style={{
              borderRadius: "var(--r-md)",
              marginBottom: -60,
              boxShadow:
                "0 30px 60px -20px rgba(0,0,0,.7), 0 0 0 1px rgba(255,255,255,.05) inset",
            }}
          >
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
              <div className="flex h-full w-full items-center justify-center text-ink-3">
                <ImageOff className="size-10" aria-hidden />
              </div>
            )}
          </div>

          {/* Info column */}
          <div className="min-w-0 pb-2">
            {(game.brand || game.release_year) && (
              <div className="mb-1.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-2">
                {[game.brand, game.release_year].filter(Boolean).join(" · ")}
              </div>
            )}
            <h1
              className="font-serif text-[38px] font-medium leading-[1.1] tracking-[0.01em] text-ink-0"
              style={{ textWrap: "balance" }}
            >
              {displayName}
            </h1>
            {altName ? (
              <div className="mt-1 font-mono text-[12px] text-ink-2">
                {altName}
              </div>
            ) : null}

            {/* Pills row */}
            <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
              <Pill>
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 rounded-full bg-brand"
                />
                {STATUS_LABELS[game.status]}
              </Pill>
              <Pill>{formatDuration(game.total_playtime_sec)}</Pill>
              {game.rating != null ? (
                <Pill>★ {(game.rating / 2).toFixed(1)} / 5</Pill>
              ) : null}
              {reviewNeeded && (
                <Pill className="border-[#ffd166]/50 text-[#ffd166]">
                  <AlertTriangle size={11} strokeWidth={2} />
                  待复核 · 置信度 {game.match_confidence}%
                </Pill>
              )}
              {game.bangumi_id ? (
                <ExtSourcePill
                  label="在 Bangumi 看"
                  url={bangumiSubjectUrl(game.bangumi_id)}
                  title={`在 Bangumi 打开此条目 · ${game.bangumi_id}`}
                />
              ) : null}
              {game.vndb_id ? (
                <ExtSourcePill
                  label="在 VNDB 看"
                  url={vndbVnUrl(game.vndb_id)}
                  title={`在 VNDB 打开此条目 · ${game.vndb_id}`}
                />
              ) : null}
              {game.executable_path ? (
                <Pill className="font-mono">
                  {game.executable_path.split(/[/\\]/).pop()}
                </Pill>
              ) : null}
            </div>
          </div>

          {/* Actions column */}
          <div className="relative z-[3] flex items-center gap-2.5 pb-3">
            <button
              type="button"
              onClick={() => void onToggleFavorite()}
              title={game.is_favorite ? "取消收藏" : "收藏"}
              aria-label="收藏"
              className={cn(
                "grid h-9 w-9 place-items-center rounded-full border border-line bg-bg-1/80 transition-colors hover:bg-bg-2 backdrop-blur",
                game.is_favorite ? "text-brand" : "text-ink-2",
              )}
            >
              <Heart
                size={15}
                strokeWidth={1.7}
                fill={game.is_favorite ? "currentColor" : "none"}
              />
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  title="更多"
                  aria-label="更多"
                  className="grid h-9 w-9 place-items-center rounded-full border border-line bg-bg-1/80 text-ink-2 transition-colors hover:bg-bg-2 hover:text-ink-0 backdrop-blur"
                >
                  <MoreHorizontal size={15} strokeWidth={1.7} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onClick={() => void onOpenDir()}>
                  <FolderOpen size={14} className="mr-2" />
                  打开本地目录
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void onCopyPath()}>
                  <Copy size={14} className="mr-2" />
                  复制路径
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setPickerOpen(true)}>
                  <RefreshCw size={14} className="mr-2" />
                  重新匹配元数据
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={refreshingCover}
                  onClick={() => void onRefreshCover()}
                >
                  <ImageDown size={14} className="mr-2" />
                  重新抓取封面
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>添加到视图</DropdownMenuSubTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuSubContent>
                      {customViews.length === 0 && (
                        <DropdownMenuItem disabled>
                          <span className="text-ink-3">尚无视图</span>
                        </DropdownMenuItem>
                      )}
                      {customViews.map((cv) => (
                        <DropdownMenuItem
                          key={cv.id}
                          onClick={() => void onAddToView(cv.id, cv.name)}
                        >
                          {cv.name}
                          <span className="ml-auto font-mono text-[10px] text-ink-3">
                            {cv.count}
                          </span>
                        </DropdownMenuItem>
                      ))}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => void onCreateAndAddView()}>
                        新建视图…
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuPortal>
                </DropdownMenuSub>
              </DropdownMenuContent>
            </DropdownMenu>
            <LaunchButton
              profile={profile}
              onProfileChange={(p) => setProfile(p as LeProfile)}
              onClick={() => void onLaunchClick()}
              isActive={isActive}
              disabled={launchDisabled}
              disabledTitle={
                noExe ? "未识别可执行文件" : otherActive ? "其他游戏运行中" : undefined
              }
            />
          </div>
        </div>
      </section>

      {/* ── BODY (1fr + 320px split) ──────────────────────────────────── */}
      <section
        className="grid gap-0 px-8 pb-10"
        style={{
          gridTemplateColumns: "1fr 320px",
          paddingTop: "84px", // clears the cover-big -60px overflow + 24px breathing room
        }}
      >
        {/* Left column — tabs + content */}
        <div className="min-w-0 pr-9">
          <Tabs
            value={tab}
            onValueChange={setTab}
            className="detail-tabs w-full"
          >
            <TabsList
              variant="line"
              className="mb-5 w-full justify-start gap-0 border-b border-line"
            >
              <DTab value="overview">总览</DTab>
              <DTab value="notes">笔记</DTab>
              <DTab value="sessions">会话历史</DTab>
              <DTab value="screenshots">截图</DTab>
              <DTab value="saves">存档</DTab>
              <DTab value="config">启动配置</DTab>
            </TabsList>

            {/* 总览 */}
            <TabsContent value="overview" className="space-y-6 pt-1">
              {summaryParagraphs.length > 0 ? (
                <DSection title="故事简介">
                  <div
                    className="max-w-[68ch] font-serif text-[14px] text-ink-1"
                    style={{ lineHeight: 1.7 }}
                  >
                    {summaryParagraphs.map((para, i) => {
                      const lines = para.split("\n");
                      return (
                        <p key={i} className={i > 0 ? "mt-3" : undefined}>
                          {lines.map((line, j) => (
                            <span key={j}>
                              {line}
                              {j < lines.length - 1 ? <br /> : null}
                            </span>
                          ))}
                        </p>
                      );
                    })}
                  </div>
                </DSection>
              ) : null}

              {staffGroups.length > 0 ? (
                <DSection title="制作团队">
                  <div className="flex flex-col gap-4">
                    {staffGroups.map(({ role, items }) => {
                      const Icon = STAFF_ROLE_ICONS[role];
                      return (
                        <div key={role}>
                          <h3 className="mb-2 inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
                            <Icon size={11} strokeWidth={2} />
                            <span>{STAFF_ROLE_LABELS[role]}</span>
                            <span className="text-ink-3">·</span>
                            <span>{items.length}</span>
                          </h3>
                          <div className="flex flex-wrap gap-1.5">
                            {items.map((p, i) => (
                              <PersonChip
                                key={`${p.person_id}-${i}`}
                                row={p}
                                onOpen={() =>
                                  navigate(`/persons/${p.person_id}`)
                                }
                              />
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </DSection>
              ) : null}

              <DSection title="常用操作">
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
                  <StarRating
                    value={game.rating}
                    onChange={(v) => void onSetRating(v)}
                  />
                </div>
              </DSection>
            </TabsContent>

            {/* 笔记 */}
            <TabsContent value="notes" className="space-y-2 pt-1">
              <DSection title="我的笔记">
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="写下你对这部游戏的感受、攻略要点、心愿..."
                  className="min-h-[260px] bg-bg-1 font-sans"
                />
                <div
                  className="mt-2 flex justify-end font-mono text-[10.5px] text-ink-3"
                  aria-live="polite"
                >
                  {notesStatusLabel}
                </div>
              </DSection>
            </TabsContent>

            {/* 会话历史 */}
            <TabsContent value="sessions" className="pt-1">
              <DSection
                title="会话历史"
                hint={`最近 ${Math.min(sessions.length, 8)} 次`}
              >
                {sessions.length === 0 ? (
                  <p className="font-mono text-[11.5px] text-ink-3">
                    还没有游玩记录 — 启动游戏开始记录
                  </p>
                ) : (
                  <SessionsList sessions={sessions.slice(0, 12)} />
                )}
              </DSection>
            </TabsContent>

            {/* 截图 */}
            <TabsContent value="screenshots" className="pt-1">
              <ScreenshotsTab gameId={gameId} dataDir={dataDir} />
            </TabsContent>

            {/* 存档 */}
            <TabsContent value="saves" className="pt-1">
              <SavesTab game={game} dataDir={dataDir} />
            </TabsContent>

            {/* 启动配置 */}
            <TabsContent value="config" className="space-y-5 pt-1">
              <DSection title="启动配置">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <ConfigField label="LE Profile">
                    <Select
                      value={profile}
                      onValueChange={(v) => setProfile(v as LeProfile)}
                    >
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
                  </ConfigField>
                  <ConfigField label="启动参数">
                    <Input
                      value={args}
                      onChange={(e) => setArgs(e.target.value)}
                      placeholder="例如：-windowed"
                      className="font-mono bg-bg-2"
                    />
                  </ConfigField>
                  <ConfigField label="工作目录 (cwd)" className="md:col-span-2">
                    <Input
                      value={cwd}
                      onChange={(e) => setCwd(e.target.value)}
                      placeholder="留空 = exe 同级目录"
                      className="font-mono bg-bg-2"
                    />
                  </ConfigField>
                  <ConfigField
                    label="已识别可执行文件"
                    className="md:col-span-2"
                  >
                    <div className="flex items-center gap-2">
                      <Input
                        value={exePath}
                        onChange={(e) => setExePath(e.target.value)}
                        placeholder="留空 = 自动识别"
                        className="font-mono bg-bg-2 flex-1"
                      />
                      <button
                        type="button"
                        onClick={() => void onPickExePath()}
                        title="浏览本地 .exe 文件"
                        className="inline-flex h-8 flex-shrink-0 items-center gap-1.5 border border-line bg-bg-2 px-3 text-[12px] text-ink-1 transition-colors hover:border-line-strong hover:bg-bg-3 hover:text-ink-0"
                        style={{ borderRadius: "var(--r-md)" }}
                      >
                        <FolderOpen size={12} />
                        浏览…
                      </button>
                    </div>
                  </ConfigField>
                  <ConfigField label="截图间隔">
                    <Select
                      value={String(screenshotIntervalState ?? 300)}
                      onValueChange={(v) =>
                        void onSetScreenshotInterval(Number(v))
                      }
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
                  </ConfigField>
                </div>
                <div className="flex justify-end pt-2">
                  <button
                    type="button"
                    onClick={() => void onSaveLaunchConfig()}
                    className="inline-flex h-8 items-center border border-line bg-bg-2 px-4 text-[12px] text-ink-1 transition-colors hover:border-line-strong hover:bg-bg-3 hover:text-ink-0"
                    style={{ borderRadius: "var(--r-md)" }}
                  >
                    保存配置
                  </button>
                </div>
              </DSection>
            </TabsContent>
          </Tabs>
        </div>

        {/* Right meta sidebar */}
        <aside className="border-l border-line pl-7">
          <DSection title="条目信息">
            <dl
              className="grid gap-x-3 gap-y-2 text-[12px]"
              style={{ gridTemplateColumns: "84px 1fr" }}
            >
              <DT>品牌</DT>
              <DD>{game.brand ?? "—"}</DD>
              <DT>发行年</DT>
              <DD>{game.release_year ? `${game.release_year}` : "—"}</DD>
              <DT>状态</DT>
              <DD>{STATUS_LABELS[game.status]}</DD>
              <DT>评分</DT>
              <DD>
                {game.rating != null ? `★ ${game.rating} / 10` : "—"}
              </DD>
              <DT>BGM</DT>
              <DD className="font-mono">
                {game.bangumi_id ? (
                  <ExtAnchor href={bangumiPageUrl(game.bangumi_id)}>
                    {game.bangumi_id}
                  </ExtAnchor>
                ) : (
                  <span className="text-ink-3">—</span>
                )}
              </DD>
              <DT>VNDB</DT>
              <DD className="font-mono">
                {game.vndb_id ? (
                  <ExtAnchor href={vndbPageUrl(game.vndb_id)}>
                    {game.vndb_id}
                  </ExtAnchor>
                ) : (
                  <span className="text-ink-3">—</span>
                )}
              </DD>
              <DT>来源</DT>
              <DD className="font-mono uppercase tracking-[0.06em]">
                {game.metadata_source ?? <span className="text-ink-3">none</span>}
              </DD>
            </dl>
          </DSection>

          <DSection
            title="标签"
            hint={`${gameTags.length} 个`}
            className="mt-6"
          >
            {gameTags.length === 0 ? (
              <p className="font-mono text-[11px] text-ink-3">还没有标签</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {gameTags.map((tag) => (
                  <span
                    key={tag.id}
                    className="inline-flex items-center gap-1 border border-line bg-bg-1 px-2.5 py-[3px] text-[11px] text-ink-1"
                    style={{ borderRadius: "9999px" }}
                  >
                    {tag.color && (
                      <span
                        aria-hidden
                        className="size-2 rounded-full"
                        style={{ backgroundColor: tag.color }}
                      />
                    )}
                    <span>{tag.name}</span>
                  </span>
                ))}
              </div>
            )}
            <div className="mt-2.5">
              <TagPicker
                gameId={gameId}
                allTags={allTags}
                selectedTags={gameTags}
                onChange={() => void onTagsChanged()}
              />
            </div>
          </DSection>

          {officialTags.length > 0 ? (
            <DSection
              title="官方标签"
              hint={`${officialTags.length} 个`}
              className="mt-6"
            >
              <div className="flex flex-wrap gap-1.5">
                {officialTags.map((t, i) => (
                  <OfficialTagChip key={`${t.source}-${t.tag_name}-${i}`} row={t} />
                ))}
              </div>
            </DSection>
          ) : null}

          <DSection title="路径" className="mt-6">
            <div
              className="font-mono text-[11px] leading-[1.7] text-ink-2"
              style={{ wordBreak: "break-all" }}
            >
              {game.path}
            </div>
            <div className="mt-2 flex gap-1.5">
              <SidebarBtn
                icon={<Copy size={12} />}
                onClick={() => void onCopyPath()}
              >
                复制路径
              </SidebarBtn>
              {game.cover_url ? (
                <SidebarBtn
                  icon={<ExternalLink size={12} />}
                  onClick={() => openExternal(game.cover_url ?? "")}
                >
                  封面源
                </SidebarBtn>
              ) : null}
            </div>
          </DSection>

          <DSection title="搜索源" className="mt-6">
            <p className="font-mono text-[10.5px] text-ink-3">
              用当前游戏名在数据源站内搜索
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <SidebarBtn
                icon={<Search size={12} />}
                onClick={() => openExternal(bangumiSearchUrl(game.name))}
              >
                Bangumi 搜索
              </SidebarBtn>
              <SidebarBtn
                icon={<Search size={12} />}
                onClick={() => openExternal(vndbSearchUrl(game.name))}
              >
                VNDB 搜索
              </SidebarBtn>
            </div>
          </DSection>
        </aside>
      </section>

      {/* 重新匹配元数据 modal — controlled by the More-menu item; passes the
          current `game` through so MetadataPicker pre-populates the search. */}
      <MetadataPicker game={pickerOpen ? game : null} onClose={onClosePicker} />
    </div>
  );
}

// ── Internals ────────────────────────────────────────────────────────────

function Pill({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 border border-line bg-black/35 px-2.5 font-mono text-[10.5px] text-ink-1",
        className,
      )}
      style={{ borderRadius: "9999px" }}
    >
      {children}
    </span>
  );
}

/**
 * Phase 11e — explicit "在 Bangumi 看 ↗" / "在 VNDB 看 ↗" pill in the hero
 * pills row. Uses the Phase-11 `openExternalUrl` IPC (which validates
 * scheme and shells out via `cmd /C start` on Windows).
 */
function ExtSourcePill({
  label,
  url,
  title,
}: {
  label: string;
  url: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        void openExternalUrl(url).catch((e: unknown) => {
          toast.error(`打开失败 — ${String(e)}`);
        });
      }}
      title={title}
      className="inline-flex h-6 cursor-pointer items-center gap-1.5 border border-line bg-black/35 px-2.5 font-mono text-[10.5px] text-ink-1 transition-colors hover:border-line-strong hover:bg-black/55 hover:text-brand"
      style={{ borderRadius: "9999px" }}
    >
      <span>{label}</span>
      <ExternalLink size={10} strokeWidth={2} className="opacity-70" />
    </button>
  );
}

/**
 * Phase 11e — clickable person chip in the 制作团队 section. For voice
 * roles it shows `角色 · 演员` so the user can read the CV→character
 * mapping at a glance; other roles fall back to the localized name.
 */
function PersonChip({
  row,
  onOpen,
}: {
  row: GameStaffRow;
  onOpen: () => void;
}) {
  const personName = row.name_cn ?? row.name;
  const label =
    row.role === "voice" && row.character_name
      ? `${row.character_name} · ${personName}`
      : personName;
  const altTitle =
    row.role === "voice" && row.character_name
      ? `${personName} · 饰 ${row.character_name}`
      : row.name_cn && row.name_cn !== row.name
        ? `${personName} · ${row.name}`
        : personName;
  return (
    <button
      type="button"
      onClick={onOpen}
      title={altTitle}
      className="inline-flex h-7 cursor-pointer items-center gap-1.5 border border-line bg-bg-1 px-2.5 font-serif text-[12px] text-ink-1 transition-colors hover:border-line-strong hover:bg-bg-2 hover:text-brand"
      style={{ borderRadius: "9999px" }}
    >
      <span className="truncate max-w-[220px]">{label}</span>
    </button>
  );
}

/**
 * Phase 11e — non-interactive chip showing one Bangumi/VNDB official tag
 * in the 官方标签 sidebar section. The `title` exposes source + weight so
 * the user can hover to see "bangumi · 234 用户".
 */
function OfficialTagChip({ row }: { row: OfficialTagRow }) {
  const sourceLabel = row.source === "bangumi" ? "bangumi" : "vndb";
  const weightLabel =
    row.source === "bangumi" ? `${row.weight} 用户` : `权重 ${row.weight}`;
  return (
    <span
      title={`${sourceLabel} · ${weightLabel}`}
      className="inline-flex items-center gap-1 border border-line bg-bg-2 px-2 py-[2px] text-[11px] text-ink-2"
      style={{ borderRadius: "9999px", cursor: "default" }}
    >
      <span>{row.tag_name}</span>
    </span>
  );
}

function ExtAnchor({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => openExternal(href)}
      className="inline-flex items-center gap-1 font-mono text-ink-1 underline decoration-line decoration-1 underline-offset-[3px] transition-colors hover:text-ink-0 hover:decoration-line-strong"
    >
      <span>{children}</span>
      <ExternalLink size={10} strokeWidth={2} className="opacity-50" />
    </button>
  );
}

function DTab({
  value,
  children,
}: {
  value: string;
  children: React.ReactNode;
}) {
  return (
    <TabsTrigger
      value={value}
      className="font-serif text-[12.5px] tracking-[0.04em] !rounded-none px-4 py-2.5 text-ink-2 data-active:text-ink-0"
    >
      {children}
    </TabsTrigger>
  );
}

function DSection({
  title,
  hint,
  children,
  className,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      <h2 className="mb-2.5 flex items-baseline justify-between gap-2 font-serif text-[16px] font-medium tracking-[0.04em] text-ink-1">
        <span>{title}</span>
        {hint ? (
          <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
            {hint}
          </span>
        ) : null}
      </h2>
      {children}
    </section>
  );
}

function DT({ children }: { children: React.ReactNode }) {
  return (
    <dt className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
      {children}
    </dt>
  );
}

function DD({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <dd className={cn("m-0 text-ink-1", className)}>{children}</dd>;
}

function ConfigField({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
        {label}
      </span>
      {children}
    </label>
  );
}

function SidebarBtn({
  icon,
  onClick,
  children,
}: {
  icon: React.ReactNode;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-7 items-center gap-1.5 border border-line bg-bg-1 px-2.5 font-mono text-[10.5px] text-ink-1 transition-colors hover:border-line-strong hover:bg-bg-2 hover:text-ink-0"
      style={{ borderRadius: "var(--r-sm)" }}
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}

function SessionsList({ sessions }: { sessions: SessionRow[] }) {
  const maxDuration = Math.max(...sessions.map((s) => s.duration_sec), 1);
  return (
    <div
      className="flex flex-col overflow-hidden bg-line"
      style={{ borderRadius: "var(--r-md)", gap: 1 }}
    >
      {sessions.map((s) => {
        const pct = (s.duration_sec / maxDuration) * 100;
        return (
          <div
            key={s.id}
            className="grid items-center gap-3 bg-bg-1 px-3.5 py-2 text-[12px]"
            style={{ gridTemplateColumns: "100px 1fr auto" }}
          >
            <span className="font-mono text-[11px] text-ink-2">
              {new Date(s.started_at).toLocaleString("zh-CN", {
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            <div className="min-w-0">
              <div className="font-serif text-[13px] text-ink-1">
                {statusBadgeText(s.status)}
              </div>
              <div className="relative mt-1 h-[4px] overflow-hidden bg-bg-3">
                <div
                  className="absolute left-0 top-0 h-full bg-brand"
                  style={{ width: `${pct}%`, borderRadius: 2 }}
                />
              </div>
            </div>
            <span className="font-mono text-[11px] text-ink-1">
              {formatSessionDuration(s.duration_sec)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
