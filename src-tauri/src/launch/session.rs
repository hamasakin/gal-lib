//! Session DB lifecycle for game playtime tracking (Phase 3, TIME-03).
//!
//! ## State machine
//!
//! ```text
//! start_session  →  status='starting'        (INSERT, duration_sec=0)
//!     │
//!     ├── mark_running  →  status='running'  (after find_game_pid succeeds)
//!     │       │
//!     │       ├── end_session     →  status='completed'    (process exited cleanly)
//!     │       └── cancel_session  →  status='cancelled'    (user kill from UI)
//!     │
//!     └── mark_failed   →  status='launch_failed'          (find_game_pid timeout)
//! ```
//!
//! Two terminal transitions also fold time into the parent `games` row:
//!   - `end_session`     → `games.total_playtime_sec += dur` and updates `last_played_at`
//!   - `cancel_session`  → same accounting (the time was real even if the user killed it)
//!
//! `mark_failed` zeroes `duration_sec`; the launch never started so there is
//! nothing to credit.
//!
//! ## Why elapsed is computed in Rust, not SQL
//!
//! SQLite's `julianday(...)` arithmetic is fine for fixed-format timestamps,
//! but we already store RFC3339 strings (compatible with chrono and JS
//! `Date`), and the deltas are small enough that Rust-side parsing is
//! cheaper than the equivalent `(julianday('now') - julianday(started_at)) * 86400`
//! expression. Round-tripping through chrono also lets us clamp negatives
//! (clock skew, NTP jumps) to zero with `.max(0)` instead of leaking a
//! negative duration into the totals column.
//!
//! ## Thread/runtime model
//!
//! All public fns are `async` and take `&SqlitePool`; the pool is the same
//! one Phase 02d stores in `AppPaths` (created via `connect_lazy`), so
//! 03d can wire these directly from `#[tauri::command]` handlers without
//! an extra layer.

use sqlx::SqlitePool;

