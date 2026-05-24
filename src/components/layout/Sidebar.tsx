/**
 * Sidebar — left rail navigation.
 *
 * Structure (Quick 20260512f):
 *   ScrollArea (主区)
 *     图书馆      · 全景 · 收藏夹 · 扫描复核(badge)
 *     通关状态    · 游玩中 · 已通关 · 未开始 · 弃坑
 *     我的视图    · custom_views… (＋ 新建，hover ⋯ 操作)
 *     自定义标签  · # tag…
 *   底部固定区 (border-t)
 *     · 游玩统计 · 截图集 · 设置
 *
 * 视觉契约：
 *   - SectionLabel：左缘 6px 印章红短线 + mono uppercase 9.5px tracking 0.16em
 *   - 行：32px 高，gap 2.5，active 态左 2px brand 实线 + brand-soft 底
 *   - 自定义视图行 hover 显示 ⋯ 按钮（重命名/删除内联触发，不必右键）
 *   - 新建/重命名/删除走 ViewNameDialog + DeleteViewDialog，而非 window.prompt
 *
 * 行为不变：单击 leaf REPLACES filter slice；"全部" 同时清空 searchQuery；
 * 跨路由点击会先 navigate("/")。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  BarChart3,
  Bookmark,
  Heart,
  Image as ImageIcon,
  Library as LibraryIcon,
  MoreHorizontal,
  Pencil,
  Plus,
  SearchCheck,
  Settings as SettingsIcon,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useTauriListen } from "@/hooks/useTauriListen";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import {
  ViewNameDialog,
  type ViewNameDialogMode,
} from "@/components/library/ViewNameDialog";
import {
  DeleteViewDialog,
  type DeleteViewTarget,
} from "@/components/library/DeleteViewDialog";

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
  const cancelledRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(() => {
    getScanKpis()
      .then((k) => {
        if (!cancelledRef.current) setReviewPending(k.review_pending);
      })
      .catch(() => {
        /* non-fatal */
      });
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    refresh();
    return () => {
      cancelledRef.current = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [refresh]);

  const debouncedRefresh = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(refresh, 600);
  }, [refresh]);

  useTauriListen("scan-progress", debouncedRefresh);
  useTauriListen("meta-fetch-progress", debouncedRefresh);

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

  async function refreshSidebar() {
    try {
      const cats = await getSidebarCategories();
      setSidebar(cats);
    } catch (e: unknown) {
      // eslint-disable-next-line no-console
      console.error("[Sidebar] refresh failed:", e);
    }
  }

  // ── Dialog state ─────────────────────────────────────────────────────
  const [viewDialog, setViewDialog] = useState<
    | { mode: ViewNameDialogMode; viewId?: number }
    | null
  >(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteViewTarget | null>(null);

  function openCreateView() {
    setViewDialog({ mode: { kind: "create" } });
  }
  function openRenameView(id: number, currentName: string) {
    setViewDialog({ mode: { kind: "rename", initial: currentName }, viewId: id });
  }

  async function handleViewSubmit(name: string) {
    if (!viewDialog) return;
    if (viewDialog.mode.kind === "create") {
      try {
        const id = await createCustomView(name);
        await refreshSidebar();
        applyFilter({ custom_view_id: id });
        toast.success(`已创建视图「${name}」`);
      } catch (e: unknown) {
        toast.error(`创建失败 — ${String(e)}`);
      }
    } else {
      const id = viewDialog.viewId;
      if (id == null) return;
      try {
        await renameCustomView(id, name);
        await refreshSidebar();
        toast.success("已重命名");
      } catch (e: unknown) {
        toast.error(`重命名失败 — ${String(e)}`);
      }
    }
  }

  async function handleDeleteConfirm(target: DeleteViewTarget) {
    try {
      await deleteCustomView(target.id);
      if (filter.custom_view_id === target.id) {
        setFilter({});
      }
      await refreshSidebar();
      toast.success(`已删除视图「${target.name}」`);
    } catch (e: unknown) {
      toast.error(`删除失败 — ${String(e)}`);
    }
  }

  return (
    <>
      <aside
        className="flex h-full shrink-0 flex-col border-r border-line bg-bg-1"
        style={{ width: "var(--sidebar-w, 248px)" }}
        data-icon-mode={isIconMode || undefined}
      >
        <ScrollArea className="flex-1">
          <div className="flex flex-col pb-3 pt-1.5">
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

            {/* 我的视图 — 用户自定义集合。+ 按钮新建；行 hover 露出 ⋯ 操作 */}
            {!isIconMode && (
              <>
                <SectionLabel
                  action={
                    <button
                      type="button"
                      onClick={openCreateView}
                      className={cn(
                        "grid h-5 w-5 place-items-center text-ink-3 transition-colors",
                        "hover:bg-bg-2 hover:text-ink-0",
                      )}
                      style={{ borderRadius: "var(--r-sm)" }}
                      title="新建视图"
                      aria-label="新建视图"
                    >
                      <Plus size={11} strokeWidth={1.8} />
                    </button>
                  }
                >
                  我的视图
                </SectionLabel>

                {(sidebar?.custom_views ?? []).length === 0 ? (
                  <button
                    type="button"
                    onClick={openCreateView}
                    className={cn(
                      "mx-2 mt-1 flex h-[60px] flex-col items-center justify-center gap-1 border border-dashed border-line bg-bg-2/40 px-3 transition-colors",
                      "hover:border-brand hover:bg-brand-soft hover:text-ink-0",
                    )}
                    style={{ borderRadius: "var(--r-sm)" }}
                  >
                    <Plus size={14} strokeWidth={1.7} className="text-ink-3" />
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
                      新建第一个视图
                    </span>
                  </button>
                ) : (
                  (sidebar?.custom_views ?? []).map((cv) => (
                    <CustomViewRow
                      key={`cv-${cv.id}`}
                      id={cv.id}
                      name={cv.name}
                      count={cv.count}
                      active={isCustomViewActive(cv.id)}
                      onClick={() => applyFilter({ custom_view_id: cv.id })}
                      onRename={() => openRenameView(cv.id, cv.name)}
                      onDelete={() =>
                        setDeleteTarget({ id: cv.id, name: cv.name, count: cv.count })
                      }
                    />
                  ))
                )}
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

      <ViewNameDialog
        mode={viewDialog?.mode ?? null}
        onClose={() => setViewDialog(null)}
        onSubmit={handleViewSubmit}
      />
      <DeleteViewDialog
        target={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
      />
    </>
  );
}

// ── Internals ────────────────────────────────────────────────────────────

function SectionLabel({
  children,
  action,
}: {
  children: React.ReactNode;
  /** 可选的右侧操作槽（如 + 新建按钮），与标题在同一行 baseline 对齐。 */
  action?: React.ReactNode;
}) {
  return (
    <div className="mt-3 mb-1 flex items-center justify-between pr-2.5 pl-3 select-none">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="block h-[2px] w-2.5"
          style={{ background: "var(--ink-stamp)" }}
        />
        <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-ink-3">
          {children}
        </span>
      </div>
      {action}
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
        "group relative mx-2 flex h-8 items-center gap-2.5 pl-3 pr-2.5 text-left transition-colors",
        "text-[12.5px] text-ink-1",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand",
        active ? "bg-brand-soft text-ink-0" : "hover:bg-bg-2 hover:text-ink-0",
      )}
      style={{ borderRadius: "var(--r-sm)" }}
    >
      {/* active 态左缘 2px brand 实线 — 用伪元素省一层 div */}
      {active && (
        <span
          aria-hidden
          className="absolute inset-y-1 left-0 w-[2px] bg-brand"
          style={{ borderRadius: "1px" }}
        />
      )}
      {Icon ? (
        <Icon
          size={14}
          strokeWidth={1.6}
          // @ts-expect-error lucide icon accepts className via props spread
          className={cn("shrink-0", active ? "text-brand" : "text-ink-2 group-hover:text-ink-1")}
        />
      ) : statusDotClass ? (
        <span
          aria-hidden
          className={cn("h-1.5 w-1.5 shrink-0", statusDotClass)}
          style={{ borderRadius: "var(--r-sm)" }}
        />
      ) : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count != null && (
        <span
          className={cn(
            "shrink-0 font-mono text-[10.5px] tabular-nums",
            badge
              ? "border border-brand/40 bg-brand-soft px-1.5 py-[1px] text-brand"
              : active
                ? "text-ink-0"
                : "text-ink-3 group-hover:text-ink-2",
          )}
          style={badge ? { borderRadius: "9999px" } : undefined}
        >
          {count}
        </span>
      )}
    </button>
  );
}

/**
 * Custom view row — 与 SidebarRow 同视觉规范，差异：
 *   - 始终带 Bookmark 图标
 *   - hover 时露出 ⋯ DropdownMenu 触发器（重命名 / 删除）
 *   - 数字与 ⋯ 互斥显示：hover 隐数字，露 ⋯；非 hover 显数字
 */
function CustomViewRow({
  name,
  count,
  active,
  onClick,
  onRename,
  onDelete,
}: {
  id: number;
  name: string;
  count: number;
  active: boolean;
  onClick: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={cn(
        "group relative mx-2 flex h-8 items-center gap-2.5 pl-3 pr-1.5 transition-colors",
        active ? "bg-brand-soft text-ink-0" : "text-ink-1 hover:bg-bg-2 hover:text-ink-0",
      )}
      style={{ borderRadius: "var(--r-sm)" }}
    >
      {active && (
        <span
          aria-hidden
          className="absolute inset-y-1 left-0 w-[2px] bg-brand"
          style={{ borderRadius: "1px" }}
        />
      )}
      <button
        type="button"
        onClick={onClick}
        aria-current={active ? "page" : undefined}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left text-[12.5px] focus-visible:outline-none"
      >
        <Bookmark
          size={13}
          strokeWidth={1.6}
          className={cn(
            "shrink-0",
            active ? "text-brand" : "text-ink-2 group-hover:text-ink-1",
          )}
        />
        <span className="min-w-0 flex-1 truncate">{name}</span>
      </button>
      <span
        className={cn(
          "shrink-0 font-mono text-[10.5px] tabular-nums transition-opacity",
          "group-hover:opacity-0",
          active ? "text-ink-0" : "text-ink-3",
        )}
      >
        {count}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`视图操作 — ${name}`}
            className={cn(
              "absolute right-1.5 grid h-6 w-6 place-items-center text-ink-2 opacity-0 transition-opacity",
              "group-hover:opacity-100 hover:bg-bg-3 hover:text-ink-0",
              "data-[state=open]:opacity-100 data-[state=open]:bg-bg-3 data-[state=open]:text-ink-0",
              "focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand",
            )}
            style={{ borderRadius: "var(--r-sm)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal size={13} strokeWidth={1.8} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-36">
          <DropdownMenuItem onClick={onRename}>
            <Pencil size={13} className="mr-2" />
            重命名
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={onDelete}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 size={13} className="mr-2" />
            删除视图
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
