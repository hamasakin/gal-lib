/**
 * useSmoothWheel — 滚轮平滑插值 hook。
 *
 * Windows 滚轮是离散的（每个 tick 跳 ~100px），原生滚动视觉上像"硬切"。
 * 这个 hook 拦截 wheel 事件，把 deltaY 累加到 targetScrollTop，每帧
 * RAF lerp(current, target, ease) 写回 scrollTop，产生惯性平滑感。
 *
 * 与 react-virtual 兼容：lerp 仍然写 scrollTop，浏览器派发 scroll 事件，
 * react-virtual 监听 scroll 更新 virtualItems — 现有行虚拟化逻辑无需改动。
 *
 * 不拦截：
 *   - ctrlKey + wheel（pinch zoom）
 *   - horizontal wheel（|deltaX| > |deltaY|）
 */

import { useEffect, type RefObject } from "react";

interface Options {
  /**
   * Lerp factor per frame. Larger = snappier (less inertia).
   *   0.10 — soft, ~250ms tail
   *   0.15 — balanced (default)
   *   0.25 — barely-there inertia, mostly direct
   */
  ease?: number;
}

export function useSmoothWheel(
  ref: RefObject<HTMLElement | null>,
  options: Options = {},
): void {
  const ease = options.ease ?? 0.15;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let target = el.scrollTop;
    let raf: number | null = null;

    const tick = () => {
      const current = el.scrollTop;
      const dy = target - current;
      if (Math.abs(dy) < 0.5) {
        el.scrollTop = target;
        raf = null;
        return;
      }
      el.scrollTop = current + dy * ease;
      raf = requestAnimationFrame(tick);
    };

    const onWheel = (e: WheelEvent) => {
      // Skip pinch-zoom (ctrl+wheel) — let browser default-zoom run.
      if (e.ctrlKey) return;
      // Skip horizontal scroll.
      if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;

      e.preventDefault();

      // Re-sync target to current scrollTop if no inertia is running —
      // covers cases where user scrolled by other means (drag scrollbar,
      // programmatic scrollTo, resize, etc.).
      if (raf == null) {
        target = el.scrollTop;
      }

      const max = el.scrollHeight - el.clientHeight;
      target = Math.max(0, Math.min(max, target + e.deltaY));

      if (raf == null) {
        raf = requestAnimationFrame(tick);
      }
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      if (raf != null) cancelAnimationFrame(raf);
    };
  }, [ref, ease]);
}
