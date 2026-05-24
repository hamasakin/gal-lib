import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  /**
   * Render-prop-style fallback. Receives the captured error and a `reset`
   * callback (clears the error state so the boundary re-mounts its children).
   * If omitted, a minimal default is rendered.
   */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Top-level error boundary so a render crash in any route doesn't take the
 * whole webview to a blank screen (no ErrorBoundary was present before —
 * 260524 review "整体观察"). Wrap each route OR the entire RouterProvider
 * tree in one of these.
 *
 * Class component because React still requires `componentDidCatch` /
 * `getDerivedStateFromError` for actual catch behaviour — there is no hook
 * equivalent. Kept small + reusable; styling lives at the fallback prop.
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary] caught:", error, info);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.reset);
      }
      return (
        <div className="flex h-full min-h-[200px] w-full flex-col items-center justify-center gap-3 p-6 text-center">
          <div className="font-serif text-[18px] text-ink-0">页面渲染出错</div>
          <div className="max-w-[480px] truncate font-mono text-[11px] text-ink-2">
            {this.state.error.message || String(this.state.error)}
          </div>
          <button
            type="button"
            onClick={this.reset}
            className="mt-2 rounded border border-line px-3 py-1 font-mono text-[11px] text-ink-1 hover:bg-bg-2"
          >
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
