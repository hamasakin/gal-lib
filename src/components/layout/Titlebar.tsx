import { Library } from 'lucide-react';
import { WindowControls } from './WindowControls';

/**
 * 自定义 36px 高度 titlebar。
 *
 * 结构契约 (RESEARCH §Pattern 4 + §Pitfall 5):
 * - 外层 <header> 是 layout 容器，**自身不带** data-tauri-drag-region。
 * - drag region 是 <header> 的第一个子节点 <div>，占据 flex-1 的所有剩余空间，
 *   左侧渲染 app 图标 + 文字 `gal-lib`（这两者直接作为 drag region 的子节点，
 *   即使 data-tauri-drag-region 不传播给它们也无所谓 —— 用户在它们之上按住
 *   时，鼠标事件冒泡到 drag region div 上仍然触发拖拽 hook，这是 Tauri 推荐
 *   的 "drag region 含子节点" 模式）。
 * - WindowControls 作为 <header> 的兄弟节点（与 drag region div 同级），
 *   显式 data-tauri-drag-region="false" 确保按钮区不被拖动 hook 偷走 click。
 */
export function Titlebar() {
  return (
    <header className="titlebar-root flex items-center h-9 bg-card border-b border-border text-foreground">
      <div
        data-tauri-drag-region
        className="flex-1 h-full flex items-center gap-2 px-3"
      >
        <Library size={14} strokeWidth={2} aria-hidden="true" />
        <span className="text-[13px] font-medium leading-none tracking-tight">
          gal-lib
        </span>
      </div>
      <WindowControls />
    </header>
  );
}
