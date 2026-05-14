/**
 * GameCard — single library tile.
 *
 * v1.1 "library card" aesthetic:
 *   - 3:4 cover with --shadow-card; hover: -4px translate + --shadow-lift
 *   - Top-left: 「藏书章」mono uppercase status stamp (5 colors)
 *   - Top-right: heart-fill favorite mark (only when favorited; brand-colored)
 *   - Bottom-left: at most one of 获取中 / 待复核 / 无 EXE
 *     (precedence pending > review-needed > no-exe)
 *   - Hover overlay: linear gradient bottom + 30px circular play icon (bottom-right)
 *   - Title: serif font, 13.5px, line-clamp-2
 *   - Sub-row: brand + sep dot + mono playtime
 *
 * Logic preserved from v1.0:
 *   - Click → navigate(/games/:id)
 *   - Right-click → ContextMenu (launch / 强制结束 / 收藏 toggle / status / 元数据)
 *   - Single-session lock: when another game is active, launch hidden
 */

import { memo } from "react";
import { Heart, ImageOff, Loader2, Play, Square } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { Game } from "@/lib/games";
import { openGameDir, updateGameFavorite, updateGameStatus } from "@/lib/games";
import { endActiveSession, launchGame } from "@/lib/launch";
import { useLibraryStore } from "@/store/library";
import { cn } from "@/lib/utils";
import { displayGameName } from "@/lib/display";

interface GameCardProps {
  game: Game;
  coverDataUrl: string | null;
  onPickMetadata: (game: Game) => void;
  onRefreshCover: (game: Game) => void;
  onMutated?: () => void;
  // Quick 20260510b — batch selection mode (drives the "添加到视图" workflow).
  /** When true, clicking the card toggles selection instead of navigating. */
  selectMode?: boolean;
  /** Whether this card is currently in the selection set. */
  selected?: boolean;
  /** Toggle this game's selection (only called in select mode). */
  onToggleSelect?: (id: number) => void;
}

type StampStatus = "playing" | "cleared" | "dropped" | "todo";

/**
 * Map game state → top-left status stamp visual.
 *   playing → 游玩中     (accent color)
 *   cleared → 已通关     (teal)
 *   dropped → 弃坑       (ink-2 muted)
 *   unplayed → 未开始    (ink-stamp / orange-red)
 *
 * The metadata-low-conf state is rendered as a separate bottom-left
 * 「待复核」 badge (see metaState below) — keeps actionable badges
 * grouped at the bottom and the playthrough stamp clean at the top.
 */
function getStamp(game: Game): { status: StampStatus; label: string } {
  switch (game.status) {
    case "playing":
      return { status: "playing", label: "游玩中" };
    case "cleared":
      return { status: "cleared", label: "已通关" };
    case "dropped":
      return { status: "dropped", label: "弃坑" };
    case "unplayed":
    default:
      return { status: "todo", label: "未开始" };
  }
}

function getMetadataState(game: Game): "ok" | "pending" | "failed" {
  if (
    game.metadata_source === "bangumi" ||
    game.metadata_source === "vndb" ||
    game.metadata_source === "manual"
  ) {
    return "ok";
  }
  return game.last_scanned_at == null ? "pending" : "failed";
}

const STAMP_COLOR: Record<StampStatus, string> = {
  playing: "text-brand",
  cleared: "text-[#6fd1c8]",
  dropped: "text-ink-2",
  todo: "text-ink-stamp",
};

const STATUS_SUBMENU: Array<{
  value: "unplayed" | "playing" | "cleared" | "dropped";
  label: string;
}> = [
  { value: "unplayed", label: "未游玩" },
  { value: "playing", label: "游玩中" },
  { value: "cleared", label: "已通关" },
  { value: "dropped", label: "已弃" },
];

