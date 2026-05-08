import { useNavigate } from "react-router-dom";
import { Sliders, X } from "lucide-react";
import { useState, useMemo, type ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useLibraryStore } from "@/store/library";
import { usePreferencesStore } from "@/store/preferences";
import {
  ACCENTS,
  DENSITIES,
  RADII,
  SIDEBAR_WIDTHS,
  THEMES,
  type Accent,
} from "@/lib/preferences";
import { cn } from "@/lib/utils";

const THEME_LABELS: Record<(typeof THEMES)[number], string> = {
  midnight: "夜",
  papyrus: "纸",
  ink: "墨",
};

const RADIUS_LABELS: Record<(typeof RADII)[number], string> = {
  sharp: "锐利",
  soft: "柔和",
};

const SIDEBAR_LABELS: Record<(typeof SIDEBAR_WIDTHS)[number], string> = {
  narrow: "窄",
  regular: "中",
  wide: "宽",
};

const DENSITY_LABELS: Record<(typeof DENSITIES)[number], string> = {
  small: "小",
  medium: "中",
  large: "大",
};

const ACCENT_SWATCHES: Record<Accent, string> = {
  violet: "#b18bff",
  teal: "#6fd1c8",
  sakura: "#ffa3b8",
  matcha: "#b8d268",
};

const ACCENT_LABELS: Record<Accent, string> = {
  violet: "霓紫",
  teal: "青蓝",
  sakura: "樱粉",
  matcha: "抹茶",
};

interface SegmentedProps<T extends string> {
  value: T;
  options: readonly T[];
  labels: Record<T, string>;
  onChange: (next: T) => void;
}

function Segmented<T extends string>({
  value,
  options,
  labels,
  onChange,
}: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      className="flex h-7 items-stretch rounded-md border border-line bg-bg-2 p-0.5"
    >
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          role="radio"
          aria-checked={opt === value}
          onClick={() => onChange(opt)}
          className={cn(
            "flex-1 px-2 text-[11px] leading-none transition-colors",
            "rounded-sm",
            opt === value
              ? "bg-bg-0 text-ink-0 shadow-card"
              : "text-ink-2 hover:text-ink-0",
          )}
        >
          {labels[opt]}
        </button>
      ))}
    </div>
  );
}

interface FieldProps {
  label: string;
  hint?: string;
  children: ReactNode;
}

function Field({ label, hint, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-medium text-ink-1">{label}</span>
        {hint ? (
          <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-ink-3">
            {hint}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-3">
      {children}
    </div>
  );
}

function AccentChips({
  value,
  onChange,
}: {
  value: Accent;
  onChange: (a: Accent) => void;
}) {
  return (
    <div className="flex gap-1.5" role="radiogroup">
      {ACCENTS.map((a) => {
        const on = a === value;
        return (
          <button
            key={a}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={ACCENT_LABELS[a]}
            title={ACCENT_LABELS[a]}
            onClick={() => onChange(a)}
            className={cn(
              "relative h-9 flex-1 overflow-hidden rounded-md transition-transform",
              on
                ? "ring-2 ring-ink-0 ring-offset-2 ring-offset-bg-1"
                : "ring-1 ring-line hover:-translate-y-0.5",
            )}
            style={{ background: ACCENT_SWATCHES[a] }}
          >
            <span className="sr-only">{ACCENT_LABELS[a]}</span>
          </button>
        );
      })}
    </div>
  );
}

interface JumpButtonProps {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  hint?: string;
}

function JumpButton({ label, onClick, disabled, hint }: JumpButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? hint : undefined}
      className={cn(
        "flex h-7 items-center justify-between rounded-md border border-line px-2.5",
        "font-mono text-[10.5px] uppercase tracking-[0.1em]",
        disabled
          ? "cursor-not-allowed bg-bg-2 text-ink-3"
          : "bg-bg-1 text-ink-1 hover:border-line-strong hover:bg-bg-2 hover:text-ink-0",
      )}
    >
      <span>{label}</span>
      <span className="text-ink-3">→</span>
    </button>
  );
}

