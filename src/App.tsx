// Phase 1 / 01a placeholder root component.
// 01d will replace this with RootLayout (Titlebar + Sidebar + Main + <Outlet />).
// Inline styles are used here because Tailwind is not yet installed (01b's job).
// Colors mirror the locked palette in UI-SPEC: bg #0F1115, text #E5E7EB.
export default function App() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        fontFamily:
          'ui-sans-serif, system-ui, "Segoe UI", "Microsoft YaHei", sans-serif',
        fontSize: 14,
        background: "#0F1115",
        color: "#E5E7EB",
      }}
    >
      Hello gal-lib
    </div>
  );
}
