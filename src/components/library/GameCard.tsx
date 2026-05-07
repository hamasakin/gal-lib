/**
 * GameCard — single game tile in the cover grid.
 *
 * 02-UI-SPEC §Game Card contract:
 *   - 3:4 cover (`aspect-cover`), `rounded-md` (8px), `bg-secondary` placeholder
 *   - Body 14 weight 500 title with `line-clamp-2`
 *   - 4×4 dot + label status indicator using semantic palette extension
 *     (text-blue-400 / text-emerald-400 / text-red-400 / text-muted-foreground)
 *   - Hover: cover scales 1.02 + ring-1 border outline
 *   - Click on card body → navigate to `/games/:id` (Phase 3 — was a
 *     Phase-2 toast placeholder)
 *   - Right-click: shadcn DropdownMenu with "启动" / "强制结束" /
 *     "重新匹配元数据" / "重新抓取封面"
 *
 * Phase 3 (03f) additions:
 *   - Launch button: cover bottom-right, opacity-0 group-hover:opacity-100,
 *     `Play` icon. Only rendered when no other session is active OR when
 *     this card is the active game (in which case it renders a "强制结束"
 *     stop variant). When some OTHER game is active, the button is
 *     entirely hidden — single-session-at-a-time enforcement is mirrored
 *     in the UI so the user doesn't get a backend rejection toast.
 *   - Dropdown items: "启动" appears when no active session; "强制结束"
 *     appears only on the active game's card.
 *   - Card click: `useNavigate()(`/games/${game.id}`)` replaces the P2
 *     `toast.info("详情页 — 即将上线")` placeholder.
 *
 * Three optional badge states overlaying the card:
 *   - `metadata-pending`  → badge "元数据获取中" (clickable → opens MetadataPicker)
 *   - `metadata-failed`   → badge "元数据获取失败 — 点击重试" (clickable → opens MetadataPicker)
 *   - `no-exe`            → badge "未识别可执行文件" (informational only)
 *
 * Cover image source resolution:
 *   - `coverDataUrl` is precomputed by the parent (GameGrid) using
 *     convertFileSrc(dataDir + '/' + game.cover_path) so each card doesn't
 *     re-resolve the data dir per render.
 *   - When null → render the lucide ImageOff placeholder on the bg-secondary
 *     surface.
 */

import { ImageOff, Play, Square } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Game } from "@/lib/games";
import { endActiveSession, launchGame } from "@/lib/launch";
import { useLibraryStore } from "@/store/library";

interface GameCardProps {
  game: Game;
  /** Resolved webview-safe cover URL, or null when no cover cached. */
  coverDataUrl: string | null;
  /** Open the MetadataPicker for this game (called from right-click menu OR pending/failed badge click). */
  onPickMetadata: (game: Game) => void;
  /** Trigger refresh-cover-only flow (re-runs metadata pipeline keeping current bind). */
  onRefreshCover: (game: Game) => void;
}

/**
 * Map `games.status` (or `games.metadata_*` derived state) to UI tokens.
 * Returns `null` when the row is in a metadata-pending or failed state and
 * a separate badge takes precedence (handled by the caller logic below).
 */
function getStatusLabel(status: Game["status"]): { color: string; label: string } {
  switch (status) {
    case "playing":
      return { color: "text-blue-400", label: "游玩中" };
    case "cleared":
      return { color: "text-emerald-400", label: "已通关" };
    case "dropped":
      return { color: "text-red-400", label: "已弃" };
    case "unplayed":
    default:
      return { color: "text-muted-foreground", label: "未游玩" };
  }
}

/**
 * Detect metadata-pending / -failed / -ok via the row state combination.
 *
 * Per 02-CONTEXT § Metadata Match Pipeline:
 *   - "metadata_source = none AND match_confidence IS NULL" → never tried (or
 *     attempted but threw before write). Treat as "fetch in progress / failed
 *     — needs user input". UI-SPEC distinguishes pending vs failed by
 *     `last_scanned_at`: NULL = 获取中 (still queued), set = 失败 (gave up).
 *   - "metadata_source IN (bangumi/vndb/manual)" → resolved; show normal status.
 */
function getMetadataState(game: Game): "ok" | "pending" | "failed" {
  if (
    game.metadata_source === "bangumi" ||
    game.metadata_source === "vndb" ||
    game.metadata_source === "manual"
  ) {
    return "ok";
  }
  // No source bound — pending vs failed by whether ingest already ran.
  return game.last_scanned_at == null ? "pending" : "failed";
}

