/**
 * StarRating — 5-star rating component with half-star precision.
 *
 * Phase 4 / 04e § Detail Page hero — replaces the placeholder Star toggle
 * from the P3 minimal Detail with the full rating affordance.
 *
 * Display ↔ DB scale conversion:
 *   - DB column `games.rating` is a NULLABLE INTEGER in 1..=10 (per
 *     `update_game_rating` backend whitelist).
 *   - This component renders 5 stars; each star = 2 DB-points (left half = 1,
 *     full star = 2). So a 7/10 DB rating renders as "3 full + 1 half".
 *   - `value` prop accepts the raw DB integer (1-10) or `null` for unrated;
 *     `onChange` emits the raw DB integer (1-10) or `null` when cleared.
 *
 * Half-star detection geometry:
 *   - Each star is a 20px-square button. Hovering over the LEFT half (x < 50%
 *     of the box) sets the pending value to `(starIndex * 2) + 1` (odd → half);
 *     hovering the RIGHT half sets `(starIndex * 2) + 2` (even → full).
 *   - `pendingValue` is the local hover-preview state; `value` is the
 *     committed value. The rendered fill always reflects `pendingValue ?? value`
 *     so the stars track the cursor exactly the way the user expects.
 *
 * Readonly mode (no `onChange` passed):
 *   - Pointer-events stay live on each star button so a tooltip-like title
 *     could be added later, but click is a no-op and hover does NOT update
 *     `pendingValue`. We keep buttons (vs. plain divs) so the layout matches
 *     the editable variant pixel-for-pixel — just disabled visually via
 *     `aria-readonly` + `cursor-default`.
 *
 * Clear button:
 *   - A small × icon to the right of the stars sets the rating to `null`.
 *   - Only rendered in editable mode AND when `value != null` (clearing an
 *     already-empty rating is a no-op affordance — hide the button).
 *
 * Accessibility:
 *   - The whole control is an unordered list of 5 button-stars + 1 button-×.
 *   - Each star button has `aria-label` describing its half/full target value
 *     so a screen reader announces "设为 7 分（3 星半）" etc.
 *   - The clear button has `aria-label="清除评分"`.
 */

import { useState } from "react";
import { Star, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface StarRatingProps {
  /** Current DB rating value (1..=10) or null when unrated. */
  value: number | null;
  /**
   * Optional commit handler; receives the new DB rating (1..=10) or `null`
   * when cleared. Omit to render the component in readonly mode.
   */
  onChange?: (rating: number | null) => void;
  /** Optional extra classes on the outer flex row. */
  className?: string;
}

/**
 * Compute the icon-fill state for the i-th star (0..=4) given the effective
 * 1..=10 rating value.
 *
 * Mapping (rating → star fills):
 *   1 → [half, empty, empty, empty, empty]
 *   2 → [full, empty, empty, empty, empty]
 *   3 → [full, half, empty, empty, empty]
 *   ...
 *  10 → [full, full, full, full, full]
 */
function fillState(starIndex: number, rating: number): "empty" | "half" | "full" {
  const threshold = (starIndex + 1) * 2; // 2, 4, 6, 8, 10
  if (rating >= threshold) return "full";
  if (rating === threshold - 1) return "half";
  return "empty";
}

export function StarRating({ value, onChange, className }: StarRatingProps) {
  const readonly = onChange == null;
  const [pendingValue, setPendingValue] = useState<number | null>(null);

  // Effective rating used for rendering — pending hover preview wins when set.
  const effective = pendingValue ?? value ?? 0;

  function onStarMove(starIndex: number, e: React.PointerEvent<HTMLButtonElement>) {
    if (readonly) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const isLeftHalf = e.clientX - rect.left < rect.width / 2;
    const next = starIndex * 2 + (isLeftHalf ? 1 : 2); // 1..=10
    setPendingValue(next);
  }

  function onStarLeave() {
    if (readonly) return;
    setPendingValue(null);
  }

  function onStarClick(starIndex: number, e: React.MouseEvent<HTMLButtonElement>) {
    if (readonly || onChange == null) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const isLeftHalf = e.clientX - rect.left < rect.width / 2;
    const next = starIndex * 2 + (isLeftHalf ? 1 : 2);
    // Toggle off when clicking the same value (idempotent UX — gives users
    // an inline "undo" on miss-clicks without forcing them to use ×).
    if (value === next) {
      onChange(null);
    } else {
      onChange(next);
    }
    setPendingValue(null);
  }

  function onClearClick() {
    if (readonly || onChange == null) return;
    onChange(null);
    setPendingValue(null);
  }

  return (
    <div
      className={cn("inline-flex items-center gap-1", className)}
      onPointerLeave={onStarLeave}
      role="group"
      aria-label="评分"
    >
      {[0, 1, 2, 3, 4].map((i) => {
        const state = fillState(i, effective);
        const targetIfFull = (i + 1) * 2;
        return (
          <button
            key={i}
            type="button"
            disabled={readonly}
            aria-label={`设为 ${targetIfFull} 分（${i + 1} 星）`}
            aria-readonly={readonly || undefined}
            onPointerMove={(e) => onStarMove(i, e)}
            onClick={(e) => onStarClick(i, e)}
            className={cn(
              "relative inline-flex size-5 items-center justify-center rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-ring",
              readonly ? "cursor-default" : "cursor-pointer",
            )}
          >
            {/* Empty (outline) layer always rendered as the base. */}
            <Star
              className={cn(
                "size-5",
                state === "empty"
                  ? "text-muted-foreground/40"
                  : "text-yellow-400/30",
              )}
              aria-hidden
            />
            {/* Filled overlay clipped to half-width when state==="half". */}
            {(state === "half" || state === "full") && (
              <span
                aria-hidden
                className={cn(
                  "pointer-events-none absolute inset-0 overflow-hidden",
                  state === "half" ? "w-1/2" : "w-full",
                )}
                style={state === "half" ? { right: "auto" } : undefined}
              >
                <Star className="size-5 fill-yellow-400 text-yellow-400" />
              </span>
            )}
          </button>
        );
      })}
      {!readonly && value != null && (
        <button
          type="button"
          onClick={onClearClick}
          aria-label="清除评分"
          className="ml-0.5 inline-flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}
