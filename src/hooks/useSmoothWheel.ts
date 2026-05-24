/**
 * useSmoothWheel — 滚轮平滑滚动 hook（lerp-to-target / 缓动到目标）。
 *
 * Windows 鼠标滚轮是离散的（每个 tick 跳 ~100px），原生滚动视觉上像"硬切"。
 * 此 hook 改用 **lerp-to-target（缓动到目标）** 模型：维护一个目标滚动位置
 * `target`，每帧让真实 `scrollTop` 按指数比例趋近它。起步、收尾都顺，手感
 * 接近键盘配 CSS `scroll-behavior: smooth`：
 *
 *   on wheel(deltaY):
 *     target += deltaY * step
 *     target = clamp(target, 0, scrollHeight - clientHeight)
 *
 *   每帧 RAF tick:
 *     scrollTop += (target - scrollTop) * lerpFactor   // 指数趋近，ease-out
 *     |target - scrollTop| < 0.5 时 snap 到 target 并 stop
 *
 * 指数趋近天然带 ease-in（起步时 diff 大但每帧只走一个比例，不会瞬间窜出）
 * 与 ease-out（接近目标时 diff 变小，逐帧减速到停）。
 *
 * 与 react-virtual 兼容：仍然写 native scrollTop，浏览器派发 scroll 事件，
 * react-virtual 监听 scroll 更新 virtualItems — 行虚拟化逻辑无需改动。
 *
 * 外部滚动再同步（external-scroll re-sync）：
 *   除滚轮外，用户还能用滚动条拖拽 / 键盘 PageDown / 程序写 scrollTop 改变
 *   位置。这些「非滚轮」滚动若发生在 RAF lerp 循环仍在跑时，闭包里的 `target`
 *   会失同步，下一帧 `tick` 算出一个大 `diff` 把 `scrollTop` 又拽回旧位置
 *   （肉眼看就是滚动条「弹回」）。为此 hook 监听 `el` 的 `scroll` 事件，并
 *   记录每次自己的 `tick` 写入的值 `lastWritten`：当 scroll 事件里的真实
 *   `scrollTop` 与 `lastWritten` 偏差超过 1px，说明改动来自 hook 之外，
 *   立即把 `target` 重对齐到真实 `scrollTop` 并取消正在跑的 lerp 循环——
 *   不再与外部滚动较劲。滚轮平滑本身完全不变。
 *
 * 不拦截：
 *   - ctrlKey + wheel（pinch zoom）
 *   - horizontal wheel（|deltaX| > |deltaY|）
 */

import { useEffect, type RefObject } from "react";

interface Options {
  /**
   * 每帧向 target 趋近的 ease 系数（0..1）。越大收尾越快越"硬"，
   * 越小越"软"越拖。
   *   0.12 → 偏软（缓动尾巴长，慢悠悠贴到目标）
   *   0.18 → 默认（顺滑，ease-out 收尾自然）
   *   0.25 → 偏直接（响应快，接近原生但仍带平滑）
   */
  lerpFactor?: number;

  /**
   * 每次 wheel tick 的 deltaY 位移倍数。100px wheel tick × step =
   * 累加进 target 的滚动量。
   *   0.8 → 一次滚轮约滑几行卡片
   *   1.0 → 约等同原生滚动位移量（默认）
   *   1.5 → 一次滚轮滚更多行
   */
  step?: number;
}

export function useSmoothWheel(
  ref: RefObject<HTMLElement | null>,
  options: Options = {},
): void {
  const lerpFactor = options.lerpFactor ?? 0.18;
  const step = options.step ?? 1.0;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // target — 目标滚动位置，初始化为当前 scrollTop。
    let target = el.scrollTop;
    let raf: number | null = null;
    // lastWritten — hook 自己的 tick 最近一次写入 el.scrollTop 的值。
    // scroll 事件处理器用它区分「滚动来自 hook」还是「来自外部」。
    let lastWritten = el.scrollTop;

    const tick = () => {
      // 每帧重夹 target：scrollHeight 在虚拟列表下会变化，每帧 clamp 更稳。
      const max = el.scrollHeight - el.clientHeight;
      target = Math.max(0, Math.min(max, target));

      const diff = target - el.scrollTop;

      // 接近目标 — snap 到 target 并停止 RAF（边界已在 clamp 时处理，
      // target 不会超界，diff 自然收敛到 0，不空转顶墙）。
      if (Math.abs(diff) < 0.5) {
        el.scrollTop = target;
        lastWritten = el.scrollTop;
        raf = null;
        return;
      }

      el.scrollTop = el.scrollTop + diff * lerpFactor;
      lastWritten = el.scrollTop;
      raf = requestAnimationFrame(tick);
    };

    // 外部滚动再同步 — 滚动条拖拽 / 键盘 / 程序写 scrollTop 都会派发
    // scroll 事件。若真实 scrollTop 与 hook 自己最近写入的值偏差超过 1px，
    // 说明改动来自外部：把 target 重对齐并取消 lerp 循环，不再较劲。
    const onScroll = () => {
      if (Math.abs(el.scrollTop - lastWritten) > 1) {
        target = el.scrollTop;
        lastWritten = el.scrollTop;
        if (raf != null) {
          cancelAnimationFrame(raf);
          raf = null;
        }
      }
    };

    const onWheel = (e: WheelEvent) => {
      // Skip pinch-zoom — let browser default-zoom run.
      if (e.ctrlKey) return;
      // Skip horizontal scroll.
      if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;

      e.preventDefault();

      // RAF 已停时把 target 重新对齐到真实 scrollTop —— 避免空闲期间
      // 用户用滚动条/键盘改了位置导致 target 失同步。RAF 未停时不重对齐，
      // 连续快速滚动 target 持续叠加 deltaY，多 tick 自然累加。
      // WR-03 fix: normalize deltaMode to pixels. WheelEvent.deltaMode is
      // 0 (pixel) by default in Chromium, but Firefox + some shells / a11y
      // tools fire line-mode (1) or page-mode (2). Without normalization
      // those modes deliver deltaY = 1..3 (line) or 1 (page), and the lerp
      // accumulator barely moves — scrolling feels frozen.
      let deltaPx = e.deltaY;
      if (e.deltaMode === 1) {
        // Line: 16px matches Chromium's own fallback line-height.
        deltaPx *= 16;
      } else if (e.deltaMode === 2) {
        // Page: one viewport-height.
        deltaPx *= el.clientHeight;
      }

      if (raf == null) target = el.scrollTop;
      target += deltaPx * step;
      const max = el.scrollHeight - el.clientHeight;
      target = Math.max(0, Math.min(max, target));

      if (raf == null) {
        raf = requestAnimationFrame(tick);
      }
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("scroll", onScroll);
      if (raf != null) cancelAnimationFrame(raf);
    };
  }, [ref, lerpFactor, step]);
}
