/**
 * useSmoothWheel — 滚轮平滑 + 惯性 hook（macOS-like）。
 *
 * Windows 鼠标滚轮是离散的（每个 tick 跳 ~100px），原生滚动视觉上像"硬切"。
 * 此 hook 改用 **速度+衰减** 模型（而非 lerp-to-target），模拟 macOS 那种
 * "推一下持续滑、自然减速到停" 的手感：
 *
 *   on wheel(deltaY):
 *     velocity += deltaY * impulse        // 累加冲量
 *     velocity = clamp(±maxVelocity)
 *
 *   每帧 RAF tick:
 *     scrollTop += velocity
 *     velocity *= friction                 // 指数衰减
 *     |velocity| < 0.1 时 stop
 *
 * 与 react-virtual 兼容：仍然写 native scrollTop，浏览器派发 scroll 事件，
 * react-virtual 监听 scroll 更新 virtualItems — 行虚拟化逻辑无需改动。
 *
 * 不拦截：
 *   - ctrlKey + wheel（pinch zoom）
 *   - horizontal wheel（|deltaX| > |deltaY|）
 */

import { useEffect, type RefObject } from "react";

interface Options {
  /**
   * 每帧速度衰减系数（0..1）。越接近 1 = 越长的惯性尾巴。
   *   0.85 → ~250ms tail（响应直接，几乎无惯性）
   *   0.92 → ~500ms tail（默认，类 macOS 鼠标滚轮）
   *   0.95 → ~1000ms tail（明显滑行感）
   */
  friction?: number;

  /**
   * 单次 wheel 事件的冲量倍数。100px wheel tick × impulse = 注入到 velocity 的初值。
   *   0.4 → 一次滚轮约滑 1.5 行卡片（默认）
   *   0.6 → 一次滚轮约滑 2.5 行
   *   1.0 → 等同原生滚动量但带尾巴
   */
  impulse?: number;

  /** Velocity 上限（px/frame），防止快速连滚导致失控。 */
  maxVelocity?: number;
}

export function useSmoothWheel(
  ref: RefObject<HTMLElement | null>,
  options: Options = {},
): void {
  const friction = options.friction ?? 0.92;
  const impulse = options.impulse ?? 0.4;
  const maxVelocity = options.maxVelocity ?? 60;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let velocity = 0;
    let raf: number | null = null;

    const tick = () => {
      const max = el.scrollHeight - el.clientHeight;
      const next = el.scrollTop + velocity;

      // Clamp at boundaries — zero velocity so we don't keep RAF alive
      // pushing against the wall.
      if (next <= 0) {
        el.scrollTop = 0;
        velocity = 0;
        raf = null;
        return;
      }
      if (next >= max) {
        el.scrollTop = max;
        velocity = 0;
        raf = null;
        return;
      }

      el.scrollTop = next;
      velocity *= friction;

      if (Math.abs(velocity) < 0.1) {
        raf = null;
        return;
      }
      raf = requestAnimationFrame(tick);
    };

    const onWheel = (e: WheelEvent) => {
      // Skip pinch-zoom — let browser default-zoom run.
      if (e.ctrlKey) return;
      // Skip horizontal scroll.
      if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;

      e.preventDefault();

      velocity += e.deltaY * impulse;
      velocity = Math.max(-maxVelocity, Math.min(maxVelocity, velocity));

      if (raf == null) {
        raf = requestAnimationFrame(tick);
      }
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      if (raf != null) cancelAnimationFrame(raf);
    };
  }, [ref, friction, impulse, maxVelocity]);
}