function fmtPlaytime(sec: number): string {
  if (!sec) return "—";
  const totalMin = Math.floor(sec / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}分钟`;
  return m === 0 ? `${h}小时` : `${h}时${m}分`;
}

function GameCardImpl({
  game,
  coverDataUrl,
  onPickMetadata,
  onRefreshCover,
  onMutated,
  selectMode = false,
  selected = false,
  onToggleSelect,
}: GameCardProps) {
  const navigate = useNavigate();
  const activeSession = useLibraryStore((s) => s.activeSession);
  // 20260509f — per-card boolean selector. Only this card re-renders when
  // its own id flips in/out of fetchingMetaIds (zustand referential check
  // on the boolean). Other cards' transitions don't leak through.
  const isFetchingMeta = useLibraryStore(
    (s) => s.fetchingMetaIds[game.id] === true,
  );

  const stamp = getStamp(game);
  const metaState = getMetadataState(game);
  const displayName = displayGameName(game);
  const noExe = game.executable_path == null;
  const isActive = activeSession?.game_id === game.id;
  const otherActive = activeSession != null && !isActive;
  const launchDisabled = noExe || otherActive;

  // Bottom-left badge precedence: at most one renders, in this order.
  //   fetching → 获取中 + spinner   (active fetch — pulse-ring on cover)
  //   pending  → 获取中             (placeholder — scan queued, not yet enriching)
  //   failed   → 待复核              (actionable — user needs to pick metadata)
  //   no-exe   → 无 EXE              (informational — can't launch)
  // Right-top corner is now exclusively the favorite heart.
  // 20260509f: fetching takes priority over the static pending badge — when
  // the backend is actively running enrich for this id, swap to the spinner
  // variant; the static "获取中" remains for the brief window between
  // placeholder INSERT and the started emit (and for cards still queued
  // behind the in-flight ingest).
  const bottomBadge: "fetching" | "pending" | "review" | "no-exe" | null =
    isFetchingMeta
      ? "fetching"
      : metaState === "pending"
        ? "pending"
        : metaState === "failed"
          ? "review"
          : noExe
            ? "no-exe"
            : null;

  function onCardClick() {
    // Quick 20260510b — in selection mode the card click toggles membership;
    // navigation is intentionally suppressed so users can rapidly tag many
    // games without bouncing in and out of detail pages.
    if (selectMode) {
      onToggleSelect?.(game.id);
      return;
    }
    navigate(`/games/${game.id}`);
  }

  async function onLaunch(useLe = false, e?: React.MouseEvent) {
    e?.stopPropagation();
    if (otherActive) {
      toast.error("已有活动游戏 — 请先结束当前会话");
      return;
    }
    try {
      await launchGame(game.id, useLe);
      toast.info(`正在启动 — ${displayName}${useLe ? "（日区）" : ""}`);
    } catch (err: unknown) {
      toast.error(`启动失败 — ${String(err)}`);
    }
  }

  async function onForceEnd(e?: React.MouseEvent) {
    e?.stopPropagation();
    try {
      await endActiveSession();
      toast.info("已结束游戏会话");
    } catch (err: unknown) {
      toast.error(`结束失败 — ${String(err)}`);
    }
  }

  async function onToggleFavorite() {
    const next = !game.is_favorite;
    try {
      await updateGameFavorite(game.id, next);
      onMutated?.();
      toast.success(next ? "已收藏" : "已取消收藏");
    } catch (err: unknown) {
      toast.error(`操作失败 — ${String(err)}`);
    }
  }

  async function onSetStatus(
    next: "unplayed" | "playing" | "cleared" | "dropped",
  ) {
    if (next === game.status) return;
    try {
      await updateGameStatus(game.id, next);
      onMutated?.();
    } catch (err: unknown) {
      toast.error(`状态更新失败 — ${String(err)}`);
    }
  }

  // Phase 14 (FS-02) — open game directory in OS file manager.
  async function onOpenDir() {
    try {
      await openGameDir(game.path);
    } catch (err: unknown) {
      toast.error(`打开目录失败 — ${String(err)}`);
    }
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="button"
          tabIndex={0}
          aria-label={displayName}
          onClick={onCardClick}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onCardClick();
            }
          }}
          className="group flex cursor-pointer flex-col text-left outline-none transition-transform duration-200 hover:-translate-y-1 focus-visible:-translate-y-1"
          style={{ transitionTimingFunction: "cubic-bezier(.2,.8,.2,1)" }}
        >
          {/* COVER */}
          <div
            className={cn(
              "relative aspect-[3/4] overflow-hidden bg-bg-2 transition-shadow",
              "rounded-md shadow-card group-hover:shadow-lift",
              // 20260509f — pulse ring while metadata fetch is in flight
              // (covers all 4 backend trigger paths). Sits over the static
              // shadow-card; hover lift via transform stacks cleanly because
              // .pulse-ring only animates opacity, not transform.
              // Quick 260515-pending-pulse — also apply to placeholder rows
              // waiting in the ingest queue. Without this, a scan with
              // hundreds of placeholders looks frozen — only the 4 in-flight
              // task slots had the breathing ring, the rest read as static.
              (bottomBadge === "fetching" || bottomBadge === "pending") &&
                "pulse-ring",
              // Quick 20260510b — selection ring around cover when picked.
              selectMode && selected && "ring-2 ring-brand ring-offset-2 ring-offset-bg-0",
            )}
            style={{ borderRadius: "var(--r-md)" }}
          >
            {coverDataUrl ? (
              <img
                src={coverDataUrl}
                alt=""
                draggable={false}
                decoding="async"
                loading="lazy"
                className="h-full w-full object-cover"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = "none";
                }}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-ink-3">
                <ImageOff className="size-8" aria-hidden />
              </div>
            )}

            {/* 「藏书章」status stamp — top-left.
                Quick 20260510b — hidden in select mode so the checkbox owns
                the top-left corner; the playthrough state can still be read
                from the meta block below. */}
            {!selectMode && (
              <div
                className={cn(
                  "absolute left-2 top-2 z-[3] inline-flex items-center px-1.5 py-[2px]",
                  "border border-current font-mono text-[9px] uppercase tracking-[0.12em] backdrop-blur-md",
                  "bg-black/35",
                  STAMP_COLOR[stamp.status],
                )}
                style={{ borderRadius: "var(--r-sm)" }}
              >
                {stamp.label}
              </div>
            )}

            {/* Selection checkbox — Quick 20260510b. Renders only in select
                mode; sits in the same top-left slot as the stamp. */}
            {selectMode && (
              <div
                aria-hidden
                className={cn(
                  "absolute left-2 top-2 z-[4] grid h-6 w-6 place-items-center transition-colors",
                  selected
                    ? "border border-brand bg-brand text-[var(--accent-on)]"
                    : "border border-line-strong bg-black/55 text-transparent backdrop-blur",
                )}
                style={{ borderRadius: "var(--r-sm)" }}
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 12 12"
                  aria-hidden
                  style={{ visibility: selected ? "visible" : "hidden" }}
                >
                  <path
                    d="M2.5 6.4 L5 9 L9.5 3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            )}

            {/* Top-right — favorite heart only (no age-rating badge after
                Quick 260513-404). */}
            <div className="absolute right-2 top-2 z-[3] flex flex-col items-end gap-1.5">
              {game.is_favorite && (
                <div
                  className="text-brand"
                  style={{ filter: "drop-shadow(0 1px 4px rgba(0,0,0,.5))" }}
                >
                  <Heart size={14} fill="currentColor" strokeWidth={1.5} />
                </div>
              )}
            </div>

            {/* Quick 260515-loading — cover-center overlay while metadata
                fetch is in flight. Sits below the bottom-left badge (z-[2])
                so the corner spinner badge still reads cleanly, but the
                large central spinner makes it obvious from a distance which
                cards in the grid are currently working. pulse-ring stays on
                the cover container for the breathing border. */}
            {bottomBadge === "fetching" && (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 z-[2] grid place-items-center bg-black/40 text-[var(--accent)] backdrop-blur-[1px]"
              >
                <Loader2 size={26} strokeWidth={1.6} className="animate-spin" />
              </div>
            )}

            {/* Bottom-left badge — at most one renders; precedence in
                bottomBadge is fetching > pending > review > no-exe. */}
            {/* 20260509f — active-fetch badge: same "获取中" copy as the
                static pending variant but with the accent color (matches
                the cover ring) + Loader2 spinner. Visual cue: this card is
                the one currently hitting Bangumi/VNDB right now. */}
            {bottomBadge === "fetching" && (
              <div
                className="absolute bottom-2 left-2 z-[3] inline-flex items-center px-1.5 py-[2px] border border-current bg-black/55 font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--accent)] backdrop-blur"
                style={{ borderRadius: "var(--r-sm)" }}
              >
                <Loader2 size={9} className="mr-1 animate-spin" />
                获取中
              </div>
            )}
            {bottomBadge === "pending" && (
              <div
                className="absolute bottom-2 left-2 z-[3] inline-flex items-center px-1.5 py-[2px] border border-line-strong bg-black/55 font-mono text-[9px] uppercase tracking-[0.12em] text-ink-1 backdrop-blur"
                style={{ borderRadius: "var(--r-sm)" }}
              >
                获取中
              </div>
            )}
            {bottomBadge === "review" && (
              <div
                className="absolute bottom-2 left-2 z-[3] inline-flex items-center px-1.5 py-[2px] border border-current bg-black/60 font-mono text-[9px] uppercase tracking-[0.12em] text-[#ffd166] backdrop-blur"
                style={{ borderRadius: "var(--r-sm)" }}
              >
                待复核
              </div>
            )}
            {bottomBadge === "no-exe" && (
              <div
                className="absolute bottom-2 left-2 z-[3] inline-flex items-center px-1.5 py-[2px] border border-line-strong bg-black/55 font-mono text-[9px] uppercase tracking-[0.12em] text-ink-2 backdrop-blur"
                style={{ borderRadius: "var(--r-sm)" }}
              >
                无 EXE
              </div>
            )}

            {/* Hover gradient + circular play icon overlay.
                Quick 20260510b — suppressed in select mode so the play
                button doesn't fight the checkbox tap target. */}
            <div
              className={cn(
                "pointer-events-none absolute inset-0 z-[2] flex items-end p-2.5 opacity-0 transition-opacity duration-200",
                !selectMode && "group-hover:opacity-100 group-focus-visible:opacity-100",
              )}
              style={{
                background:
                  "linear-gradient(180deg, transparent 30%, rgba(0,0,0,0.6) 100%)",
              }}
            >
              {/* Active session: show 强制结束 button (square) */}
              {isActive && (
                <button
                  type="button"
                  onClick={(e) => void onForceEnd(e)}
                  aria-label="强制结束"
                  title="强制结束"
                  className="pointer-events-auto absolute bottom-2.5 right-2.5 grid h-[30px] w-[30px] place-items-center rounded-full bg-[#c1352f] text-white shadow-lift transition-transform hover:scale-110"
                >
                  <Square size={14} fill="currentColor" />
                </button>
              )}

              {/* Idle: show 启动 button (only when no other session active) */}
              {!isActive && !otherActive && (
                <button
                  type="button"
                  disabled={launchDisabled}
                  onClick={(e) => void onLaunch(false, e)}
                  aria-label="启动"
                  title={noExe ? "未识别可执行文件" : "启动"}
                  className={cn(
                    "pointer-events-auto absolute bottom-2.5 right-2.5 grid h-[30px] w-[30px] place-items-center rounded-full text-bg-0 shadow-lift transition-transform",
                    launchDisabled
                      ? "cursor-not-allowed bg-ink-3 text-bg-0/60"
                      : "bg-ink-0 hover:scale-110",
                  )}
                >
                  <Play
                    size={14}
                    fill="currentColor"
                    strokeWidth={1}
                    style={{ transform: "translateX(1px)" }}
                  />
                </button>
              )}
            </div>
          </div>

          {/* META */}
          <div className="mt-2.5 flex flex-col gap-1">
            <h3
              className="font-serif text-[13.5px] font-medium leading-[1.3] text-ink-0"
              style={{
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
                textWrap: "pretty",
              }}
              title={displayName}
            >
              {displayName}
            </h3>
            <div className="flex items-center gap-2 font-mono text-[10px] text-ink-3">
              {game.brand ? (
                <>
                  <span className="truncate">{game.brand}</span>
                  <span className="h-[2px] w-[2px] flex-shrink-0 rounded-full bg-ink-3" />
                </>
              ) : null}
              <span className="text-ink-1">
                {fmtPlaytime(game.total_playtime_sec)}
              </span>
            </div>
          </div>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className="w-44">
        {!activeSession && !noExe && (
          <>
            <ContextMenuItem onClick={() => void onLaunch(false)}>
              启动
            </ContextMenuItem>
            <ContextMenuItem onClick={() => void onLaunch(true)}>
              用日区启动器
            </ContextMenuItem>
          </>
        )}
        {isActive && (
          <ContextMenuItem
            onClick={() => void onForceEnd()}
            className="text-destructive focus:text-destructive"
          >
            强制结束
          </ContextMenuItem>
        )}
        {(!activeSession || isActive) && <ContextMenuSeparator />}
        <ContextMenuItem onClick={() => void onToggleFavorite()}>
          {game.is_favorite ? "取消收藏" : "收藏"}
        </ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger>通关状态</ContextMenuSubTrigger>
          <ContextMenuPortal>
            <ContextMenuSubContent>
              {STATUS_SUBMENU.map(({ value, label }) => (
                <ContextMenuItem
                  key={value}
                  disabled={value === game.status}
                  onClick={() => void onSetStatus(value)}
                >
                  {label}
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuPortal>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => void onOpenDir()}>
          打开目录
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onPickMetadata(game)}>
          重新匹配元数据
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onRefreshCover(game)}>
          重新抓取封面
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

// Memoized export — useVirtualizer recomputes virtualItems on every scroll
// frame, which re-renders GameGrid; without memo, all 30+ visible cards
// re-render on every frame even though their props are stable.
export const GameCard = memo(GameCardImpl);
