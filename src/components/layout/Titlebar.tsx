import { WindowControls } from './WindowControls';

/**
 * v1.2 titlebar — Hakoniwa rebrand.
 *
 * Pattern: 32px tall row with seal mark (16×16 brand square holding 「箱」),
 * serif app title 箱庭, mono romaji meta, then window controls.
 * -webkit-app-region: drag is set on the inner div (NOT the <header>) so the
 * WindowControls slot stays clickable.
 */
export function Titlebar() {
  return (
    <header className="titlebar-root flex h-10 items-stretch border-b border-line bg-bg-1 text-ink-2">
      <div
        data-tauri-drag-region
        className="flex flex-1 items-center gap-3 px-4"
      >
        <span
          aria-hidden
          className="grid h-[18px] w-[18px] place-items-center rounded-sm font-serif text-[12px] font-bold text-white"
          style={{
            background: "var(--ink-stamp)",
            boxShadow: "inset 0 0 0 1px rgba(255,255,255,.05)",
          }}
        >
          箱
        </span>
        <span className="font-serif text-[13.5px] tracking-[0.04em] text-ink-1">
          箱庭
        </span>
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-3">
          Hakoniwa · portable
        </span>
      </div>
      <WindowControls />
    </header>
  );
}
