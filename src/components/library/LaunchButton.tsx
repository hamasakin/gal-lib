import { useState, useRef, useEffect } from "react";
import { Play, Square, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

const LE_PROFILES = [
  { id: "Japanese", label: "ja-JP / Shift-JIS", note: "默认", color: "var(--accent)" },
  { id: "Simplified Chinese", label: "zh-CN / 简体", note: "原生", color: "#6fd1c8" },
  { id: "Traditional Chinese", label: "zh-TW / 繁体", note: "原生", color: "#ffd166" },
  { id: "Custom", label: "自定义参数", note: "高级", color: "var(--ink-2)" },
] as const;

type LaunchProfile = (typeof LE_PROFILES)[number]["id"];

interface LaunchButtonProps {
  /** Active profile id (controlled). */
  profile: LaunchProfile;
  /** Notify parent of profile change (sets up backend launch arg). */
  onProfileChange: (next: LaunchProfile) => void;
  /** Click handler — main launch (left) or 强制结束 (when active). */
  onClick: () => void;
  /** Render as the "running" state (square stop icon, no popover). */
  isActive?: boolean;
  /** Disable the button + popover. */
  disabled?: boolean;
  /** Tooltip when disabled. */
  disabledTitle?: string;
}

/**
 * Signature launch button — 44px circle that expands to 240px on hover.
 * Above the button: a 260px popover listing 4 LE profiles. Hover/focus
 * keeps the popover open via a small grace zone (mouseLeave + 200ms timer).
 *
 * Active state (game currently running): renders the destructive-red
 * square stop icon and skips the popover entirely.
 */
export function LaunchButton({
  profile,
  onProfileChange,
  onClick,
  isActive,
  disabled,
  disabledTitle,
}: LaunchButtonProps) {
  const [hover, setHover] = useState(false);
  const closeTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (closeTimer.current) window.clearTimeout(closeTimer.current);
    };
  }, []);

  function open() {
    if (disabled || isActive) return;
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setHover(true);
  }

  function scheduleClose() {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      setHover(false);
      closeTimer.current = null;
    }, 180);
  }

  const expanded = hover && !disabled && !isActive;
  const activeProfile =
    LE_PROFILES.find((p) => p.id === profile) ?? LE_PROFILES[0];

  // Active (game running) state — solid stop button, no popover
  if (isActive) {
    return (
      <button
        type="button"
        onClick={onClick}
        title="强制结束"
        aria-label="强制结束"
        className={cn(
          "relative grid h-11 w-11 place-items-center rounded-full text-white",
          "transition-shadow hover:scale-105",
        )}
        style={{
          background: "#c1352f",
          boxShadow:
            "0 8px 24px -8px #c1352f, 0 0 0 0 rgba(193,53,47,.16)",
        }}
      >
        <Square size={16} fill="currentColor" />
      </button>
    );
  }

  return (
    <div
      className="relative"
      onMouseEnter={open}
      onMouseLeave={scheduleClose}
      onFocus={open}
      onBlur={scheduleClose}
    >
      {/* The button */}
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        title={disabled ? disabledTitle : `启动 · LE: ${activeProfile.label}`}
        aria-label={`启动 · ${activeProfile.label}`}
        className={cn(
          "relative inline-flex items-center overflow-hidden whitespace-nowrap rounded-full",
          "transition-[width,box-shadow,background] duration-200",
          disabled && "cursor-not-allowed opacity-50",
        )}
        style={{
          height: 44,
          width: expanded ? 240 : 44,
          background: "var(--accent)",
          color: "var(--accent-on)",
          transitionTimingFunction: "cubic-bezier(.2,.8,.2,1)",
          boxShadow: expanded
            ? "0 12px 32px -10px var(--accent), 0 0 0 8px var(--accent-soft)"
            : "0 8px 24px -8px var(--accent), 0 0 0 0 var(--accent-soft)",
        }}
      >
        <span className="grid h-11 w-11 flex-shrink-0 place-items-center">
          <Play size={16} fill="currentColor" strokeWidth={1} />
        </span>
        <span
          className="pr-4 font-mono text-[11px] uppercase tracking-[0.14em] transition-opacity duration-150"
          style={{ opacity: expanded ? 1 : 0 }}
        >
          <span className="font-serif font-semibold normal-case mr-2 tracking-normal">
            启动
          </span>
          {activeProfile.label}
          <ChevronUp size={11} strokeWidth={2} className="ml-1 inline" />
        </span>
      </button>

      {/* Profile popover */}
      <div
        role="menu"
        className={cn(
          "absolute right-0 z-30 w-[260px] border border-line-strong bg-bg-1 p-1.5 shadow-lift transition-all",
          expanded ? "pointer-events-auto opacity-100 translate-y-0" : "pointer-events-none opacity-0 translate-y-1.5",
        )}
        style={{ bottom: "calc(100% + 12px)", borderRadius: "var(--r-md)" }}
      >
        <div className="px-2 pb-2 pt-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
          Locale Emulator · Profile
        </div>
        {LE_PROFILES.map((p, i) => {
          const on = p.id === profile;
          const isLast = i === LE_PROFILES.length - 1;
          return (
            <div key={p.id}>
              {isLast && (
                <hr className="my-1 border-0 border-t border-line" />
              )}
              <button
                type="button"
                role="menuitemradio"
                aria-checked={on}
                onClick={() => onProfileChange(p.id)}
                className={cn(
                  "flex w-full items-center gap-2.5 px-2.5 py-2 text-left text-[12px] text-ink-1 transition-colors",
                  on ? "bg-brand-soft text-ink-0" : "hover:bg-bg-2 hover:text-ink-0",
                )}
                style={{ borderRadius: "var(--r-sm)" }}
              >
                <span
                  aria-hidden
                  className="h-2 w-2 flex-shrink-0"
                  style={{ background: p.color, borderRadius: "var(--r-sm)" }}
                />
                <span className="flex-1 truncate">{p.label}</span>
                <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">
                  {p.note}
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
