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
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
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
  FolderTree,
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
import { SafeImage } from "@/components/common/SafeImage";
import { TagPicker } from "@/components/library/TagPicker";
import { ScreenshotsTab } from "@/components/library/ScreenshotsTab";
import { SavesTab } from "@/components/library/SavesTab";
import { LaunchButton } from "@/components/library/LaunchButton";
import {
  getGame,
  openGameDir,
  updateGameFavorite,
  updateGameNotes,
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
import {
  SubdirSplitDialog,
  gameHasUserData,
} from "@/components/library/SubdirSplitDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { refreshMetadata } from "@/lib/metadata";
import {
  addGamesToView,
  createCustomView,
  type CustomViewRow,
} from "@/lib/customViews";
import { getSidebarCategories } from "@/lib/search";

// Quick 260517-qnn — 启动方式收敛为两种：日区 LE 启动 / 直接启动。
// 旧的简中 / 繁中 / Custom LE profile 已废弃。
//   le-jp  → 经 Locale Emulator 启动（后端固定 ja-JP profile）
//   direct → 不经 LE，直接拉起 exe
// 持久化到 games.le_profile 这一自由 TEXT 列（后端 LE 路径忽略它的值，
// 始终用默认 ja-JP）：le-jp 存 "Japanese"，direct 存 "direct"。
type LaunchMethod = "le-jp" | "direct";

/**
 * Quick 260524-olt — label 由 t() 在使用点解析,这里保留 key 表。
 */
const LAUNCH_METHOD_LABEL_KEY: Record<LaunchMethod, string> = {
  "le-jp": "detail.launch.le_jp",
  direct: "detail.launch.direct",
};

/**
 * 把持久化的 le_profile 字符串映射回 LaunchMethod。
 * 规则：只有显式的 "direct" / "Direct" 哨兵值算「直接启动」；其余一切值
 * （"Japanese"、已废弃的 "Simplified Chinese" / "Traditional Chinese" /
 * "Custom"、空串等）一律回落到「日区 LE 启动」。这样此前用已删除 profile
 * 保存过的游戏也能平滑加载为日区 LE 启动，不会报错。
 */
function leProfileToMethod(saved: string | null | undefined): LaunchMethod {
  const v = (saved ?? "").trim().toLowerCase();
  return v === "direct" ? "direct" : "le-jp";
}

/** 把 LaunchMethod 映射回写入 le_profile 列的稳定哨兵值。 */
function methodToLeProfile(method: LaunchMethod): string {
  return method === "direct" ? "direct" : "Japanese";
}

const STATUS_OPTIONS: Array<{ value: Game["status"]; i18nKey: string }> = [
  { value: "unplayed", i18nKey: "detail.status.unplayed" },
  { value: "playing", i18nKey: "detail.status.playing" },
  { value: "cleared", i18nKey: "detail.status.cleared" },
  { value: "dropped", i18nKey: "detail.status.dropped" },
];

const STATUS_LABEL_KEY: Record<Game["status"], string> = {
  unplayed: "detail.status.unplayed",
  playing: "detail.status.playing",
  cleared: "detail.status.cleared",
  dropped: "detail.status.dropped",
};

const SCREENSHOT_INTERVAL_OPTIONS: Array<{ value: number; i18nKey: string }> = [
  { value: 60, i18nKey: "detail.screenshot.interval.60" },
  { value: 300, i18nKey: "detail.screenshot.interval.300" },
  { value: 600, i18nKey: "detail.screenshot.interval.600" },
  { value: 1800, i18nKey: "detail.screenshot.interval.1800" },
  { value: 0, i18nKey: "detail.screenshot.interval.0" },
];

function formatDuration(seconds: number): string {
  const totalMin = Math.floor(seconds / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? i18n.t("detail.duration.h_m", { h, m }) : i18n.t("detail.duration.m", { m });
}

function formatSessionDuration(seconds: number): string {
  if (seconds < 60) return i18n.t("detail.duration.s", { s: seconds });
  return formatDuration(seconds);
}

function statusBadgeText(status: SessionRow["status"]): string {
  switch (status) {
    case "completed":
      return i18n.t("detail.session_status.completed");
    case "running":
      return i18n.t("detail.session_status.running");
    case "starting":
      return i18n.t("detail.session_status.starting");
    case "cancelled":
      return i18n.t("detail.session_status.cancelled");
    case "launch_failed":
      return i18n.t("detail.session_status.launch_failed");
  }
}

/** Display order for staff role groups in 总览 → 制作团队. */
const STAFF_ROLE_ORDER: StaffRole[] = [
  "scenario",
  "artist",
  "voice",
  "music",
];

const STAFF_ROLE_LABEL_KEY: Record<StaffRole, string> = {
  scenario: "detail.role.scenario",
  artist: "detail.role.artist",
  voice: "detail.role.voice",
  music: "detail.role.music",
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
      toast.error(i18n.t("toast.staff_load_failed", { err: String(e) }));
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
      toast.error(i18n.t("toast.official_tag_load_failed", { err: String(e) }));
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
  const { t } = useTranslation();
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
  const advFilter = useLibraryStore((s) => s.advFilter);
  const setAdvFilter = useLibraryStore((s) => s.setAdvFilter);
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
        inserted > 0
          ? t("detail.menu.added_to_view", { name: viewName })
          : t("detail.menu.already_in_view", { name: viewName }),
      );
      await refreshSidebarFromDetail();
    } catch (e: unknown) {
      toast.error(t("toast.add_failed", { err: String(e) }));
    }
  }

  async function onCreateAndAddView() {
    if (!game) return;
    const name = window.prompt(t("detail.menu.new_view_prompt"))?.trim();
    if (!name) return;
    try {
      const newId = await createCustomView(name);
      await addGamesToView(newId, [game.id]);
      toast.success(t("detail.menu.created_view", { name }));
      await refreshSidebarFromDetail();
    } catch (e: unknown) {
      toast.error(t("toast.view_create_failed", { err: String(e) }));
    }
  }

  const [game, setGame] = useState<Game | null>(null);
  // Quick 260517-qnn — 启动方式（日区 LE / 直接启动）。沿用 profile 命名
  // 是为了把改动面收敛在 launch 相关代码内。
  const [launchMethod, setLaunchMethod] = useState<LaunchMethod>("le-jp");
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
  // Quick 260516-q3y —「整理子目录」拆分对话框 + 用户数据删除确认。
  const [splitOpen, setSplitOpen] = useState(false);
  const [splitConfirmOpen, setSplitConfirmOpen] = useState(false);
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
    // Single-row IPC (BL-02 fix): the previous `listGames().find(...)` pulled
    // the entire library on every mutation. Also upsert into the library
    // store so /library reflects the change without an extra round-trip.
    const g = await getGame(gameId);
    setGame(g);
    if (g) {
      useLibraryStore.getState().upsertGame(g);
      // Quick 260517-qnn — 把持久化的 le_profile 映射回两种启动方式之一。
      // 已废弃 profile（简中 / 繁中 / Custom）一律回落到「日区 LE 启动」。
      // 260526 — Game interface 已经包含 le_profile / launch_args / cwd，
      // 不再需要 `as Game & LaunchExtras` cast；直接读字段。
      setLaunchMethod(leProfileToMethod(g.le_profile));
      setArgs(g.launch_args ?? "");
      setCwd(g.cwd ?? "");
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
    // WR-11 guard: until refreshGame has loaded the cached game record for
    // the current gameId, the in-state `notes` still belongs to the previous
    // game; saving it now would overwrite the new game's notes with the
    // previous game's text (the closure captures the new gameId via deps).
    if (game?.id !== gameId) return;
    const timer = setTimeout(() => {
      setSavingNotes(true);
      updateGameNotes(gameId, notes)
        .then(() => setLastSavedAt(Date.now()))
        .catch((e: unknown) => {
          // eslint-disable-next-line no-console
          console.error("[Detail] updateGameNotes failed:", e);
          toast.error(t("toast.notes_save_failed", { err: String(e) }));
        })
        .finally(() => setSavingNotes(false));
    }, 800);
    return () => clearTimeout(timer);
  }, [notes, gameId, game?.id, t]);

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

  // Esc → back. Window-level listener with an explicit "any open dialog?"
  // guard — Radix Dialog primitives stopPropagation while they're OPEN, but
  // after a dialog closes the focus falls back to <body> and a subsequent
  // Esc would have been swallowed as an unwanted route navigation
  // (BL-04 in 260524 review). Querying for `[data-state="open"]` on any
  // dialog/menu/popover Radix primitive is the supported escape hatch.
  // Also skip when focus is inside an editable element so Esc-blur in
  // textareas (notes editor) still works normally.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // Any open Radix overlay? It will handle Esc itself.
      if (
        document.querySelector(
          '[role="dialog"][data-state="open"], [role="menu"][data-state="open"], [data-state="open"][data-radix-popper-content-wrapper]',
        )
      ) {
        return;
      }
      // Esc inside text input — let the browser/Radix handle blur.
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      ) {
        return;
      }
      navigate(-1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  if (!Number.isFinite(gameId)) {
    return <div className="p-8 font-mono text-[12px] text-ink-2">{t("detail.invalid_id")}</div>;
  }
  if (!game) {
    return (
      <div className="p-8 font-mono text-[12px] text-ink-2">{t("detail.loading")}</div>
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

  // Quick 260515-year — 年份跳筛选用「年代锚定」(year_decade)：
  // release_year=2008 → year_decade=2000 → 命中 2000-2009 全部作品。
  // 与 sidebar 的「按十年」分类同语义，跳过去后那一栏立刻是高亮的。
  function onYearCrumbClick() {
    if (!game?.release_year) return;
    const decade = Math.floor(game.release_year / 10) * 10;
    setFilter({ year_decade: decade });
    navigate("/");
  }

  // Quick 260524-dlr — 点击官方标签 chip 跳回图书馆并加入 advFilter.officialTags
  // 多选筛选（OR）。同一名字已经在筛选里就直接跳。
  function onOfficialTagJump(name: string) {
    const next = new Set(advFilter.officialTags);
    next.add(name);
    setAdvFilter({ ...advFilter, officialTags: next });
    navigate("/");
  }

  // Quick 260524-dlr — 点击用户「我的标签」chip 跳回图书馆并按该 tag_id 单标签
  // 筛选（走后端 SearchFilter.tag_id 路径，与 sidebar 同语义）。
  function onUserTagJump(tagId: number) {
    setFilter({ tag_id: tagId });
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
      toast.error(t("toast.op_failed", { err: String(e) }));
    }
  }

  async function onSetStatus(next: Game["status"]) {
    if (!game || next === game.status) return;
    try {
      await updateGameStatus(game.id, next);
      await refreshGame();
    } catch (e: unknown) {
      toast.error(t("toast.status_failed", { err: String(e) }));
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
        toast.info(t("toast.session_ended"));
      } catch (e: unknown) {
        toast.error(t("toast.session_end_failed", { err: String(e) }));
      }
      return;
    }
    if (otherActive) {
      toast.error(t("toast.has_active_game"));
      return;
    }
    if (!game) return;
    // 260526 Bug A 排查辅助 — 把 invoke 边界的入参/异常打到 Console，
    // 让无法在子代理里跑 GUI 的真机验证可以拿到第一手证据。toast.error 已经
    // 兜底了用户可见反馈，这里只补 console 一条结构化日志。
    // eslint-disable-next-line no-console
    console.info("[Detail] onLaunchClick start", {
      gameId,
      launchMethod,
      useLe: launchMethod === "le-jp",
      exePath: exePath.length > 0 ? exePath : "(use DB executable_path)",
      cwd: cwd.length > 0 ? cwd : "(auto = exe parent dir)",
      args,
    });
    try {
      await updateGameLaunchConfig(gameId, {
        le_profile: methodToLeProfile(launchMethod),
        launch_args: args,
        cwd: cwd.length > 0 ? cwd : undefined,
        executable_path: exePath.length > 0 ? exePath : undefined,
      });
      // Quick 260517-qnn — 日区 LE 启动经 Locale Emulator，直接启动不经 LE。
      await launchGame(gameId, launchMethod === "le-jp");
      // eslint-disable-next-line no-console
      console.info("[Detail] onLaunchClick spawn ok", { gameId });
      toastLaunchSuccess(
        displayName,
        launchMethod === "le-jp"
          ? t("detail.launch.le_jp_short")
          : t("detail.launch.direct_short"),
      );
    } catch (e: unknown) {
      // eslint-disable-next-line no-console
      console.error("[Detail] onLaunchClick failed:", e);
      toast.error(t("toast.launch_failed", { err: String(e) }));
    }
  }

  async function onSetScreenshotInterval(next: number) {
    try {
      await setScreenshotInterval(gameId, next);
      setScreenshotIntervalState(next);
      toast.success(t("toast.screenshot_interval_set"));
    } catch (e: unknown) {
      toast.error(t("toast.screenshot_interval_failed", { err: String(e) }));
    }
  }

  async function onPickExePath() {
    if (!game) return;
    try {
      const picked = await openDialog({
        multiple: false,
        directory: false,
        title: t("detail.config.pick_exe_title"),
        defaultPath: exePath.length > 0 ? exePath : game.path,
        filters: [{ name: "Executable", extensions: ["exe"] }],
      });
      if (typeof picked === "string" && picked.length > 0) {
        setExePath(picked);
      }
    } catch (e: unknown) {
      toast.error(t("toast.pick_exe_failed", { err: String(e) }));
    }
  }

  async function onSaveLaunchConfig() {
    if (!game) return;
    try {
      await updateGameLaunchConfig(gameId, {
        le_profile: methodToLeProfile(launchMethod),
        launch_args: args,
        cwd: cwd.length > 0 ? cwd : undefined,
        executable_path: exePath.length > 0 ? exePath : undefined,
      });
      toast.success(t("toast.config_saved"));
      await refreshGame();
    } catch (e: unknown) {
      toast.error(t("toast.save_failed", { err: String(e) }));
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
      toast.success(t("toast.cover_refreshed"));
    } catch (e: unknown) {
      toast.error(t("toast.cover_refresh_failed", { err: String(e) }));
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

  // Quick 260516-q3y —「整理子目录」入口. 带用户数据先弹删除确认 AlertDialog，
  // 无用户数据直接打开 SubdirSplitDialog。
  function onSplitSubdirs() {
    if (!game) return;
    if (gameHasUserData(game)) {
      setSplitConfirmOpen(true);
    } else {
      setSplitOpen(true);
    }
  }

  async function onCopyPath() {
    if (!game) return;
    try {
      await navigator.clipboard.writeText(game.path);
      toast.success(t("toast.copy_path_ok"));
    } catch (e: unknown) {
      toast.error(t("toast.copy_failed", { err: String(e) }));
    }
  }

  async function onOpenDir() {
    if (!game) return;
    try {
      await openGameDir(game.path);
    } catch (e: unknown) {
      toast.error(t("toast.open_dir_failed", { err: String(e) }));
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
    ? t("detail.notes_saving")
    : lastSavedSeconds != null
      ? t("detail.notes_saved", { seconds: lastSavedSeconds })
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
            <span>{t("detail.back")}</span>
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
              {t("detail.crumb_library")}
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
            aria-label={t("detail.prev")}
            title={t("detail.prev")}
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
            aria-label={t("detail.next")}
            title={t("detail.next")}
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
            <SafeImage
              src={coverSrc}
              alt={displayName}
              draggable={false}
              className="h-full w-full object-cover"
              fallback={
                <div className="flex h-full w-full items-center justify-center text-ink-3">
                  <ImageOff className="size-10" aria-hidden />
                </div>
              }
            />
          </div>

          {/* Info column */}
          <div className="min-w-0 pb-2">
            {(game.brand || game.release_year) && (
              <div className="mb-1.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-2">
                {game.brand ? (
                  <button
                    type="button"
                    onClick={onBrandCrumbClick}
                    className="cursor-pointer transition-colors hover:text-brand"
                    title={t("detail.brand_filter_tooltip", { name: game.brand })}
                  >
                    {game.brand}
                  </button>
                ) : null}
                {game.brand && game.release_year ? (
                  <span aria-hidden> · </span>
                ) : null}
                {game.release_year ? (
                  <button
                    type="button"
                    onClick={onYearCrumbClick}
                    className="cursor-pointer transition-colors hover:text-brand"
                    title={t("detail.year_filter_tooltip", { decade: Math.floor(game.release_year / 10) * 10 })}
                  >
                    {game.release_year}
                  </button>
                ) : null}
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
                {t(STATUS_LABEL_KEY[game.status])}
              </Pill>
              <Pill>{formatDuration(game.total_playtime_sec)}</Pill>
              {/* Quick 260525-g1m — 顶部 Pill 改读官方评分 external_rating，附带来源后缀；
                  NULL 时整个 Pill 不渲染（避免「★ — / 5」无意义占位）。 */}
              {game.external_rating != null ? (
                <Pill>
                  ★ {game.external_rating.toFixed(1)}
                  {game.external_rating_source ? (
                    <span className="ml-1 text-[10px] uppercase text-ink-3">
                      · {game.external_rating_source === "bangumi" ? "BGM" : "VNDB"}
                    </span>
                  ) : null}
                </Pill>
              ) : null}
              {reviewNeeded && (
                <Pill className="border-[#ffd166]/50 text-[#ffd166]">
                  <AlertTriangle size={11} strokeWidth={2} />
                  {t("detail.review_needed", { pct: game.match_confidence })}
                </Pill>
              )}
              {game.bangumi_id ? (
                <ExtSourcePill
                  label={t("detail.pill.see_on_bangumi")}
                  url={bangumiSubjectUrl(game.bangumi_id)}
                  title={t("detail.pill.see_on_bangumi_tooltip", { id: game.bangumi_id })}
                />
              ) : null}
              {game.vndb_id ? (
                <ExtSourcePill
                  label={t("detail.pill.see_on_vndb")}
                  url={vndbVnUrl(game.vndb_id)}
                  title={t("detail.pill.see_on_vndb_tooltip", { id: game.vndb_id })}
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
              title={game.is_favorite ? t("detail.unfavorite") : t("detail.favorite")}
              aria-label={t("detail.favorite")}
              className={cn(
                "grid h-9 w-9 place-items-center rounded-full border border-line bg-bg-1/80 transition-colors hover:bg-bg-2 backdrop-blur",
                game.is_favorite ? "text-rose-400" : "text-ink-2",
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
                  title={t("detail.more")}
                  aria-label={t("detail.more")}
                  className="grid h-9 w-9 place-items-center rounded-full border border-line bg-bg-1/80 text-ink-2 transition-colors hover:bg-bg-2 hover:text-ink-0 backdrop-blur"
                >
                  <MoreHorizontal size={15} strokeWidth={1.7} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                {/*
                  Quick 260519-21s — 菜单项一律用 Radix 的 `onSelect` 而非
                  `onClick`。根因见 GameCard.tsx 同名注释：用 `onClick` 时被点过的
                  菜单项（「打开本地目录」）会留下未被 Radix 清理的激活态，随后
                  「重新匹配元数据」打开 MetadataPicker 的 modal，Dialog 关闭时
                  把焦点甩回菜单触发元素重放该激活态，导致再弹一个文件管理器窗口。
                */}
                <DropdownMenuItem onSelect={() => void onOpenDir()}>
                  <FolderOpen size={14} className="mr-2" />
                  {t("detail.menu.open_dir")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void onCopyPath()}>
                  <Copy size={14} className="mr-2" />
                  {t("detail.menu.copy_path")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setPickerOpen(true)}>
                  <RefreshCw size={14} className="mr-2" />
                  {t("detail.menu.rematch")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={refreshingCover}
                  onSelect={() => void onRefreshCover()}
                >
                  <ImageDown size={14} className="mr-2" />
                  {t("detail.menu.refresh_cover")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onSplitSubdirs}>
                  <FolderTree size={14} className="mr-2" />
                  {t("detail.menu.split_subdirs")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>{t("detail.menu.add_to_view")}</DropdownMenuSubTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuSubContent>
                      {customViews.length === 0 && (
                        <DropdownMenuItem disabled>
                          <span className="text-ink-3">{t("detail.menu.no_views")}</span>
                        </DropdownMenuItem>
                      )}
                      {customViews.map((cv) => (
                        <DropdownMenuItem
                          key={cv.id}
                          onSelect={() => void onAddToView(cv.id, cv.name)}
                        >
                          {cv.name}
                          <span className="ml-auto font-mono text-[10px] text-ink-3">
                            {cv.count}
                          </span>
                        </DropdownMenuItem>
                      ))}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => void onCreateAndAddView()}>
                        {t("detail.menu.new_view")}
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuPortal>
                </DropdownMenuSub>
              </DropdownMenuContent>
            </DropdownMenu>
            <LaunchButton
              profile={launchMethod}
              onProfileChange={setLaunchMethod}
              onClick={() => void onLaunchClick()}
              isActive={isActive}
              disabled={launchDisabled}
              disabledTitle={
                noExe
                  ? t("detail.launch.disabled_no_exe")
                  : otherActive
                    ? t("detail.launch.disabled_other")
                    : undefined
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
              <DTab value="overview">{t("detail.tab.overview")}</DTab>
              <DTab value="notes">{t("detail.tab.notes")}</DTab>
              <DTab value="sessions">{t("detail.tab.sessions")}</DTab>
              <DTab value="screenshots">{t("detail.tab.screenshots")}</DTab>
              <DTab value="saves">{t("detail.tab.saves")}</DTab>
              <DTab value="config">{t("detail.tab.config")}</DTab>
            </TabsList>

            {/* 总览 */}
            <TabsContent value="overview" className="space-y-6 pt-1">
              {summaryParagraphs.length > 0 ? (
                <DSection title={t("detail.section.summary")}>
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
                <DSection title={t("detail.section.staff")}>
                  <div className="flex flex-col gap-4">
                    {staffGroups.map(({ role, items }) => {
                      const Icon = STAFF_ROLE_ICONS[role];
                      return (
                        <div key={role}>
                          <h3 className="mb-2 inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
                            <Icon size={11} strokeWidth={2} />
                            <span>{t(STAFF_ROLE_LABEL_KEY[role])}</span>
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

              <DSection title={t("detail.section.common_actions")}>
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
                          {t(s.i18nKey)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </DSection>
            </TabsContent>

            {/* 笔记 */}
            <TabsContent value="notes" className="space-y-2 pt-1">
              <DSection title={t("detail.section.notes")}>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={t("detail.section.notes_placeholder")}
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
                title={t("detail.section.sessions")}
                hint={t("detail.section.sessions_recent", { count: Math.min(sessions.length, 8) })}
              >
                {sessions.length === 0 ? (
                  <p className="font-mono text-[11.5px] text-ink-3">
                    {t("detail.section.sessions_empty")}
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
              <DSection title={t("detail.section.config")}>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <ConfigField label={t("detail.config.method")}>
                    <Select
                      value={launchMethod}
                      onValueChange={(v) => setLaunchMethod(v as LaunchMethod)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="le-jp">
                          {t(LAUNCH_METHOD_LABEL_KEY["le-jp"])}
                        </SelectItem>
                        <SelectItem value="direct">
                          {t(LAUNCH_METHOD_LABEL_KEY.direct)}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </ConfigField>
                  <ConfigField label={t("detail.config.args")}>
                    <Input
                      value={args}
                      onChange={(e) => setArgs(e.target.value)}
                      placeholder={t("detail.config.args_placeholder")}
                      className="font-mono bg-bg-2"
                    />
                  </ConfigField>
                  <ConfigField label={t("detail.config.cwd")} className="md:col-span-2">
                    <Input
                      value={cwd}
                      onChange={(e) => setCwd(e.target.value)}
                      placeholder={t("detail.config.cwd_placeholder")}
                      className="font-mono bg-bg-2"
                    />
                  </ConfigField>
                  <ConfigField
                    label={t("detail.config.exe")}
                    className="md:col-span-2"
                  >
                    <div className="flex items-center gap-2">
                      <Input
                        value={exePath}
                        onChange={(e) => setExePath(e.target.value)}
                        placeholder={t("detail.config.exe_placeholder")}
                        className="font-mono bg-bg-2 flex-1"
                      />
                      <button
                        type="button"
                        onClick={() => void onPickExePath()}
                        title={t("detail.config.exe_browse_tooltip")}
                        className="inline-flex h-8 flex-shrink-0 items-center gap-1.5 border border-line bg-bg-2 px-3 text-[12px] text-ink-1 transition-colors hover:border-line-strong hover:bg-bg-3 hover:text-ink-0"
                        style={{ borderRadius: "var(--r-md)" }}
                      >
                        <FolderOpen size={12} />
                        {t("detail.config.exe_browse")}
                      </button>
                    </div>
                  </ConfigField>
                  <ConfigField label={t("detail.config.screenshot_interval")}>
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
                            {t(opt.i18nKey)}
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
                    {t("detail.config.save")}
                  </button>
                </div>
              </DSection>
            </TabsContent>
          </Tabs>
        </div>

        {/* Right meta sidebar */}
        <aside className="border-l border-line pl-7">
          <DSection title={t("detail.section.info")}>
            <dl
              className="grid gap-x-3 gap-y-2 text-[12px]"
              style={{ gridTemplateColumns: "84px 1fr" }}
            >
              <DT>{t("detail.info.brand")}</DT>
              <DD>
                {game.brand ? (
                  <button
                    type="button"
                    onClick={onBrandCrumbClick}
                    className="cursor-pointer text-left transition-colors hover:text-brand"
                    title={t("detail.brand_filter_tooltip", { name: game.brand })}
                  >
                    {game.brand}
                  </button>
                ) : (
                  "—"
                )}
              </DD>
              <DT>{t("detail.info.year")}</DT>
              <DD>
                {game.release_year ? (
                  <button
                    type="button"
                    onClick={onYearCrumbClick}
                    className="cursor-pointer text-left transition-colors hover:text-brand"
                    title={t("detail.year_filter_tooltip", { decade: Math.floor(game.release_year / 10) * 10 })}
                  >
                    {game.release_year}
                  </button>
                ) : (
                  "—"
                )}
              </DD>
              <DT>{t("detail.info.status")}</DT>
              <DD>{t(STATUS_LABEL_KEY[game.status])}</DD>
              {/* Quick 260526-0bi — 本地用户评分 (games.rating) 已移除；
                  仅保留「官方评分」一行；NULL 时显示 — 占位。 */}
              <DT>{t("detail.info.external_rating")}</DT>
              <DD>
                {game.external_rating != null ? (
                  <>
                    ★ {game.external_rating.toFixed(1)} / 10
                    {game.external_rating_source ? (
                      <span className="ml-1 text-ink-3">
                        · {game.external_rating_source === "bangumi" ? "BGM" : "VNDB"}
                      </span>
                    ) : null}
                    {game.external_rating_count != null && game.external_rating_count > 0 ? (
                      <span className="ml-1 text-[10px] text-ink-3">
                        ({game.external_rating_count})
                      </span>
                    ) : null}
                  </>
                ) : (
                  <span className="text-ink-3">—</span>
                )}
              </DD>
              <DT>{t("detail.info.bgm")}</DT>
              <DD className="font-mono">
                {game.bangumi_id ? (
                  <ExtAnchor href={bangumiPageUrl(game.bangumi_id)}>
                    {game.bangumi_id}
                  </ExtAnchor>
                ) : (
                  <span className="text-ink-3">—</span>
                )}
              </DD>
              <DT>{t("detail.info.vndb")}</DT>
              <DD className="font-mono">
                {game.vndb_id ? (
                  <ExtAnchor href={vndbPageUrl(game.vndb_id)}>
                    {game.vndb_id}
                  </ExtAnchor>
                ) : (
                  <span className="text-ink-3">—</span>
                )}
              </DD>
              <DT>{t("detail.info.source")}</DT>
              <DD className="font-mono uppercase tracking-[0.06em]">
                {game.metadata_source ?? <span className="text-ink-3">none</span>}
              </DD>
            </dl>
          </DSection>

          <DSection
            title={t("detail.section.tags")}
            hint={t("detail.section.tags_count", { count: gameTags.length })}
            className="mt-6"
          >
            {gameTags.length === 0 ? (
              <p className="font-mono text-[11px] text-ink-3">{t("detail.section.tags_empty")}</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {gameTags.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => onUserTagJump(tag.id)}
                    title={t("detail.brand_filter_tooltip", { name: tag.name })}
                    className="inline-flex cursor-pointer items-center gap-1 border border-line bg-bg-1 px-2.5 py-[3px] text-[11px] text-ink-1 transition-colors hover:border-brand hover:bg-brand-soft hover:text-ink-0"
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
                  </button>
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
              title={t("detail.section.official_tags")}
              hint={t("detail.section.official_tags_count", { count: officialTags.length })}
              className="mt-6"
            >
              <div className="flex flex-wrap gap-1.5">
                {officialTags.map((t, i) => (
                  <OfficialTagChip
                    key={`${t.source}-${t.tag_name}-${i}`}
                    row={t}
                    onJump={onOfficialTagJump}
                  />
                ))}
              </div>
            </DSection>
          ) : null}

          <DSection title={t("detail.section.path")} className="mt-6">
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
                {t("detail.path.copy")}
              </SidebarBtn>
              {game.cover_url ? (
                <SidebarBtn
                  icon={<ExternalLink size={12} />}
                  onClick={() => openExternal(game.cover_url ?? "")}
                >
                  {t("detail.path.cover_source")}
                </SidebarBtn>
              ) : null}
            </div>
          </DSection>

          <DSection title={t("detail.section.search_sources")} className="mt-6">
            <p className="font-mono text-[10.5px] text-ink-3">
              {t("detail.section.search_sources_hint")}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <SidebarBtn
                icon={<Search size={12} />}
                onClick={() => openExternal(bangumiSearchUrl(game.name))}
              >
                {t("detail.search.bangumi")}
              </SidebarBtn>
              <SidebarBtn
                icon={<Search size={12} />}
                onClick={() => openExternal(vndbSearchUrl(game.name))}
              >
                {t("detail.search.vndb")}
              </SidebarBtn>
            </div>
          </DSection>
        </aside>
      </section>

      {/* 重新匹配元数据 modal — controlled by the More-menu item; passes the
          current `game` through so MetadataPicker pre-populates the search. */}
      <MetadataPicker game={pickerOpen ? game : null} onClose={onClosePicker} />

      {/* Quick 260516-q3y —「整理子目录」拆分对话框. 拆分成功后原条目被删，
          Detail 的 game 已失效 → 导航回库首页。 */}
      <SubdirSplitDialog
        game={splitOpen ? game : null}
        onClose={() => setSplitOpen(false)}
        onSplit={() => {
          setSplitOpen(false);
          navigate("/");
        }}
      />

      {/* Quick 260516-q3y — 带用户数据条目的拆分前删除确认 */}
      <AlertDialog
        open={splitConfirmOpen}
        onOpenChange={(o) => setSplitConfirmOpen(o)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("library.split_confirm.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("library.split_confirm.desc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setSplitConfirmOpen(false)}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setSplitConfirmOpen(false);
                setSplitOpen(true);
              }}
            >
              {t("library.split_confirm.action")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
          toast.error(i18n.t("toast.open_external_failed", { err: String(e) }));
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
      ? i18n.t("detail.role.voice_alt", { person: personName, character: row.character_name })
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
 * Phase 11e — chip showing one Bangumi/VNDB official tag in the 官方标签
 * sidebar section. The `title` exposes source + weight so the user can
 * hover to see "bangumi · 234 用户 — 点击筛选".
 *
 * Quick 260524-dlr — 标签可点击跳转图书馆并加入 advFilter.officialTags（OR）。
 */
function OfficialTagChip({
  row,
  onJump,
}: {
  row: OfficialTagRow;
  onJump: (name: string) => void;
}) {
  const sourceLabel = row.source === "bangumi" ? "bangumi" : "vndb";
  const weightLabel =
    row.source === "bangumi"
      ? i18n.t("detail.officialtag.bangumi_weight", { n: row.weight })
      : i18n.t("detail.officialtag.vndb_weight", { n: row.weight });
  return (
    <button
      type="button"
      onClick={() => onJump(row.tag_name)}
      title={i18n.t("detail.officialtag.tooltip", { source: sourceLabel, weight: weightLabel })}
      className="inline-flex cursor-pointer items-center gap-1 border border-line bg-bg-2 px-2 py-[2px] text-[11px] text-ink-2 transition-colors hover:border-brand hover:bg-brand-soft hover:text-ink-0"
      style={{ borderRadius: "9999px" }}
    >
      <span>{row.tag_name}</span>
    </button>
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
