//! Process tracking for LE-launched games.
//!
//! ## Why we cannot just `wait()` on LEProc
//!
//! Locale Emulator's `LEProc.exe` is a *launcher*: it spawns the real game
//! process under a transcoded locale, then exits. Waiting on LEProc itself
//! returns instantly and tells us nothing about how long the user played.
//! We therefore have to:
//!   1. Spawn LEProc with `-runas <profile> <game_exe> [args]` (`spawn_le`).
//!   2. Poll the process table for ~30s, looking for a process whose
//!      basename matches `game_exe` (`find_game_pid`). LE's own subprocess
//!      keeps the original exe name, so basename matching is reliable.
//!   3. Open that PID with `OpenProcess(SYNCHRONIZE | QUERY_LIMITED_INFO)`,
//!      `WaitForSingleObject(handle, INFINITE)` inside a `spawn_blocking`
//!      task so the tokio runtime stays free, then read the exit code.
//!
//! ## Polling parameters
//!
//! - `LE_GRACE_MS` (1500ms): LE typically forks within 1s; we sleep first
//!   to avoid racing it before the child even appears.
//! - `POLL_INTERVAL_MS` (500ms): cheap relative to `WaitForSingleObject`
//!   and gives ~2 samples/sec — plenty for human-perceptible launches.
//! - `MAX_POLL_ATTEMPTS` (60): 60 * 500ms = 30s total budget. After this
//!   we surface `ProcessError::Timeout` so the caller can mark the session
//!   `launch_failed`.
//!
//! ## Platform note
//!
//! This module is Win32-only by design (LE itself only runs on Windows;
//! see CLAUDE.md). No `cfg!` guards needed because the project does not
//! compile for other targets.

use std::os::windows::ffi::OsStrExt;
use std::path::Path;
use std::time::Duration;

use sysinfo::{Pid, ProcessesToUpdate, System};
use windows::core::PCWSTR;
use windows::Win32::Foundation::{CloseHandle, HANDLE, HWND};
use windows::Win32::System::Threading::{
    GetExitCodeProcess, GetProcessId, OpenProcess, WaitForSingleObject, INFINITE,
    PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE,
};
use windows::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW};
use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

const POLL_INTERVAL_MS: u64 = 500;
const MAX_POLL_ATTEMPTS: u32 = 60; // 60 * 0.5s = 30s timeout
const LE_GRACE_MS: u64 = 1500; // wait before first scan to let LE spawn

#[derive(Debug, thiserror::Error)]
pub enum ProcessError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("game process not found within timeout")]
    Timeout,
    #[error("win32: {0}")]
    Win32(String),
}

/// Spawn `LEProc.exe -runas <profile> <game_exe> [args...]` with `cwd`.
///
/// Returns the LEProc PID, *not* the game's PID. Caller must follow up with
/// `find_game_pid` to discover the actual game process. Synchronous on
/// purpose: `Command::spawn` already returns immediately on Windows.
/// Quote a single command-line argument for the Win32 CommandLineToArgvW
/// parser used by ShellExecuteEx. Wraps in double quotes and escapes any
/// embedded `"` and trailing backslashes so paths with spaces (e.g.
/// `C:\Program Files\...`) round-trip correctly.
fn quote_arg(s: &str) -> String {
    if !s.contains([' ', '\t', '"']) && !s.is_empty() {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    let chars: Vec<char> = s.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let mut backslashes = 0;
        while i < chars.len() && chars[i] == '\\' {
            backslashes += 1;
            i += 1;
        }
        if i == chars.len() {
            // Trailing backslashes — double them so the closing quote is
            // not eaten by the parser.
            for _ in 0..backslashes * 2 {
                out.push('\\');
            }
        } else if chars[i] == '"' {
            for _ in 0..backslashes * 2 + 1 {
                out.push('\\');
            }
            out.push('"');
            i += 1;
        } else {
            for _ in 0..backslashes {
                out.push('\\');
            }
            out.push(chars[i]);
            i += 1;
        }
    }
    out.push('"');
    out
}

