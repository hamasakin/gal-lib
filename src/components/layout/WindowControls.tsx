import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, Square, X } from 'lucide-react';

/**
 * 三个窗口控制按钮（最小化 / 最大化切换 / 关闭）。
 *
 * Pitfall guard (RESEARCH §Pitfall 5):
 * - 外层 wrapper 显式标注 `data-tauri-drag-region="false"`，阻止 drag region
 *   行为继承到按钮上；这是必要的，因为父级 Titlebar 的 drag region 属性虽然
 *   不会自动传播到子元素，但为防御未来重构（万一有人把按钮塞进 drag region 内），
 *   这里再加一道显式拒绝。
 * - 按钮自身使用原生 <button>，不依赖 shadcn <Button>（后者的 size variant
 *   与 36x36 方形 hit-target 不匹配）。
 */
export function WindowControls() {
  const win = getCurrentWindow();

  return (
    <div
      data-tauri-drag-region="false"
      className="flex h-full items-stretch"
      aria-label="窗口控制"
    >
      <button
        type="button"
        onClick={() => void win.minimize()}
        className="window-ctrl-btn"
        aria-label="最小化"
      >
        <Minus size={15} strokeWidth={2} />
      </button>
      <button
        type="button"
        onClick={() => void win.toggleMaximize()}
        className="window-ctrl-btn"
        aria-label="最大化"
      >
        <Square size={13} strokeWidth={2} />
      </button>
      <button
        type="button"
        onClick={() => void win.close()}
        className="window-ctrl-btn close"
        aria-label="关闭"
      >
        <X size={15} strokeWidth={2} />
      </button>
    </div>
  );
}
