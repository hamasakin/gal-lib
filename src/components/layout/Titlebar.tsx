import { WindowControls } from './WindowControls';

/**
 * v1.1 titlebar — design's library-card aesthetic.
 *
 * Pattern: 32px tall row with `seal` mark (16×16 brand square holding 「書」),
 * serif app title, mono meta hint, then window controls. -webkit-app-region:
 * drag is set on the inner div (NOT the <header>) so the WindowControls slot
 * stays clickable.
 */
export function Titlebar() {
  return (
    <header className="titlebar-root flex h-8 items-center border-b border-line bg-bg-1 text-ink-2">
      <div
        data-tauri-drag-region
        className="flex flex-1 items-center gap-2.5 px-3.5"
      >
        <span
          aria-hidden
          className="grid h-4 w-4 place-items-center rounded-sm font-serif text-[11px] font-bold text-white"
          style={{
            background: "var(--ink-stamp)",
            boxShadow: "inset 0 0 0 1px rgba(255,255,255,.05)",
          }}
        >
          書
        </span>
        <span className="font-serif text-[12px] tracking-[0.04em] text-ink-1">
          gal-lib
        </span>
        <span className="font-mono text-[10.5px] text-ink-3">portable</span>
      </div>
      <WindowControls />
    </header>
  );
}
