/**
 * Titlebar slot for Phase 1.
 *
 * 01d (this plan) ships an empty 36px-tall placeholder bar so the App Shell's
 * top edge is visually self-consistent. 01e overwrites THIS FILE with the
 * real custom Titlebar (drag region + window controls). Keeping the import
 * path stable means 01d's <App> JSX does not need to change in 01e.
 */
export function TitlebarSlot() {
  return (
    <div
      className="h-9 bg-card border-b border-border"
      data-testid="titlebar-slot"
    />
  );
}
