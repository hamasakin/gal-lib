import "./index.css";
import { createRoot } from "react-dom/client";
import { createHashRouter, RouterProvider } from "react-router-dom";
import App from "./App";

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