/// Convert &str to a NUL-terminated UTF-16 buffer suitable for PCWSTR.
fn to_wide(s: &str) -> Vec<u16> {
    std::ffi::OsStr::new(s)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

/// Spawn LEProc with `runas` so Windows prompts UAC. LEProc ships with a
/// requireAdministrator manifest on most installs, so a plain
/// `Command::spawn` returns ERROR_ELEVATION_REQUIRED (os error 740). Using
/// ShellExecuteEx with verb "runas" lets the OS handle elevation; the user
/// sees a single UAC consent dialog per launch (or zero if their LE is
/// pinned to "always run elevated" via compat).
///
/// Invocation form is `LEProc.exe <game.exe> [args]` — LEProc with no flag
/// runs the target with its own profile (if it has one) or the default
/// ja-JP profile (if it doesn't). This sidesteps the `-runas <guid>`
/// dance which requires a pre-configured LEConfig.xml profile on the
/// system, and matches what the bundled portable LE supports out of the
/// box. The `profile` parameter is reserved for a future explicit-profile
/// path and is unused right now.
///
/// Returns the LEProc PID just like the old `Command::spawn` path so
/// `find_game_pid` can carry on unchanged.
pub fn spawn_le(
    le_path: &Path,
    profile: &str,
    game_exe: &Path,
    args: &[&str],
    cwd: &Path,
) -> std::io::Result<u32> {
    let _ = profile; // kept for API compatibility; unused with default-profile launch
    eprintln!(
        "[launch] LE spawn attempt (runas, default profile): le_path={:?} game_exe={:?} args={:?} cwd={:?}",
        le_path, game_exe, args, cwd
    );

    // LEProc.exe <game.exe> [args] — first positional arg drives the
    // default-profile path inside LEProc's main entry. No `-run`/`-runas`
    // prefix needed.
    let game_exe_str = game_exe.to_string_lossy();
    let mut params = quote_arg(&game_exe_str);
    for a in args {
        params.push(' ');
        params.push_str(&quote_arg(a));
    }

    let verb_w = to_wide("runas");
    let file_w = to_wide(&le_path.to_string_lossy());
    let params_w = to_wide(&params);
    let cwd_w = to_wide(&cwd.to_string_lossy());

    let mut info = SHELLEXECUTEINFOW {
        cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_NOCLOSEPROCESS,
        hwnd: HWND(std::ptr::null_mut()),
        lpVerb: PCWSTR(verb_w.as_ptr()),
        lpFile: PCWSTR(file_w.as_ptr()),
        lpParameters: PCWSTR(params_w.as_ptr()),
        lpDirectory: PCWSTR(cwd_w.as_ptr()),
        nShow: SW_SHOWNORMAL.0,
        ..Default::default()
    };

    let exec_result = unsafe { ShellExecuteExW(&mut info) };
    if let Err(e) = exec_result {
        eprintln!("[launch] ShellExecuteExW(runas) failed: {}", e);
        return Err(std::io::Error::new(std::io::ErrorKind::Other, e.to_string()));
    }

    if info.hProcess.is_invalid() {
        eprintln!("[launch] ShellExecuteExW returned no process handle (UAC declined?)");
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "UAC consent denied or no process handle returned",
        ));
    }

    let pid = unsafe { GetProcessId(info.hProcess) };
    // We don't need to keep the handle around — find_game_pid will
    // re-open via OpenProcess once the actual game PID is discovered.
    let _ = unsafe { CloseHandle(info.hProcess) };

    if pid == 0 {
        eprintln!("[launch] GetProcessId returned 0 — process info unavailable");
        return Err(std::io::Error::new(
            std::io::ErrorKind::Other,
            "GetProcessId returned 0",
        ));
    }
    eprintln!("[launch] LEProc spawned successfully via runas: pid={}", pid);
    Ok(pid)
}

/// Spawn the game executable directly (no LE wrapper). Returns the game's
/// own PID — caller can pass it straight to `wait_for_exit`, no
/// `find_game_pid` polling needed since there is no launcher fork in the way.
pub fn spawn_direct(
    game_exe: &Path,
    args: &[&str],
    cwd: &Path,
) -> std::io::Result<u32> {
    eprintln!(
        "[launch] direct spawn attempt: game_exe={:?} args={:?} cwd={:?}",
        game_exe, args, cwd
    );
    let mut cmd = std::process::Command::new(game_exe);
    for a in args {
        cmd.arg(a);
    }
    cmd.current_dir(cwd);
    match cmd.spawn() {
        Ok(child) => {
            let pid = child.id();
            eprintln!("[launch] direct spawned successfully: pid={}", pid);
            Ok(pid)
        }
        Err(e) => {
            eprintln!("[launch] direct spawn failed: {} (kind={:?})", e, e.kind());
            Err(e)
        }
    }
}

