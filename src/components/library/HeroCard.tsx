import { ImageOff } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { Game } from "@/lib/games";
import { cn } from "@/lib/utils";

interface HeroCardProps {
  game: Game;
  coverDataUrl: string | null;
}

function fmtPlaytime(sec: number): string {
  if (!sec) return "未游玩";
  const totalMin = Math.floor(sec / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} 分钟`;
  return m === 0 ? `${h} 小时` : `${h} 时 ${m} 分`;
}

function fmtLastPlayed(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

/**
 * HeroCard — large feature card in the Library magazine grid's hero band.
 *
 * Spans 1.6fr (vs. 1fr per-card in the rest of the band). Uses the game's
 * cover as a full-bleed background; overlay glass card bottom-left holds
 * breadcrumb + serif title + play stats.
 */
export function HeroCard({ game, coverDataUrl }: HeroCardProps) {
  const navigate = useNavigate();
  const displayName = game.name_cn ?? game.name;
  const last = fmtLastPlayed(game.last_played_at);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/games/${game.id}`)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          navigate(`/games/${game.id}`);
        }
      }}
      aria-label={displayName}
      className={cn(
        "relative flex min-h-[320px] cursor-pointer flex-col justify-end overflow-hidden p-7 text-white outline-none",
        "shadow-lift transition-transform duration-300 hover:-translate-y-1 focus-visible:-translate-y-1",
      )}
      style={{ borderRadius: "var(--r-lg)" }}
    >
      {/* Background cover */}
      {coverDataUrl ? (
        <img
          src={coverDataUrl}
          alt=""
          aria-hidden
          draggable={false}
          className="absolute inset-0 h-full w-full object-cover"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-bg-2 text-ink-3">
          <ImageOff className="size-10" aria-hidden />
        </div>
      )}

      {/* Subtle bottom dim so glass content stays readable */}
      <div
        aria-hidden
        className="absolute inset-0 z-[1]"
        style={{
          background:
            "linear-gradient(180deg, rgba(0,0,0,.05) 0%, rgba(0,0,0,.5) 100%)",
        }}
      />

      {/* Glass label */}
      <div
        className="relative z-[2] max-w-[78%] border border-white/10 bg-black/45 p-4 backdrop-blur-md"
        style={{ borderRadius: "var(--r-md)" }}
      >
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/65">
          {game.last_played_at ? "最近游玩" : "新入藏"}
          {game.brand ? ` · ${game.brand}` : ""}
          {game.release_year ? ` · ${game.release_year}` : ""}
        </div>
        <div
          className="mt-1 font-serif text-[22px] font-medium leading-[1.25]"
          style={{ textShadow: "0 2px 16px rgba(0,0,0,0.5)" }}
        >
          {displayName}
        </div>
        <div className="mt-1.5 font-mono text-[10.5px] text-white/85">
          {fmtPlaytime(game.total_playtime_sec)}
          {last ? ` · 上次 ${last}` : ""}
        </div>
      </div>
    </div>
  );
}