export function GameCard({
  game,
  coverDataUrl,
  onPickMetadata,
  onRefreshCover,
}: GameCardProps) {
  const navigate = useNavigate();
  const activeSession = useLibraryStore((s) => s.activeSession);
  const status = getStatusLabel(game.status);
  const metaState = getMetadataState(game);
  const displayName = game.name_cn ?? game.name;
  const noExe = game.executable_path == null;

  const isActive = activeSession?.game_id === game.id;
  const otherActive = activeSession != null && !isActive;
  // Disable launching when:
  //   - we have no exe to launch, OR
  //   - another game is currently running (single-session lock)
  const launchDisabled = noExe || otherActive;

  function onCardClick() {
    // Phase 3: replaces P2's toast.info("详情页 — 即将上线") placeholder.
    navigate(`/games/${game.id}`);
  }

  function onMetaBadgeClick(e: React.MouseEvent) {
    // Stop bubbling so the card-click navigation doesn't also fire.
    e.stopPropagation();
    onPickMetadata(game);
  }

  async function onLaunch(e?: React.MouseEvent) {
    e?.stopPropagation();
    if (otherActive) {
      toast.error("已有活动游戏 — 请先结束当前会话");
      return;
    }
    try {
      await launchGame(game.id);
      toast.info(`正在启动 — ${displayName}`);
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

  return (
    <DropdownMenu>
      {/* Right-click target: the entire card. Radix DropdownMenuTrigger fires
          on the configured event; we override to "contextmenu" via asChild +
          a wrapper that calls e.preventDefault on contextmenu and dispatches
          the open event. The simpler shadcn pattern is the ContextMenu
          primitive — but UI-SPEC explicitly says "DropdownMenu", so we wire
          contextmenu manually below via onContextMenu on the inner button. */}
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onClick={onCardClick}
          onContextMenu={(e) => {
            // Prevent native context menu — Radix handles open via the
            // trigger's onPointerDown when fired with right-button, but we
            // additionally forward a synthetic click with the same currentTarget
            // to ensure the menu opens reliably across browsers (webview2).
            e.preventDefault();
            (e.currentTarget as HTMLButtonElement).click();
          }}
          className="group flex flex-col gap-2 text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-md"
          aria-label={displayName}
        >
          <div className="relative aspect-cover w-full overflow-hidden rounded-md bg-secondary ring-1 ring-transparent group-hover:ring-border transition">
            {coverDataUrl ? (
              <img
                src={coverDataUrl}
                alt={displayName}
                draggable={false}
                className="h-full w-full object-cover transition-transform duration-150 group-hover:scale-[1.02]"
                onError={(e) => {
                  // If the cached file disappeared on disk, gracefully
                  // degrade to the placeholder (avoid broken-image icon).
                  (e.currentTarget as HTMLImageElement).style.display = "none";
                }}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                <ImageOff className="size-8" aria-hidden />
              </div>
            )}

            {/* Metadata-state badge overlay (top-left corner) */}
            {metaState === "pending" && (
              <Badge
                variant="outline"
                className="absolute left-2 top-2 cursor-pointer bg-background/80 backdrop-blur"
                onClick={onMetaBadgeClick}
                role="button"
              >
                元数据获取中
              </Badge>
            )}
            {metaState === "failed" && (
              <Badge
                variant="outline"
                className="absolute left-2 top-2 cursor-pointer bg-background/80 backdrop-blur text-destructive border-destructive/40"
                onClick={onMetaBadgeClick}
                role="button"
              >
                元数据获取失败 — 点击重试
              </Badge>
            )}

            {/* No-exe informational badge (bottom-left so it doesn't
                collide with the launch button at bottom-right) */}
            {noExe && (
              <Badge
                variant="outline"
                className="absolute bottom-2 left-2 bg-background/80 backdrop-blur text-muted-foreground"
              >
                未识别可执行文件
              </Badge>
            )}

            {/* Launch / Force-end button overlay (cover bottom-right).
                Show as "强制结束" when this card is the active game; show
                as "启动" otherwise IF launching is permitted. Hidden when
                some other game is active (avoid an enabled button that
                would just emit a backend rejection toast). */}
            {isActive ? (
              <Button
                size="icon"
                variant="destructive"
                className="absolute bottom-2 right-2 opacity-100 shadow"
                onClick={(e) => void onForceEnd(e)}
                aria-label="强制结束"
                title="强制结束"
              >
                <Square className="size-4" />
              </Button>
            ) : (
              !otherActive && (
                <Button
                  size="icon"
                  variant="default"
                  disabled={launchDisabled}
                  className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity shadow"
                  onClick={(e) => void onLaunch(e)}
                  aria-label="启动"
                  title="启动"
                >
                  <Play className="size-4" />
                </Button>
              )
            )}
          </div>

          {/* Title + status row */}
          <div className="flex flex-col gap-1 px-0.5">
            <h3 className="text-body font-medium text-foreground line-clamp-2">
              {displayName}
            </h3>
            <div className={`flex items-center gap-1.5 text-label ${status.color}`}>
              <span
                aria-hidden
                className="inline-block size-1 rounded-full bg-current"
              />
              <span>{status.label}</span>
            </div>
          </div>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-44">
        {!activeSession && !noExe && (
          <DropdownMenuItem onClick={() => void onLaunch()}>启动</DropdownMenuItem>
        )}
        {isActive && (
          <DropdownMenuItem
            onClick={() => void onForceEnd()}
            className="text-destructive focus:text-destructive"
          >
            强制结束
          </DropdownMenuItem>
        )}
        {(!activeSession || isActive) && <DropdownMenuSeparator />}
        <DropdownMenuItem onClick={() => onPickMetadata(game)}>
          重新匹配元数据
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onRefreshCover(game)}>
          重新抓取封面
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
