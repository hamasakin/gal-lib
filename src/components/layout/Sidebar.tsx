/**
 * Sidebar — left rail navigation.
 *
 * Structure (v1.4 redesign — Quick 20260512e):
 *   ScrollArea (主区)
 *     图书馆      · 图书馆全景 · 收藏夹 · 扫描复核(badge)
 *     通关状态    · 游玩中 · 已通关 · 未开始 · 弃坑
 *     我的视图    · custom_views… (＋ 新建)
 *     自定义标签  · # tag…
 *   底部固定区 (border-t)
 *     · 游玩统计 · 截图集 · 设置
 *
 * 已移除：品牌·厂牌 / 发行年份 — 这些与 toolbar 上 FilterPanel 的多维筛选完全
 * 重叠，旧的 `filter.brand` / `filter.year_decade` 单字段筛选不再从这里进入
 * （后端字段保留，FilterChip 仍能显示兜底）。
 *
 * 行为不变：单击 leaf REPLACES filter slice；"全部" 同时清空 searchQuery；
 * 跨路由点击会先 navigate("/")。
 */

import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  BarChart3,
  Bookmark,
  Heart,
  Image as ImageIcon,
  Library as LibraryIcon,
  Plus,
  Settings as SettingsIcon,
  Trash2,
  Pencil,
  SearchCheck,
} from "lucide-react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import { useLibraryStore } from "@/store/library";
import { usePreferencesStore } from "@/store/preferences";
import { getSidebarCategories } from "@/lib/search";
import { listTags } from "@/lib/tags";
import { getScanKpis } from "@/lib/scan";
import {
  createCustomView,
  deleteCustomView,
  renameCustomView,
} from "@/lib/customViews";
import type { SearchFilter } from "@/lib/search";

const STATUS_DISPLAY: Array<{
  value: "unplayed" | "playing" | "cleared" | "dropped";
  label: string;
  dotClass: string;
}> = [
  { value: "playing", label: "游玩中", dotClass: "bg-brand" },
  { value: "cleared", label: "已通关", dotClass: "bg-[#6fd1c8]" },
  { value: "unplayed", label: "未开始", dotClass: "bg-ink-stamp" },
  { value: "dropped", label: "弃坑", dotClass: "bg-ink-2" },
];

type SidebarRowIcon = React.ComponentType<{ size?: number; strokeWidth?: number }>;

