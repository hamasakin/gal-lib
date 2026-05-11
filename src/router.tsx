import { createHashRouter } from "react-router-dom";
import App from "./App";
import { Library } from "./routes/Library";
import { Settings } from "./routes/Settings";
import Detail from "./routes/Detail";
import Persons from "./routes/Persons";
import Stats from "./routes/Stats";
import Screenshots from "./routes/Screenshots";
import Scan from "./routes/Scan";

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
 *
 * Phase 5 (05d) addition:
 *   /stats     → <Stats />    (playtime trend AreaChart + top-N BarChart;
 *                              fed by 05a/05b/05c stats invokes)
 */
export const router = createHashRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <Library /> },
      { path: "settings", element: <Settings /> },
      { path: "stats", element: <Stats /> },
      { path: "screenshots", element: <Screenshots /> },
      { path: "scan", element: <Scan /> },
      { path: "games/:id", element: <Detail /> },
      { path: "persons/:id", element: <Persons /> },
    ],
  },
]);
