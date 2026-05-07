import { createHashRouter } from "react-router-dom";
import App from "./App";
import { Library } from "./routes/Library";
import { Settings } from "./routes/Settings";
import Detail from "./routes/Detail";

/**
 * Application router.
 *
 * Layout-route pattern: `<App />` is the parent (Layout: TitlebarSlot +
 * Sidebar + Main with <Outlet />); children are rendered into <Outlet />.
 *
 * HashRouter is locked by CONTEXT.md (Tauri tauri:// protocol path issues
 * make path-based routers unreliable). Do not switch to history-mode or
 * in-memory routers in this project.
 *
 * Phase 1 routes:
 *   /          → <Library />
 *   /settings  → <Settings />
 *
 * Phase 3 (03f) addition:
 *   /games/:id → <Detail />   (minimal: cover + name + total time +
 *                              LE config form + sessions list)
 */
export const router = createHashRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <Library /> },
      { path: "settings", element: <Settings /> },
      { path: "games/:id", element: <Detail /> },
    ],
  },
]);
