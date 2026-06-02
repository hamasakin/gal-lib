/**
 * Quick 260514-upd — Tauri auto-update wrapper.
 * Quick 260603-3w9 — 检查与下载分离。
 *
 * Wraps `@tauri-apps/plugin-updater` with a state-machine API the UI can
 * subscribe to. The plugin's `check()` hits the endpoint declared in
 * tauri.conf.json (`plugins.updater.endpoints` → GitHub Releases
 * `latest.json`) and validates the signature against `plugins.updater.pubkey`.
 *
 * 检查与下载分离：`checkForUpdates()` 只探测，命中返回 `{phase:'available', update}`
 * 携带 Tauri 的 `Update` 句柄，绝不在此函数内自动下载安装；真正的下载安装由调用方
 * （toast「现在更新」action / Settings「下载更新」按钮）在用户确认后调
 * `downloadAndInstallUpdate(update)` 触发。这样自动检测不再静默强制安装。
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
  | { phase: "available"; version: string; update: Update }
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
 * 仅检查更新，不下载安装。
 *
 * 命中返回 `{phase:'available', version, update}`，把 Tauri 的 `Update` 句柄
 * 一起塞进 state 交给调用方——调用方在用户确认后靠它调
 * `downloadAndInstallUpdate(update)` 触发下载。未命中返回 `{phase:'up-to-date'}`。
 *
 * `silent: true`（启动自动检测）吃掉一切错误返回 `{phase:'idle'}`；
 * `silent: false`（手动检查）把错误暴露为 `{phase:'error'}`。
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

    // 仅探测：命中即返回 available 携带 Update 句柄，不在此处下载安装。
    const state: UpdaterState = { phase: "available", version: update.version, update };
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

/**
 * 下载并安装一个已检出的更新（passive on Windows）。
 *
 * 接收 `checkForUpdates` 命中时返回的 `Update` 句柄，由调用方在用户确认后触发。
 * 通过 `onProgress` emit `downloading` 进度，完成返回 `{phase:'ready', version}`，
 * 之后调用方靠 `relaunchApp()` 重启生效。出错返回 `{phase:'error'}`
 * （此处不需要 silent——调用方都是用户主动触发的下载）。
 */
export async function downloadAndInstallUpdate(
  update: Update,
  opts?: { onProgress?: (state: UpdaterState) => void },
): Promise<UpdaterState> {
  const emit = (s: UpdaterState) => opts?.onProgress?.(s);
  const version = update.version;

  try {
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
