/**
 * Quick 260514-upd — Settings "关于" section.
 *
 * Three blocks:
 *   1. Current version (from `@tauri-apps/api/app#getVersion`)
 *   2. "立即检查更新" button — state machine (idle → checking → downloading
 *      → ready/up-to-date/error); ready offers "立即重启"
 *   3. "启动时自动检查" toggle — persisted via `usePreferencesStore`
 *
 * Errors here are NOT silent (silent: false): manual button = user expects
 * feedback. Startup auto-check (App.tsx) uses silent: true.
 */

import { useEffect, useState } from "react";
import {
  checkForUpdates,
  getCurrentVersion,
  relaunchApp,
  type UpdaterState,
} from "@/lib/updater";
import { usePreferencesStore } from "@/store/preferences";
import { Toggle } from "@/components/ui/toggle";

export function AboutSection() {
  const autoCheckUpdate = usePreferencesStore((s) => s.autoCheckUpdate);
  const setAutoCheckUpdate = usePreferencesStore((s) => s.setAutoCheckUpdate);
  const [version, setVersion] = useState<string>("…");
  const [state, setState] = useState<UpdaterState>({ phase: "idle" });

  useEffect(() => {
    let cancelled = false;
    getCurrentVersion()
      .then((v) => {
        if (!cancelled) setVersion(v);
      })
      .catch((e: unknown) => {
        // eslint-disable-next-line no-console
        console.error("[About] getVersion failed:", e);
        if (!cancelled) setVersion("(unknown)");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const busy = state.phase === "checking" || state.phase === "downloading";

  async function onCheck() {
    setState({ phase: "checking" });
    await checkForUpdates({
      silent: false,
      onProgress: (s) => setState(s),
    });
  }

  return (
    <div className="space-y-3 text-[12.5px] text-ink-1">
      <div className="flex items-center justify-between border-b border-ink-7/40 py-1.5">
        <span className="font-mono text-[11px] text-ink-3">当前版本</span>
        <span className="font-mono text-ink-0">v{version}</span>
      </div>

      <div className="flex items-center justify-between gap-3 border-b border-ink-7/40 py-1.5">
        <div className="flex flex-1 items-center gap-3">
          <span className="font-mono text-[11px] text-ink-3">检查更新</span>
          <UpdateStateLabel state={state} />
        </div>
        <div className="flex items-center gap-2">
          {state.phase === "ready" ? (
            <button
              type="button"
              onClick={() => void relaunchApp()}
              className="inline-flex h-8 items-center border border-primary/50 bg-primary/15 px-3 text-[12px] text-primary transition-colors hover:bg-primary/25"
              style={{ borderRadius: "var(--r-md)" }}
            >
              立即重启
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void onCheck()}
              disabled={busy}
              className="inline-flex h-8 items-center border border-ink-7 bg-card px-3 text-[12px] text-ink-0 transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              style={{ borderRadius: "var(--r-md)" }}
            >
              {busy ? "检查中…" : "立即检查更新"}
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-b border-ink-7/40 py-1.5">
        <div>
          <div className="font-mono text-[11px] text-ink-3">启动时自动检查</div>
          <div className="mt-0.5 text-[10.5px] text-ink-3">
            启动后 5 秒静默检查 GitHub Releases，发现新版本后台下载
          </div>
        </div>
        <Toggle
          variant="outline"
          size="sm"
          pressed={autoCheckUpdate}
          onPressedChange={setAutoCheckUpdate}
          aria-label="启动时自动检查更新"
        >
          {autoCheckUpdate ? "已开启" : "已关闭"}
        </Toggle>
      </div>

      <div className="pt-2 font-mono text-[10.5px] text-ink-3">
        元数据来源：Bangumi · VNDB ·
        转区启动：Locale Emulator
      </div>
    </div>
  );
}

function UpdateStateLabel({ state }: { state: UpdaterState }) {
  switch (state.phase) {
    case "idle":
      return null;
    case "checking":
      return <span className="text-[11px] text-ink-3">检查中…</span>;
    case "up-to-date":
      return <span className="text-[11px] text-ink-3">已是最新版本</span>;
    case "downloading": {
      const pct =
        state.total && state.downloaded != null
          ? Math.min(100, Math.round((state.downloaded / state.total) * 100))
          : null;
      return (
        <span className="text-[11px] text-ink-3">
          下载中 v{state.version}
          {pct != null ? ` · ${pct}%` : "…"}
        </span>
      );
    }
    case "ready":
      return (
        <span className="text-[11px] text-primary">
          v{state.version} 已就绪 — 重启后生效
        </span>
      );
    case "error":
      return (
        <span className="text-[11px] text-destructive">
          检查失败：{state.message}
        </span>
      );
  }
}