/// Poll the process table until a process with basename matching
/// `game_exe.file_name()` appears (case-insensitive). Returns its PID.
///
/// Falls back to a `starts_with(stem)` match so renamed/aliased binaries
/// (e.g. `game.exe` vs `game-1.0.exe`) still resolve. Returns
/// `ProcessError::Timeout` if no match within ~30s.
pub async fn find_game_pid(game_exe: &Path) -> Result<u32, ProcessError> {
    let target_name = game_exe
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    if target_name.is_empty() {
        return Err(ProcessError::Win32("empty game_exe basename".into()));
    }
    let target_stem = target_name.trim_end_matches(".exe").to_string();
    eprintln!(
        "[launch] find_game_pid target_name={:?} target_stem={:?}",
        target_name, target_stem
    );

    // Brief grace window so LE has a chance to fork before our first scan.
    tokio::time::sleep(Duration::from_millis(LE_GRACE_MS)).await;

    let mut sys = System::new();
    for attempt in 0..MAX_POLL_ATTEMPTS {
        sys.refresh_processes(ProcessesToUpdate::All, true);
        for (pid, proc) in sys.processes() {
            let name = proc.name().to_string_lossy().to_lowercase();
            // Exact match first; fall back to stem-prefix to tolerate
            // versioned/aliased binaries.
            if name == target_name || (!target_stem.is_empty() && name.starts_with(&target_stem)) {
                eprintln!(
                    "[launch] find_game_pid hit at attempt {}: pid={} name={:?}",
                    attempt + 1,
                    pid.as_u32(),
                    name
                );
                return Ok(pid.as_u32());
            }
        }
        // Every ~5s of polling, dump the process table snapshot so the user
        // can see what processes ARE running and diagnose why no match.
        if attempt > 0 && attempt % 10 == 0 {
            let mut names: Vec<String> = sys
                .processes()
                .values()
                .map(|p| p.name().to_string_lossy().to_lowercase())
                .collect();
            names.sort();
            names.dedup();
            eprintln!(
                "[launch] find_game_pid still searching for {:?} after {}s — sample running .exe names: {:?}",
                target_name,
                (attempt as u64 * POLL_INTERVAL_MS) / 1000,
                names
                    .iter()
                    .filter(|n| n.ends_with(".exe"))
                    .take(20)
                    .collect::<Vec<_>>()
            );
        }
        tokio::time::sleep(Duration::from_millis(POLL_INTERVAL_MS)).await;
    }
    eprintln!(
        "[launch] find_game_pid timed out after 30s for target {:?}",
        target_name
    );
    Err(ProcessError::Timeout)
}

/// Block until process `pid` exits, then read its exit code.
///
/// `WaitForSingleObject(handle, INFINITE)` parks the thread, so we run it
/// inside `spawn_blocking` to keep the tokio runtime responsive.
/// `GetExitCodeProcess` is best-effort: if it fails we still return Ok with
/// `-1` because the *exit itself* is what the session lifecycle cares about.
pub async fn wait_for_exit(pid: u32) -> Result<i32, ProcessError> {
    tokio::task::spawn_blocking(move || -> Result<i32, ProcessError> {
        unsafe {
            let handle: HANDLE = OpenProcess(
                PROCESS_SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION,
                false,
                pid,
            )
            .map_err(|e| ProcessError::Win32(format!("OpenProcess: {}", e)))?;
            if handle.is_invalid() {
                return Err(ProcessError::Win32("invalid handle".into()));
            }
            // INFINITE: we already established the process is alive when
            // find_game_pid returned its PID; if it dies between then and
            // now, WaitForSingleObject returns immediately with WAIT_OBJECT_0.
            WaitForSingleObject(handle, INFINITE);
            let mut exit_code: u32 = 0;
            // Best-effort: we already proved the process exited; if reading
            // its exit code fails we still want to return Ok so the session
            // lifecycle can finalize.
            let exit = match GetExitCodeProcess(handle, &mut exit_code as *mut u32) {
                Ok(_) => exit_code as i32,
                Err(_) => -1,
            };
            // Releasing the handle cannot meaningfully fail here; ignore.
            let _ = CloseHandle(handle);
            Ok(exit)
        }
    })
    .await
    .map_err(|e| ProcessError::Win32(format!("join: {}", e)))?
}

/// Force-terminate the process `pid` via `sysinfo::Process::kill` (which
/// wraps `TerminateProcess` on Windows). Used by the "强制结束" UI button
/// (wired in 03d). Returns Timeout if the PID is no longer in the table.
pub fn kill_pid(pid: u32) -> Result<(), ProcessError> {
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    if let Some(proc) = sys.process(Pid::from_u32(pid)) {
        if proc.kill() {
            Ok(())
        } else {
            Err(ProcessError::Win32("kill returned false".into()))
        }
    } else {
        // Reuse Timeout for "process gone" — it semantically means
        // "we couldn't find the PID"; the caller treats both as terminal.
        Err(ProcessError::Timeout)
    }
}
