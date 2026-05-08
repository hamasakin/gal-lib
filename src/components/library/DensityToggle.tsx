import { usePreferencesStore } from "@/store/preferences";
import { DENSITIES, type Density } from "@/lib/preferences";
import { cn } from "@/lib/utils";

const LABELS: Record<Density, string> = {
  small: "小",
  medium: "中",
  large: "大",
};

export function DensityToggle() {
  const density = usePreferencesStore((s) => s.density);
  const setDensity = usePreferencesStore((s) => s.setDensity);

  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
        密度
      </span>
      <div
        className="flex overflow-hidden border border-line"
        style={{ borderRadius: "var(--r-md)" }}
      >
        {DENSITIES.map((d) => {
          const on = d === density;
          return (
            <button
              key={d}
              type="button"
              onClick={() => setDensity(d)}
              className={cn(
                "h-7 border-r border-line px-3 text-[11.5px] transition-colors last:border-r-0",
                on
                  ? "bg-bg-3 text-ink-0"
                  : "bg-bg-1 text-ink-2 hover:bg-bg-2 hover:text-ink-0",
              )}
            >
              {LABELS[d]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