export function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const isSettingsActive = location.pathname === "/settings";
  const isStatsActive = location.pathname === "/stats";
  const isScreenshotsActive = location.pathname === "/screenshots";
  const isScanActive = location.pathname === "/scan";

  // Phase 12 — sidebar pulse-dot showing review_pending count. Refetched on
  // mount + after scan-progress terminal events + after meta-fetch-progress
  // finished (debounced 600ms) so the badge tracks actual queue state.
  const [reviewPending, setReviewPending] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let pendingTimer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      getScanKpis()
        .then((k) => {
          if (!cancelled) setReviewPending(k.review_pending);
        })
        .catch(() => {
          /* non-fatal */
        });
    };
    refresh();
    const debounced = () => {
      if (pendingTimer) clearTimeout(pendingTimer);
      pendingTimer = setTimeout(refresh, 600);
    };
    let unlistenA: UnlistenFn | null = null;
    let unlistenB: UnlistenFn | null = null;
    listen("scan-progress", debounced).then((fn) => {
      unlistenA = fn;
    });
    listen("meta-fetch-progress", debounced).then((fn) => {
      unlistenB = fn;
    });
    return () => {
      cancelled = true;
      if (pendingTimer) clearTimeout(pendingTimer);
      unlistenA?.();
      unlistenB?.();
    };
  }, []);

  const sidebar = useLibraryStore((s) => s.sidebar);
  const setSidebar = useLibraryStore((s) => s.setSidebar);
  const setTags = useLibraryStore((s) => s.setTags);
  const filter = useLibraryStore((s) => s.filter);
  const setFilter = useLibraryStore((s) => s.setFilter);
  const setSearchQuery = useLibraryStore((s) => s.setSearchQuery);
  const totalGames = useLibraryStore((s) => s.games.length);

  const sidebarMode = usePreferencesStore((s) => s.sidebar);
  const isIconMode = sidebarMode === "icon";

  useEffect(() => {
    getSidebarCategories()
      .then(setSidebar)
      .catch((e: unknown) => {
        // eslint-disable-next-line no-console
        console.error("[Sidebar] getSidebarCategories failed:", e);
      });
    listTags()
      .then(setTags)
      .catch((e: unknown) => {
        // eslint-disable-next-line no-console
        console.error("[Sidebar] listTags failed:", e);
      });
  }, [setSidebar, setTags]);

  function applyFilter(next: SearchFilter) {
    if (location.pathname !== "/") {
      navigate("/");
    }
    setFilter(next);
  }

  function resetAll() {
    if (location.pathname !== "/") {
      navigate("/");
    }
    setFilter({});
    setSearchQuery("");
  }

  const filterEmpty =
    filter.tag_id == null &&
    filter.status == null &&
    !filter.favorite &&
    filter.brand == null &&
    filter.year_decade == null &&
    filter.custom_view_id == null;

  const onLibraryRoute = location.pathname === "/";
  const isAllActive = onLibraryRoute && filterEmpty;
  const isFavoriteActive =
    onLibraryRoute &&
    filter.favorite === true &&
    filter.tag_id == null &&
    filter.status == null &&
    filter.brand == null &&
    filter.year_decade == null &&
    filter.custom_view_id == null;

  function isStatusActive(status: string): boolean {
    return (
      onLibraryRoute &&
      filter.status === status &&
      filter.tag_id == null &&
      !filter.favorite &&
      filter.brand == null &&
      filter.year_decade == null &&
      filter.custom_view_id == null
    );
  }

  function isTagActive(tagId: number): boolean {
    return (
      onLibraryRoute &&
      filter.tag_id === tagId &&
      filter.status == null &&
      !filter.favorite &&
      filter.brand == null &&
      filter.year_decade == null &&
      filter.custom_view_id == null
    );
  }

  function isCustomViewActive(viewId: number): boolean {
    return (
      onLibraryRoute &&
      filter.custom_view_id === viewId &&
      filter.tag_id == null &&
      filter.status == null &&
      !filter.favorite &&
      filter.brand == null &&
      filter.year_decade == null
    );
  }

  // Quick 20260510b — track inline-rename state for one view at a time.
  const [renamingViewId, setRenamingViewId] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState<string>("");

  async function refreshSidebar() {
    try {
      const cats = await getSidebarCategories();
      setSidebar(cats);
    } catch (e: unknown) {
      // eslint-disable-next-line no-console
      console.error("[Sidebar] refresh failed:", e);
    }
  }

  async function onCreateView() {
    const name = window.prompt("视图名称")?.trim();
    if (!name) return;
    try {
      const id = await createCustomView(name);
      await refreshSidebar();
      // Auto-navigate to the new view so the user sees it active.
      applyFilter({ custom_view_id: id });
      toast.success(`已创建视图「${name}」`);
    } catch (e: unknown) {
      toast.error(`创建失败 — ${String(e)}`);
    }
  }

  function onStartRename(id: number, currentName: string) {
    setRenamingViewId(id);
    setRenameDraft(currentName);
  }

  async function onCommitRename(id: number) {
    const name = renameDraft.trim();
    setRenamingViewId(null);
    if (!name) return;
    try {
      await renameCustomView(id, name);
      await refreshSidebar();
      toast.success("已重命名");
    } catch (e: unknown) {
      toast.error(`重命名失败 — ${String(e)}`);
    }
  }

  async function onDeleteView(id: number, name: string) {
    if (!window.confirm(`确定删除视图「${name}」？视图内的游戏不会被删除。`)) return;
    try {
      await deleteCustomView(id);
      // If the active filter was this view, reset to all.
      if (filter.custom_view_id === id) {
        setFilter({});
      }
      await refreshSidebar();
      toast.success("已删除视图");
    } catch (e: unknown) {
      toast.error(`删除失败 — ${String(e)}`);
    }
  }

  return (
    <aside
      className="flex h-full shrink-0 flex-col border-r border-line bg-bg-1"
      style={{ width: "var(--sidebar-w, 248px)" }}
      data-icon-mode={isIconMode || undefined}
    >
      <ScrollArea className="flex-1">
        <div className="flex flex-col py-2">
          {!isIconMode && <SectionLabel>图书馆</SectionLabel>}
          <SidebarRow
            label="图书馆全景"
            icon={LibraryIcon}
            count={totalGames}
            active={isAllActive}
            onClick={resetAll}
            iconMode={isIconMode}
          />
          <SidebarRow
            label="收藏夹"
            icon={Heart}
            count={sidebar?.favorite_count ?? 0}
            active={isFavoriteActive}
            onClick={() => applyFilter({ favorite: true })}
            iconMode={isIconMode}
          />
          <SidebarRow
            label="扫描复核"
            icon={SearchCheck}
            count={reviewPending > 0 ? reviewPending : undefined}
            badge={reviewPending > 0}
            active={isScanActive}
            onClick={() => navigate("/scan")}
            iconMode={isIconMode}
          />

          {!isIconMode && <SectionLabel>通关状态</SectionLabel>}
          {isIconMode && <div aria-hidden className="mx-3 my-2 h-px bg-line" />}
          {STATUS_DISPLAY.map(({ value, label, dotClass }) => {
            const count =
              sidebar?.statuses.find((s) => s.status === value)?.count ?? 0;
            return (
              <SidebarRow
                key={value}
                label={label}
                count={count}
                active={isStatusActive(value)}
                onClick={() => applyFilter({ status: value })}
                statusDotClass={dotClass}
                iconMode={isIconMode}
              />
            );
          })}

          {/* 我的视图 — 用户自定义视图（custom views）。右键菜单可重命名/删除；
              section header 的 ＋ 直接新建。 */}
          {!isIconMode && (
            <>
              <div className="flex items-center justify-between pr-3">
                <SectionLabel>我的视图</SectionLabel>
                <button
                  type="button"
                  onClick={() => void onCreateView()}
                  className="grid h-5 w-5 place-items-center text-ink-3 transition-colors hover:bg-bg-2 hover:text-ink-0"
                  style={{ borderRadius: "var(--r-sm)" }}
                  title="新建视图"
                  aria-label="新建视图"
                >
                  <Plus size={11} strokeWidth={1.7} />
                </button>
              </div>
              {(sidebar?.custom_views ?? []).length === 0 && (
                <div className="px-[18px] pb-1 font-mono text-[10px] text-ink-3 select-none">
                  还没有视图
                </div>
              )}
              {(sidebar?.custom_views ?? []).map((cv) => (
                <ContextMenu key={`cv-${cv.id}`}>
                  <ContextMenuTrigger asChild>
                    <div>
                      {renamingViewId === cv.id ? (
                        <div className="mx-2 px-3.5 py-1">
                          <input
                            type="text"
                            autoFocus
                            value={renameDraft}
                            onChange={(e) => setRenameDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                void onCommitRename(cv.id);
                              } else if (e.key === "Escape") {
                                setRenamingViewId(null);
                              }
                            }}
                            onBlur={() => void onCommitRename(cv.id)}
                            className="h-7 w-full border border-line-strong bg-bg-2 px-2 text-[12.5px] text-ink-0 outline-none"
                            style={{ borderRadius: "var(--r-sm)" }}
                          />
                        </div>
                      ) : (
                        <SidebarRow
                          label={cv.name}
                          icon={Bookmark}
                          count={cv.count}
                          active={isCustomViewActive(cv.id)}
                          onClick={() => applyFilter({ custom_view_id: cv.id })}
                        />
                      )}
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="w-40">
                    <ContextMenuItem
                      onClick={() => onStartRename(cv.id, cv.name)}
                    >
                      <Pencil size={13} className="mr-2" />
                      重命名
                    </ContextMenuItem>
                    <ContextMenuItem
                      onClick={() => void onDeleteView(cv.id, cv.name)}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 size={13} className="mr-2" />
                      删除视图
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              ))}
            </>
          )}

          {!isIconMode && (sidebar?.tags ?? []).length > 0 && (
            <>
              <SectionLabel>自定义标签</SectionLabel>
              {sidebar!.tags.map(({ tag, count }) => (
                <SidebarRow
                  key={`t-${tag.id}`}
                  label={`# ${tag.name}`}
                  count={count}
                  active={isTagActive(tag.id)}
                  onClick={() => applyFilter({ tag_id: tag.id })}
                />
              ))}
            </>
          )}
        </div>
      </ScrollArea>

      {/* 底部固定导航 — 次要页面入口，不参与筛选，不随主区滚动 */}
      <div className="flex shrink-0 flex-col border-t border-line py-1.5">
        <SidebarRow
          label="游玩统计"
          icon={BarChart3}
          active={isStatsActive}
          onClick={() => navigate("/stats")}
          iconMode={isIconMode}
        />
        <SidebarRow
          label="截图集"
          icon={ImageIcon}
          active={isScreenshotsActive}
          onClick={() => navigate("/screenshots")}
          iconMode={isIconMode}
        />
        <SidebarRow
          label="设置"
          icon={SettingsIcon}
          active={isSettingsActive}
          onClick={() => navigate("/settings")}
          iconMode={isIconMode}
        />
      </div>
    </aside>
  );
}