/**
 * v1.1 Tweaks panel — floating bottom-right gear button → popover with
 * theme/accent/radius/sidebar/density switches + 4 page jumps.
 *
 * State lives in `usePreferencesStore` (Zustand + localStorage persistence
 * via `src/lib/preferences.ts`). Toggling any axis writes through to
 * `<html data-*>` immediately so the entire app re-themes without re-render.
 */
export function TweaksPanel() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const games = useLibraryStore((s) => s.games);
  const sampleGameId = useMemo(() => games[0]?.id ?? null, [games]);

  const theme = usePreferencesStore((s) => s.theme);
  const accent = usePreferencesStore((s) => s.accent);
  const radius = usePreferencesStore((s) => s.radius);
  const sidebar = usePreferencesStore((s) => s.sidebar);
  const density = usePreferencesStore((s) => s.density);
  const setTheme = usePreferencesStore((s) => s.setTheme);
  const setAccent = usePreferencesStore((s) => s.setAccent);
  const setRadius = usePreferencesStore((s) => s.setRadius);
  const setSidebar = usePreferencesStore((s) => s.setSidebar);
  const setDensity = usePreferencesStore((s) => s.setDensity);

  const go = (path: string) => {
    setOpen(false);
    navigate(path);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Tweaks · 实时调样"
          title="Tweaks · 实时调样"
          className={cn(
            "fixed bottom-4 right-4 z-[60] flex h-10 w-10 items-center justify-center",
            "rounded-full border border-line-strong bg-bg-1/85 text-ink-1 shadow-lift backdrop-blur",
            "transition-colors hover:border-brand hover:text-brand",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg-0",
          )}
        >
          <Sliders size={16} strokeWidth={1.6} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        sideOffset={8}
        className={cn(
          "z-[60] flex w-[300px] flex-col gap-3 rounded-lg border border-line-strong bg-bg-1/95",
          "p-3.5 shadow-lift backdrop-blur-md",
          "ring-0 outline-none",
        )}
      >
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-serif text-[14px] font-medium text-ink-0">
              Tweaks
            </span>
            <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-ink-3">
              实时调样
            </span>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="关闭"
            className="grid h-6 w-6 place-items-center rounded-sm text-ink-3 hover:bg-bg-2 hover:text-ink-0"
          >
            <X size={13} />
          </button>
        </header>

        <SectionLabel>主题</SectionLabel>
        <Field label="配色主题" hint={theme}>
          <Segmented
            value={theme}
            options={THEMES}
            labels={THEME_LABELS}
            onChange={setTheme}
          />
        </Field>
        <Field label="强调色" hint={ACCENT_LABELS[accent]}>
          <AccentChips value={accent} onChange={setAccent} />
        </Field>
        <Field label="圆角风格" hint={radius}>
          <Segmented
            value={radius}
            options={RADII}
            labels={RADIUS_LABELS}
            onChange={setRadius}
          />
        </Field>

        <SectionLabel>布局</SectionLabel>
        <Field label="侧栏宽度" hint={sidebar}>
          <Segmented
            value={sidebar}
            options={SIDEBAR_WIDTHS}
            labels={SIDEBAR_LABELS}
            onChange={setSidebar}
          />
        </Field>
        <Field label="封面密度" hint={density}>
          <Segmented
            value={density}
            options={DENSITIES}
            labels={DENSITY_LABELS}
            onChange={setDensity}
          />
        </Field>

        <SectionLabel>跳转</SectionLabel>
        <div className="grid grid-cols-2 gap-1.5">
          <JumpButton label="图书馆" onClick={() => go("/")} />
          <JumpButton label="统计" onClick={() => go("/stats")} />
          <JumpButton label="截图集" onClick={() => go("/screenshots")} />
          <JumpButton
            label="详情"
            onClick={
              sampleGameId ? () => go(`/games/${sampleGameId}`) : undefined
            }
            disabled={!sampleGameId}
            hint="先扫描出至少一款游戏"
          />
          <JumpButton label="设置" onClick={() => go("/settings")} />
        </div>
      </PopoverContent>
    </Popover>
  );
}
