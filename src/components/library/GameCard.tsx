/**
 * GameCard — single library tile.
 *
 * v1.1 "library card" aesthetic:
 *   - 3:4 cover with --shadow-card; hover: -4px translate + --shadow-lift
 *   - Top-left: 「藏书章」mono uppercase status stamp (5 colors)
 *   - Top-right: heart-fill favorite mark (only when favorited; brand-colored)
 *   - Hover overlay: linear gradient bottom + 30px circular play icon (bottom-right)
 *   - Title: serif font, 13.5px, line-clamp-2
 *   - Sub-row: brand + sep dot + mono playtime
 *
 * Logic preserved from v1.0:
 *   - Click → navigate(/games/:id)
 *   - Right-click → ContextMenu (launch / 强制结束 / 收藏 toggle / status / 元数据)
 *   - Single-session lock: when another game is active, launch hidden
 *   - Metadata pending/failed/no-exe badges stack on the cover
 */

import { Heart, ImageOff, Play, Square } from "lucide-react";
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
import { updateGameFavorite, updateGameStatus } from "@/lib/games";
import { endActiveSession, launchGame } from "@/lib/launch";
import { useLibraryStore } from "@/store/library";
import { cn } from "@/lib/utils";

interface GameCardProps {
  game: Game;
  coverDataUrl: string | null;
  onPickMetadata: (game: Game) => void;
  onRefreshCover: (game: Game) => void;
  onMutated?: () => void;
}

type StampStatus = "playing" | "cleared" | "dropped" | "todo" | "review";

/**
 * Map game state → stamp visual.
 * Per design: 5 stamp variants (s-playing/s-cleared/s-dropped/s-todo/s-review).
 *   playing → 游玩中     (accent color)
 *   cleared → 已通关     (teal)
 *   dropped → 弃坑       (ink-2 muted)
 *   unplayed → 未开始    (ink-stamp / orange-red)
 *   metadata low-conf → 复核 (yellow; renders top-right via stamp.s-review)
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
  review: "text-[#ffd166]",
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

export function GameCard({
  game,
  coverDataUrl,
  onPickMetadata,
  onRefreshCover,
  onMutated,
}: GameCardProps) {
  const navigate = useNavigate();
  const activeSession = useLibraryStore((s) => s.activeSession);

  const stamp = getStamp(game);
  const metaState = getMetadataState(game);
  const displayName = game.name_cn ?? game.name;
  const noExe = game.executable_path == null;
  const isActive = activeSession?.game_id === game.id;
  const otherActive = activeSession != null && !isActive;
  const launchDisabled = noExe || otherActive;
  const showReviewStamp = metaState === "failed";

  function onCardClick() {
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
            )}
            style={{ borderRadius: "var(--r-md)" }}
          >
            {coverDataUrl ? (
              <img
                src={coverDataUrl}
                alt=""
                draggable={false}
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

            {/* 「藏书章」status stamp — top-left */}
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

            {/* 「复核」stamp — top-right (only when metadata failed/low-conf) */}
            {showReviewStamp && (
              <div
                className={cn(
                  "absolute right-2 top-2 z-[3] inline-flex items-center px-1.5 py-[2px]",
                  "border border-current font-mono text-[9px] uppercase tracking-[0.12em] backdrop-blur-md",
                  "bg-black/50 text-[#ffd166]",
                )}
                style={{ borderRadius: "var(--r-sm)" }}
              >
                复核
              </div>
            )}

            {/* Favorite mark — top-right (mutually exclusive with review since
                review-needing games rarely have favorites; if both, favorite
                wins because the user explicitly opted in) */}
            {game.is_favorite && !showReviewStamp && (
              <div
                className="absolute right-2 top-2 z-[3] text-brand"
                style={{ filter: "drop-shadow(0 1px 4px rgba(0,0,0,.5))" }}
              >
                <Heart size={14} fill="currentColor" strokeWidth={1.5} />
              </div>
            )}

            {/* Pending-metadata badge (bottom-left, takes "no-exe"'s slot
                when both apply since pending state is more actionable) */}
            {metaState === "pending" && (
              <div
                className="absolute bottom-2 left-2 z-[3] inline-flex items-center px-1.5 py-[2px] border border-line-strong bg-black/55 font-mono text-[9px] uppercase tracking-[0.12em] text-ink-1 backdrop-blur"
                style={{ borderRadius: "var(--r-sm)" }}
              >
                获取中
              </div>
            )}

            {/* No-exe badge (bottom-left only when no pending) */}
            {metaState !== "pending" && noExe && (
              <div
                className="absolute bottom-2 left-2 z-[3] inline-flex items-center px-1.5 py-[2px] border border-line-strong bg-black/55 font-mono text-[9px] uppercase tracking-[0.12em] text-ink-2 backdrop-blur"
                style={{ borderRadius: "var(--r-sm)" }}
              >
                无 EXE
              </div>
            )}

            {/* Hover gradient + circular play icon overlay */}
            <div
              className={cn(
                "pointer-events-none absolute inset-0 z-[2] flex items-end p-2.5 opacity-0 transition-opacity duration-200",
                "group-hover:opacity-100 group-focus-visible:opacity-100",
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
                  <Play size={14} fill="currentColor" strokeWidth={1} />
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
