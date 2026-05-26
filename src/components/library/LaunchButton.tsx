import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Play, Square } from "lucide-react";
import { cn } from "@/lib/utils";

// Quick 260526-vqr — 按钮本身固定 44×44 不再展开宽度，避免 hover 挤兄弟元素布局；
// hover/focus 时上方仍弹启动方式 popover 用来快切日区 LE / 直接启动。
const LAUNCH_METHODS = [
  {
    id: "le-jp",
    labelKey: "detail.launch.le_jp",
    noteKey: "detail.launch.le_jp_note",
    color: "var(--accent)",
  },
  {
    id: "direct",
    labelKey: "detail.launch.direct",
    noteKey: "detail.launch.direct_note",
    color: "#6fd1c8",
  },
] as const;

export type LaunchMethod = (typeof LAUNCH_METHODS)[number]["id"];

interface LaunchButtonProps {
  /** Active launch method (controlled). */
  profile: LaunchMethod;
  /** Notify parent of launch-method change. */
  onProfileChange: (next: LaunchMethod) => void;
  /** Click handler — main launch (left) or 强制结束 (when active). */
  onClick: () => void;
  /** Render as the "running" state (square stop icon, no popover). */
  isActive?: boolean;
  /** Disable the button + popover. */
  disabled?: boolean;
  /** Tooltip when disabled. */
  disabledTitle?: string;
}

export function LaunchButton({
  profile,
  onProfileChange,
  onClick,
  isActive,
  disabled,
  disabledTitle,
}: LaunchButtonProps) {
  const { t } = useTranslation();
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

  const popoverOpen = hover && !disabled && !isActive;
  const activeProfile =
    LAUNCH_METHODS.find((p) => p.id === profile) ?? LAUNCH_METHODS[0];
  const activeProfileLabel = t(activeProfile.labelKey);

  // Active (game running) state — solid stop button, no popover
  if (isActive) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={t("detail.launch.force_stop")}
        aria-label={t("detail.launch.force_stop")}
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
      {/* 固定 44×44 圆形按钮，不再展开宽度 */}
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        title={disabled ? disabledTitle : t("detail.launch.tooltip", { label: activeProfileLabel })}
        aria-label={t("detail.launch.tooltip", { label: activeProfileLabel })}
        className={cn(
          "relative grid h-11 w-11 place-items-center rounded-full",
          "transition-shadow hover:scale-105",
          disabled && "cursor-not-allowed opacity-50",
        )}
        style={{
          background: "var(--accent)",
          color: "var(--accent-on)",
          boxShadow: popoverOpen
            ? "0 12px 32px -10px var(--accent), 0 0 0 8px var(--accent-soft)"
            : "0 8px 24px -8px var(--accent), 0 0 0 0 var(--accent-soft)",
        }}
      >
        {/* Right-pointing Play has its visual centroid offset to the
            left of its bounding box. translateX nudges it back to
            perceived center. */}
        <Play
          size={16}
          fill="currentColor"
          strokeWidth={1}
          style={{ transform: "translateX(1.5px)" }}
        />
      </button>

      {/* 启动方式 popover — 绝对定位，不挤兄弟元素布局 */}
      <div
        role="menu"
        className={cn(
          "absolute right-0 z-30 w-[260px] border border-line-strong bg-bg-1 p-1.5 shadow-lift transition-all",
          popoverOpen
            ? "pointer-events-auto opacity-100 translate-y-0"
            : "pointer-events-none opacity-0 translate-y-1.5",
        )}
        style={{ bottom: "calc(100% + 12px)", borderRadius: "var(--r-md)" }}
      >
        <div className="px-2 pb-2 pt-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
          {t("detail.launch.section")}
        </div>
        {LAUNCH_METHODS.map((p) => {
          const on = p.id === profile;
          return (
            <div key={p.id}>
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
                <span className="flex-1 truncate">{t(p.labelKey)}</span>
                <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">
                  {t(p.noteKey)}
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