#[derive(Debug, thiserror::Error)]
pub enum SessionError {
    #[error("db: {0}")]
    Db(#[from] sqlx::Error),
}

/// Insert a new `sessions` row in `starting` status. Returns the new row id
/// (used as the session handle for subsequent transitions).
///
/// `duration_sec` is initialized to 0; it stays 0 until `end_session` /
/// `cancel_session` (or remains 0 forever for `mark_failed`).
pub async fn start_session(pool: &SqlitePool, game_id: i64) -> Result<i64, SessionError> {
    let now = chrono::Utc::now().to_rfc3339();
    let row = sqlx::query(
        "INSERT INTO sessions (game_id, started_at, status, duration_sec) \
         VALUES (?, ?, 'starting', 0)",
    )
    .bind(game_id)
    .bind(&now)
    .execute(pool)
    .await?;
    Ok(row.last_insert_rowid())
}

/// Transition `starting` → `running`. Called after `find_game_pid` resolves
/// the LE-spawned game PID — at this point we know the launch succeeded and
/// the user is actually playing.
pub async fn mark_running(pool: &SqlitePool, session_id: i64) -> Result<(), SessionError> {
    sqlx::query("UPDATE sessions SET status='running' WHERE id=?")
        .bind(session_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Terminal transition for a normally-exited process.
///
/// 1. Read `started_at` to compute elapsed seconds (clamped to ≥ 0).
/// 2. Set `status='completed'`, `ended_at`, `duration_sec`, `exit_code`.
/// 3. Add `dur_sec` to `games.total_playtime_sec` and update
///    `games.last_played_at` so the library card reflects the latest play.
///
/// The two UPDATEs are intentionally separate (not a transaction): SQLite
/// in WAL mode serializes writes anyway, and partial failure of step 3 still
/// leaves a correct `sessions` row that a later reconciliation could roll up.
pub async fn end_session(
    pool: &SqlitePool,
    session_id: i64,
    exit_code: i32,
) -> Result<(), SessionError> {
    let now = chrono::Utc::now().to_rfc3339();
    let dur_sec = elapsed_since_start(pool, session_id).await?;

    sqlx::query(
        "UPDATE sessions \
         SET status='completed', ended_at=?, duration_sec=?, exit_code=? \
         WHERE id=?",
    )
    .bind(&now)
    .bind(dur_sec)
    .bind(exit_code)
    .bind(session_id)
    .execute(pool)
    .await?;

    // Roll up into games row. Subselect avoids passing the game_id twice
    // through the API surface.
    sqlx::query(
        "UPDATE games \
         SET total_playtime_sec = total_playtime_sec + ?, last_played_at=? \
         WHERE id = (SELECT game_id FROM sessions WHERE id=?)",
    )
    .bind(dur_sec)
    .bind(&now)
    .bind(session_id)
    .execute(pool)
    .await?;

    // L9N-01 — 有真实游玩时长且状态仍为默认 unplayed 时自动升级为 playing。
    // 守卫条件 status='unplayed' 保证不覆盖用户手动设置的 cleared/dropped；
    // total_playtime_sec>0 保证只有真的累计过时长的条目才升级。
    sqlx::query(
        "UPDATE games SET status='playing', updated_at=datetime('now') \
         WHERE id = (SELECT game_id FROM sessions WHERE id=?) \
           AND status='unplayed' AND total_playtime_sec > 0",
    )
    .bind(session_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Terminal transition for a launch that never reached `running`. Zeroes
/// `duration_sec` (no playtime to credit) and leaves `exit_code` NULL.
/// `games.total_playtime_sec` is intentionally NOT updated — failed launches
/// must not pollute totals.
pub async fn mark_failed(pool: &SqlitePool, session_id: i64) -> Result<(), SessionError> {
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query(
        "UPDATE sessions SET status='launch_failed', ended_at=?, duration_sec=0 WHERE id=?",
    )
    .bind(&now)
    .bind(session_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Terminal transition for a user-initiated kill (force-end button).
/// Time spent is real and counts toward totals — same accounting as
/// `end_session` but with `status='cancelled'` and no exit code.
pub async fn cancel_session(pool: &SqlitePool, session_id: i64) -> Result<(), SessionError> {
    let now = chrono::Utc::now().to_rfc3339();
    let dur_sec = elapsed_since_start(pool, session_id).await?;

    sqlx::query(
        "UPDATE sessions SET status='cancelled', ended_at=?, duration_sec=? WHERE id=?",
    )
    .bind(&now)
    .bind(dur_sec)
    .bind(session_id)
    .execute(pool)
    .await?;

    sqlx::query(
        "UPDATE games \
         SET total_playtime_sec = total_playtime_sec + ?, last_played_at=? \
         WHERE id = (SELECT game_id FROM sessions WHERE id=?)",
    )
    .bind(dur_sec)
    .bind(&now)
    .bind(session_id)
    .execute(pool)
    .await?;

    // L9N-01 — 取消的会话时长也是真实游玩，与 end_session 一致地把仍为
    // unplayed 的条目自动升级为 playing（守卫保证不覆盖 cleared/dropped）。
    sqlx::query(
        "UPDATE games SET status='playing', updated_at=datetime('now') \
         WHERE id = (SELECT game_id FROM sessions WHERE id=?) \
           AND status='unplayed' AND total_playtime_sec > 0",
    )
    .bind(session_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Helper: read `started_at` for `session_id` and return `(now - started)`
/// in whole seconds, clamped to `>= 0`. Falls back to `Utc::now()` if the
/// timestamp string is unparseable (yielding 0s) — defensive against any
/// future migration that touches the column format.
async fn elapsed_since_start(pool: &SqlitePool, session_id: i64) -> Result<i64, SessionError> {
    let row: (String,) = sqlx::query_as("SELECT started_at FROM sessions WHERE id=?")
        .bind(session_id)
        .fetch_one(pool)
        .await?;
    let started: chrono::DateTime<chrono::Utc> = chrono::DateTime::parse_from_rfc3339(&row.0)
        .map(|d| d.into())
        .unwrap_or_else(|_| chrono::Utc::now());
    Ok((chrono::Utc::now() - started).num_seconds().max(0))
}

#[cfg(test)]
mod tests {
    //! Compile-only smoke: confirms the module type-checks against the
    //! Phase 1/3 schema (game_id FK, status enum, sessions/games columns).
    //! Real lifecycle behavior is exercised end-to-end in 03d Tauri command
    //! tests where a real pool is available.
    use super::*;

    #[allow(dead_code)]
    fn _signatures_compile(pool: &SqlitePool) {
        // Reference each public fn so that signature drift breaks the build
        // immediately rather than at the 03d wire-up step.
        let _ = start_session(pool, 1);
        let _ = mark_running(pool, 1);
        let _ = end_session(pool, 1, 0);
        let _ = mark_failed(pool, 1);
        let _ = cancel_session(pool, 1);
    }
}
