/**
 * Branded toast helpers — supplementary §3 design.
 *
 * Three toast variants, each rendered via `toast.custom()` with the design's
 * colored-left-border card layout. Why custom over `toast.success/.info`:
 * the design wants a serif body title, mono uppercase header, and a
 * data-style meta row that the default sonner template doesn't expose.
 *
 *   - launchSuccess:    accent (brand) — Play icon, profile + PID-style meta
 *   - sessionRecorded:  teal #6fd1c8  — Clock icon, big duration display
 *   - scanFinished:     yellow #ffd166 — Warn icon, optional review CTA
 *
 * Pure functions; no React state. Safe to call from any handler. Each card
 * is fully self-contained (no extra context lookups) so call sites just pass
 * primitives — strings/numbers — and the card renders.
 */

import { toast } from "sonner";
import { Clock, Play, AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";
import { createElement, Fragment } from "react";

// Sonner exposes `toast.custom((id) => ReactNode)`; the helper here is split
// into per-variant entry points so call sites stay readable. Inline JSX is
// avoided to keep this file as `.ts` (no JSX compile target juggling).
const el = createElement;

const SHELL = "rounded-md border border-line-strong bg-bg-1 p-3 shadow-[0_12px_32px_-10px_rgba(0,0,0,.5)]";

interface ToastShellProps {
  accent: string;
  header: string;
  headerIcon: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  footer?: ReactNode;
}

function shell(props: ToastShellProps) {
  const { accent, header, headerIcon, title, meta, footer } = props;
  return el(
    "div",
    {
      className: SHELL,
      style: {
        width: 320,
        borderLeft: `3px solid ${accent}`,
      },
    },
    el(
      "div",
      { className: "flex items-center gap-2" },
      el("span", { style: { color: accent }, "aria-hidden": true }, headerIcon),
      el(
        "span",
        {
          className:
            "font-mono text-[9.5px] uppercase tracking-[0.14em] font-medium",
          style: { color: accent },
        },
        header,
      ),
    ),
    el(
      "div",
      { className: "mt-1.5 font-serif text-[14px] text-ink-0 leading-snug" },
      title,
    ),
    meta
      ? el(
          "div",
          { className: "mt-1 font-mono text-[10.5px] text-ink-2" },
          meta,
        )
      : null,
    footer ? el("div", { className: "mt-2.5" }, footer) : null,
  );
}

/**
 * "启动成功" toast. Brand-accent left bar with Play glyph; subtitle shows the
 * LE profile and an optional process id (host returns numeric PID after
 * spawn — pass as `pid` if available).
 */
export function toastLaunchSuccess(
  gameName: string,
  profile?: string | null,
  pid?: number | null,
): void {
  const metaParts: string[] = [];
  if (profile) metaParts.push(`LE 转区 · ${profile}`);
  if (pid != null) metaParts.push(`PID ${pid}`);
  metaParts.push("计时已开始");

  toast.custom(
    () =>
      shell({
        accent: "var(--accent)",
        header: "启动成功",
        headerIcon: el(Play, { size: 13, fill: "currentColor", strokeWidth: 1 }),
        title: gameName,
        meta: metaParts.join(" · "),
      }),
    { duration: 4000 },
  );
}

/**
 * "本次会话已记" toast — teal-accented session-recorded card. Pass the
 * session duration in seconds; the card formats it as `Hh Mm` with the
 * letter units in subdued text. `totalSec` is the cumulative play time
 * across all sessions for this game (post-credit), shown as a small
 * "累计 N.M h" hint.
 */
export function toastSessionRecorded(
  gameName: string,
  durationSec: number,
  totalSec: number,
): void {
  const totalMin = Math.max(0, Math.floor(durationSec / 60));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;

  const totalHours = (totalSec / 3600).toFixed(1);

  const big = el(
    "div",
    { className: "flex items-baseline gap-1" },
    el(
      "span",
      {
        className: "font-serif text-[22px] text-ink-0",
      },
      h > 0 ? `${h}` : `${m}`,
    ),
    el(
      "span",
      { className: "text-[12px] text-ink-2" },
      h > 0 ? "h" : "m",
    ),
    h > 0
      ? el(
          Fragment,
          null,
          el("span", { className: "font-serif text-[22px] text-ink-0 ml-2" }, m),
          el("span", { className: "text-[12px] text-ink-2" }, "m"),
        )
      : null,
    el(
      "span",
      {
        className: "font-mono text-[10px] text-ink-3 ml-2",
      },
      `累计 ${totalHours} h`,
    ),
  );

  toast.custom(
    () =>
      shell({
        accent: "#6fd1c8",
        header: "本次会话已记",
        headerIcon: el(Clock, { size: 13, strokeWidth: 1.6 }),
        title: gameName,
        meta: big,
      }),
    { duration: 5000 },
  );
}

/**
 * "扫描完成" toast — yellow-accented summary with optional review-needed
 * count. Pass `reviewCount > 0` to trigger the design's mini-CTA footer
 * ("立即复核 →"). The CTA invokes the supplied `onReview` handler when
 * clicked (caller is responsible for navigating); when omitted the toast
 * just shows the counts.
 */
export function toastScanFinished(
  added: number,
  autoBound: number,
  reviewCount: number,
  onReview?: () => void,
): void {
  const meta =
    reviewCount > 0
      ? `新增 ${added} 部 · 自动入库 ${autoBound} · 待复核 ${reviewCount}`
      : `新增 ${added} 部 · 全部自动入库`;

  const footer =
    reviewCount > 0 && onReview
      ? el(
          "button",
          {
            type: "button",
            onClick: onReview,
            className:
              "inline-flex h-7 items-center px-3 font-medium text-[11px]",
            style: {
              background: "var(--accent)",
              color: "var(--accent-on)",
              borderRadius: "var(--r-md)",
            },
          },
          "立即复核 →",
        )
      : null;

  toast.custom(
    () =>
      shell({
        accent: "#ffd166",
        header:
          reviewCount > 0
            ? `扫描完成 · ${reviewCount} 项待复核`
            : "扫描完成",
        headerIcon: el(AlertTriangle, { size: 13, strokeWidth: 1.6 }),
        title: meta,
        footer,
      }),
    { duration: reviewCount > 0 ? 8000 : 4000 },
  );
}
