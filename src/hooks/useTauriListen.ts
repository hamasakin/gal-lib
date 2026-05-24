import { useEffect, useRef } from "react";
import { listen, type EventCallback, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * Race-safe Tauri event listener.
 *
 * Replaces the `listen(event, handler).then(fn => unlistenRef = fn)` pattern.
 * Under React StrictMode (and Vite HMR re-mounts), `useEffect` cleanup runs
 * before the `listen()` Promise resolves, so the captured `unlistenRef` is
 * still null and the subscription leaks. The leaked listener then double-fires
 * every event on the next mount.
 *
 * The hook tracks a `cancelled` flag inside the effect closure. When `listen`
 * resolves after the effect was already torn down, the resolved unlisten is
 * fired immediately and no event is ever delivered to the stale handler.
 *
 * The `handlerRef` indirection (latest-wins via mutable ref) lets the caller
 * pass an inline handler that closes over fresh state without re-subscribing
 * each render — the subscription tears down only when `event` or `enabled`
 * changes.
 */
export function useTauriListen<T>(
  event: string,
  handler: EventCallback<T>,
  enabled: boolean = true,
): void {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let unlisten: UnlistenFn | null = null;
    listen<T>(event, (e) => handlerRef.current(e)).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [event, enabled]);
}
