/**
 * ViewToggle — segmented Grid/List switcher for the Library toolbar.
 *
 * Mirrors `DensityToggle`'s 28px-tall border-bordered segment style so the
 * toolbar reads as a single visual row. Reads/writes `viewMode` on the
 * preferences store; persisted via the same localStorage flow as the rest
 * of the design axes.
 */

import { LayoutGrid, List } from "lucide-react";
import { usePreferencesStore } from "@/store/preferences";
import type { ViewMode } from "@/lib/preferences";
import { cn } from "@/lib/utils";

const OPTIONS: Array<{ value: ViewMode; label: string; Icon: typeof LayoutGrid }> = [
  { value: "grid", label: "网格", Icon: LayoutGrid },
  { value: "list", label: "列表", Icon: List },
];

export function ViewToggle() {
  const viewMode = usePreferencesStore((s) => s.viewMode);
  const setViewMode = usePreferencesStore((s) => s.setViewMode);

  return (
    <div
      role="radiogroup"
      aria-label="视图模式"
      className="inline-flex h-8 overflow-hidden border border-line bg-bg-1"
      style={{ borderRadius: "var(--r-md)" }}
    >
      {OPTIONS.map(({ value, label, Icon }, i) => {
        const on = viewMode === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={label}
            title={label}
            onClick={() => setViewMode(value)}
            className={cn(
              "inline-flex h-full items-center gap-1.5 px-2.5 text-[11.5px] transition-colors",
              i > 0 && "border-l border-line",
              on
                ? "bg-bg-3 text-ink-0"
                : "text-ink-2 hover:bg-bg-2 hover:text-ink-0",
            )}
          >
            <Icon size={13} strokeWidth={1.6} />
          </button>
        );
      })}
    </div>
  );
}
