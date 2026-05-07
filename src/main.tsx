import "./index.css";
import { createRoot } from "react-dom/client";
import { createHashRouter, RouterProvider } from "react-router-dom";
import App from "./App";
// 01c: fire-and-forget DB warm-up so tauri-plugin-sql's lazy Database.load
// actually executes (and runs the 0001 migration) on first dev launch.
// Without this trigger, app.db never materializes and the plan's verify
// block fails. Errors are swallowed: 01d/Phase 2 will introduce real DB
// consumers with proper error handling.
import { getDb } from "./lib/db";
void getDb().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("[gal-lib] failed to initialize DB:", e);
});

// 01d will overwrite this file to mount <RouterProvider> against src/router.tsx with /settings etc.
const router = createHashRouter([
  {
    path: "/",
    element: <App />,
  },
]);

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("#root element not found in index.html");
}
createRoot(rootEl).render(<RouterProvider router={router} />);
