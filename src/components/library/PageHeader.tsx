import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  /** Mono uppercase breadcrumb text (e.g. "图书馆"). */
  crumb: string;
  /** Optional accent badge after the breadcrumb (e.g. "162 部作品"). */
  badge?: string | number;
  /** Serif h1 title — supports a highlighted span via children */
  title: ReactNode;
  /** Mono sub-line under the title. */
  sub?: string;
  /** Right-aligned action area (buttons / chips). */
  actions?: ReactNode;
  /** Override outer padding. */
  className?: string;
}

/**
 * Magazine-style page header used by Library / Stats / Screenshots.
 * Pattern: `<crumb (badge)> / <serif H1> / <mono sub>` on the left,
 * arbitrary actions on the right.
 */
export function PageHeader({
  crumb,
  badge,
  title,
  sub,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "flex items-end justify-between gap-6 border-b border-line px-8 pb-3.5 pt-6",
        className,
      )}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-3">
          <span>{crumb}</span>
          {badge != null && (
            <span
              className="rounded-full border border-line bg-bg-2 px-1.5 py-px text-ink-1"
              style={{ borderRadius: "9999px" }}
            >
              {badge}
            </span>
          )}
        </div>
        <h1 className="mt-1.5 font-serif text-[32px] font-medium leading-[1.1] tracking-[0.02em] text-ink-0">
          {title}
        </h1>
        {sub ? (
          <div className="mt-1.5 font-mono text-[11px] text-ink-2">{sub}</div>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2.5">{actions}</div> : null}
    </header>
  );
}
