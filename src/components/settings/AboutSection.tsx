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
import { useTranslation } from "react-i18next";
import {
  checkForUpdates,
  getCurrentVersion,
  relaunchApp,
  type UpdaterState,
} from "@/lib/updater";
import { usePreferencesStore } from "@/store/preferences";
import { Toggle } from "@/components/ui/toggle";

export function AboutSection() {
  const { t } = useTranslation();
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
        <span className="font-mono text-[11px] text-ink-3">{t("about.current_version")}</span>
        <span className="font-mono text-ink-0">v{version}</span>
      </div>

      <div className="flex items-center justify-between gap-3 border-b border-ink-7/40 py-1.5">
        <div className="flex flex-1 items-center gap-3">
          <span className="font-mono text-[11px] text-ink-3">{t("about.check_updates")}</span>
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
              {t("about.restart_now")}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void onCheck()}
              disabled={busy}
              className="inline-flex h-8 items-center border border-ink-7 bg-card px-3 text-[12px] text-ink-0 transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              style={{ borderRadius: "var(--r-md)" }}
            >
              {busy ? t("about.checking") : t("about.check_now")}
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-b border-ink-7/40 py-1.5">
        <div>
          <div className="font-mono text-[11px] text-ink-3">{t("about.auto_check")}</div>
          <div className="mt-0.5 text-[10.5px] text-ink-3">
            {t("about.auto_check_desc")}
          </div>
        </div>
        <Toggle
          variant="outline"
          size="sm"
          pressed={autoCheckUpdate}
          onPressedChange={setAutoCheckUpdate}
          aria-label={t("about.auto_check_aria")}
        >
          {autoCheckUpdate ? t("about.enabled") : t("about.disabled")}
        </Toggle>
      </div>

      <div className="pt-2 font-mono text-[10.5px] text-ink-3">
        {t("about.credits")}
      </div>
    </div>
  );
}

function UpdateStateLabel({ state }: { state: UpdaterState }) {
  const { t } = useTranslation();
  switch (state.phase) {
    case "idle":
      return null;
    case "checking":
      return <span className="text-[11px] text-ink-3">{t("about.checking")}</span>;
    case "up-to-date":
      return <span className="text-[11px] text-ink-3">{t("about.up_to_date")}</span>;
    case "downloading": {
      const pct =
        state.total && state.downloaded != null
          ? Math.min(100, Math.round((state.downloaded / state.total) * 100))
          : null;
      return (
        <span className="text-[11px] text-ink-3">
          {t("about.downloading", { version: state.version })}
          {pct != null ? ` · ${pct}%` : "…"}
        </span>
      );
    }
    case "ready":
      return (
        <span className="text-[11px] text-primary">
          {t("about.ready", { version: state.version })}
        </span>
      );
    case "error":
      return (
        <span className="text-[11px] text-destructive">
          {t("about.check_failed", { message: state.message })}
        </span>
      );
  }
}