// ── Internals ────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="px-[18px] pt-[14px] pb-1 font-mono text-[9.5px] uppercase tracking-[0.14em] text-ink-3 select-none"
    >
      {children}
    </div>
  );
}

interface SidebarRowProps {
  label: string;
  count?: number;
  /** Status dot variant (renders 6px colored square left of label). */
  statusDotClass?: string;
  /** Lucide icon for icon-only mode (and as a leading glyph in normal mode). */
  icon?: SidebarRowIcon;
  active?: boolean;
  onClick: () => void;
  /** When true, render as 40px square icon button with tooltip via `title`. */
  iconMode?: boolean;
  /** Phase 12 — accent the count pill (used for scan review-pending pulse). */
  badge?: boolean;
}

function SidebarRow({
  label,
  count,
  statusDotClass,
  icon: Icon,
  active,
  onClick,
  iconMode,
  badge,
}: SidebarRowProps) {
  // Icon-only mode — 40px square anchored row, tooltip via title attr.
  if (iconMode) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-current={active ? "page" : undefined}
        title={count != null ? `${label} · ${count}` : label}
        aria-label={label}
        className={cn(
          "relative grid h-10 w-full place-items-center text-ink-2 transition-colors",
          "border-l-2 border-transparent",
          active
            ? "border-l-brand bg-brand-soft text-brand"
            : "hover:bg-bg-2 hover:text-ink-0",
        )}
      >
        {Icon ? (
          <Icon size={17} strokeWidth={1.6} />
        ) : statusDotClass ? (
          <span
            aria-hidden
            className={cn("h-2 w-2", statusDotClass)}
            style={{ borderRadius: "var(--r-sm)" }}
          />
        ) : (
          <span className="font-serif text-[14px] text-ink-1">
            {label.replace(/^# /, "").charAt(0)}
          </span>
        )}
        {count != null && count > 0 && (
          <span
            aria-hidden
            className="absolute right-1.5 top-1.5 font-mono text-[8px] text-ink-3"
          >
            {count}
          </span>
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "mx-2 flex items-center gap-2.5 px-3.5 py-1.5 text-left transition-colors duration-100",
        "text-[12.5px] text-ink-1",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand",
        active
          ? "bg-brand-soft text-ink-0"
          : "hover:bg-bg-2 hover:text-ink-0",
      )}
      style={{ borderRadius: "var(--r-md)" }}
    >
      {statusDotClass && (
        <span
          aria-hidden
          className={cn("h-1.5 w-1.5 flex-shrink-0", statusDotClass)}
          style={{ borderRadius: "var(--r-sm)" }}
        />
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count != null && (
        <span
          className={cn(
            "font-mono text-[10.5px] tabular-nums",
            badge
              ? "border border-brand/40 bg-brand-soft px-1.5 py-px text-brand"
              : active
                ? "text-ink-0"
                : "text-ink-3",
          )}
          style={badge ? { borderRadius: "9999px" } : undefined}
        >
          {count}
        </span>
      )}
    </button>
  );
}
