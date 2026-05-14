/**
 * Quick 260514-upd — Tauri auto-update wrapper.
 *
 * Wraps `@tauri-apps/plugin-updater` with a state-machine API the UI can
 * subscribe to. The plugin's `check()` hits the endpoint declared in
 * tauri.conf.json (`plugins.updater.endpoints` → GitHub Releases
 * `latest.json`) and validates the signature against `plugins.updater.pubkey`.
 *
 * `silent: true` swallows all errors (offline / no release / network) — this
 * is the startup path. `silent: false` surfaces errors so the Settings page
 * can show what went wrong.
 *
 * `downloadAndInstall()` blocks until the installer is fetched; on Windows
 * with `installMode: "passive"` the NSIS installer runs in the background.
 * We do NOT relaunch automatically — the caller (toast action / Settings
 * button) decides.
 */

import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";

export type UpdaterState =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "up-to-date" }
  | { phase: "downloading"; version: string; downloaded?: number; total?: number }
  | { phase: "ready"; version: string }
  | { phase: "error"; message: string };

export interface CheckOptions {
  /**
   * When true, errors are swallowed and returned as `{phase: 'idle'}`.
   * Used by the App startup auto-check so a flaky network never disturbs UX.
   */
  silent: boolean;
  onProgress?: (state: UpdaterState) => void;
}

/**
 * Check for an update and, if found, download + install (passive on Windows).
 * Returns the final state. Caller relaunches via `relaunchApp()`.
 *
 * Idempotent: running twice in the same session when an update is already
 * staged returns `{phase: 'ready'}` without re-downloading (Tauri plugin
 * memoizes the resolved installer).
 */
export async function checkForUpdates(opts: CheckOptions): Promise<UpdaterState> {
  const { silent, onProgress } = opts;
  const emit = (s: UpdaterState) => onProgress?.(s);

  try {
    emit({ phase: "checking" });
    const update: Update | null = await check();
    if (!update) {
      const state: UpdaterState = { phase: "up-to-date" };
      emit(state);
      return state;
    }

    const version = update.version;
    let downloaded = 0;
    let total: number | undefined;
    emit({ phase: "downloading", version });

    await update.downloadAndInstall((event) => {
      if (event.event === "Started") {
        total = event.data.contentLength ?? undefined;
        emit({ phase: "downloading", version, downloaded: 0, total });
      } else if (event.event === "Progress") {
        downloaded += event.data.chunkLength;
        emit({ phase: "downloading", version, downloaded, total });
      }
    });

    const state: UpdaterState = { phase: "ready", version };
    emit(state);
    return state;
  } catch (err) {
    if (silent) {
      // Eat the error — caller is the silent startup check. Surface to
      // console so debugging via devtools is still possible.
      console.warn("[updater] silent check failed:", err);
      const state: UpdaterState = { phase: "idle" };
      emit(state);
      return state;
    }
    const message = err instanceof Error ? err.message : String(err);
    const state: UpdaterState = { phase: "error", message };
    emit(state);
    return state;
  }
}

/** Restart the app so the staged update takes effect. */
export async function relaunchApp(): Promise<void> {
  await relaunch();
}

/** Tauri's app version (from `tauri.conf.json`/`Cargo.toml` package version). */
export async function getCurrentVersion(): Promise<string> {
  return getVersion();
}
