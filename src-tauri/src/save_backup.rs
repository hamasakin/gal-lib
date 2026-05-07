//! Phase 5 (05b) — save-file backup / restore / delete.
//!
//! Three sync entry-points:
//!   - [`create_backup`] : recursive copy `<game.save_path>` → `data/saves/<game_id>/<ts>/`
//!   - [`restore_backup`]: recursive copy `data/saves/<backup_rel>` → `<dst>` (the live save dir)
//!   - [`delete_backup_dir`]: `fs::remove_dir_all(data/saves/<backup_rel>)`
//!
//! Why sync (not async): the operations are bounded by disk throughput; for a
//! few-MB galgame save dir this is < 100ms on SSD. tokio::task::spawn_blocking
//! is the caller's concern. (Tauri commands `await` these via
//! `spawn_blocking` if they prove to block too long; the v1 commands call them
//! directly inline since the blocking time is acceptable on the runtime.)
//!
//! Path contract:
//!   - `backup_dir` strings are RELATIVE to `data_dir` and start with `saves/`,
//!     e.g. `"saves/42/1714723200"`. The DB column `save_backups.backup_dir`
//!     stores this verbatim.
//!   - `restore` and `delete` prepend `data_dir` themselves; callers pass the
//!     stored relative form.
//!
//! Error mapping:
//!   - `SourceMissing(path_str)` makes "the user moved or deleted their save
//!     directory" surface as a clear, actionable error string (Tauri commands
//!     forward it to the frontend toast).
//!   - `Walk` wraps `walkdir::Error` (e.g. permission-denied on a subdir).

use std::fs;
use std::path::Path;

use walkdir::WalkDir;

#[derive(Debug, thiserror::Error)]
pub enum SaveError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("walk: {0}")]
    Walk(#[from] walkdir::Error),
    #[error("save path not configured")]
    NotConfigured,
    #[error("source not found: {0}")]
    SourceMissing(String),
}

/// Result of a successful [`create_backup`] call. Field names match the DB
/// columns of the same name in `save_backups` so commands can `.bind` directly.
#[derive(Debug)]
pub struct BackupResult {
    pub backup_dir: String,
    pub file_count: i64,
    pub total_size_bytes: i64,
}

/// Recursively copy `src` (the game's `save_path`) to
/// `data_dir/saves/<game_id>/<unix_seconds>/`.
///
/// Returns counts so the caller can persist them in `save_backups` and toast
/// "已备份 N 文件 / S bytes". On any per-entry error the function aborts —
/// partial backup dirs are NOT auto-cleaned (intentional: the user can
/// inspect / retry; v1 keeps the failure surface simple).
pub fn create_backup(
    data_dir: &Path,
    game_id: i64,
    src: &Path,
) -> Result<BackupResult, SaveError> {
    if !src.exists() {
        return Err(SaveError::SourceMissing(src.to_string_lossy().into()));
    }

    let ts = chrono::Utc::now().timestamp();
    let rel = format!("saves/{game_id}/{ts}");
    let dst = data_dir.join(&rel);
    fs::create_dir_all(&dst)?;

    let mut count: i64 = 0;
    let mut bytes: i64 = 0;

    for entry in WalkDir::new(src) {
        let entry = entry?;
        // strip_prefix is safe here: WalkDir always yields paths under `src`,
        // and we just verified `src` exists. The `.unwrap()` would only fail
        // on filesystem races (concurrent rm of `src`) which surface upstream
        // as walkdir::Error before reaching this line.
        let rel_path = entry.path().strip_prefix(src).unwrap();
        let target = dst.join(rel_path);

        if entry.file_type().is_dir() {
            fs::create_dir_all(&target)?;
        } else {
            // For non-directory entries (regular files + symlinks),
            // ensure the parent dir exists, then copy.
            if let Some(p) = target.parent() {
                fs::create_dir_all(p)?;
            }
            fs::copy(entry.path(), &target)?;
            count += 1;
            bytes += entry.metadata()?.len() as i64;
        }
    }

    Ok(BackupResult {
        backup_dir: rel,
        file_count: count,
        total_size_bytes: bytes,
    })
}

/// Reverse of `create_backup`: copy `data_dir/<backup_rel>/...` recursively
/// into `dst` (the live save path). The destination is created if needed and
/// EXISTING FILES IN `dst` ARE OVERWRITTEN (`fs::copy` semantics) — the
/// caller is expected to have prompted the user with a confirm dialog.
pub fn restore_backup(
    data_dir: &Path,
    backup_rel: &str,
    dst: &Path,
) -> Result<(), SaveError> {
    let src = data_dir.join(backup_rel);
    if !src.exists() {
        return Err(SaveError::SourceMissing(src.to_string_lossy().into()));
    }
    fs::create_dir_all(dst)?;

    for entry in WalkDir::new(&src) {
        let entry = entry?;
        let rel_path = entry.path().strip_prefix(&src).unwrap();
        let target = dst.join(rel_path);
        if entry.file_type().is_dir() {
            fs::create_dir_all(&target)?;
        } else {
            if let Some(p) = target.parent() {
                fs::create_dir_all(p)?;
            }
            fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

/// Delete a backup directory tree (no-op if already gone). Caller is
/// responsible for the matching `DELETE FROM save_backups WHERE id = ?`.
pub fn delete_backup_dir(data_dir: &Path, backup_rel: &str) -> Result<(), SaveError> {
    let target = data_dir.join(backup_rel);
    if target.exists() {
        fs::remove_dir_all(&target)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn create_backup_round_trip_copies_files() {
        let tmp = TempDir::new().unwrap();
        let data_dir = tmp.path().join("data");
        fs::create_dir_all(&data_dir).unwrap();

        // Build a fake save dir: foo.dat (root) + sub/bar.dat (nested).
        let src = tmp.path().join("game-saves");
        fs::create_dir_all(src.join("sub")).unwrap();
        fs::write(src.join("foo.dat"), b"hello").unwrap();
        fs::write(src.join("sub").join("bar.dat"), b"world!!").unwrap();

        let res = create_backup(&data_dir, 7, &src).expect("backup ok");
        assert_eq!(res.file_count, 2, "two regular files copied");
        assert_eq!(
            res.total_size_bytes,
            (b"hello".len() + b"world!!".len()) as i64
        );
        assert!(res.backup_dir.starts_with("saves/7/"), "rel path shape");

        // Verify on disk.
        let dst = data_dir.join(&res.backup_dir);
        assert!(dst.join("foo.dat").is_file());
        assert!(dst.join("sub").join("bar.dat").is_file());
        assert_eq!(
            fs::read(dst.join("sub").join("bar.dat")).unwrap(),
            b"world!!"
        );

        // Restore into a fresh dir.
        let restore_dst = tmp.path().join("restored");
        restore_backup(&data_dir, &res.backup_dir, &restore_dst).expect("restore ok");
        assert_eq!(fs::read(restore_dst.join("foo.dat")).unwrap(), b"hello");
        assert_eq!(
            fs::read(restore_dst.join("sub").join("bar.dat")).unwrap(),
            b"world!!"
        );

        // Delete tree.
        delete_backup_dir(&data_dir, &res.backup_dir).expect("delete ok");
        assert!(!dst.exists(), "backup dir removed");
        // Idempotent — second delete is a no-op.
        delete_backup_dir(&data_dir, &res.backup_dir).expect("delete idempotent");
    }

    #[test]
    fn create_backup_missing_source_returns_source_missing() {
        let tmp = TempDir::new().unwrap();
        let data_dir = tmp.path().join("data");
        fs::create_dir_all(&data_dir).unwrap();
        let bogus = tmp.path().join("does-not-exist");
        match create_backup(&data_dir, 1, &bogus) {
            Err(SaveError::SourceMissing(_)) => {}
            other => panic!("expected SourceMissing, got {:?}", other),
        }
    }

    #[test]
    fn restore_backup_missing_source_returns_source_missing() {
        let tmp = TempDir::new().unwrap();
        let data_dir = tmp.path().join("data");
        fs::create_dir_all(&data_dir).unwrap();
        match restore_backup(&data_dir, "saves/1/0", &tmp.path().join("anywhere")) {
            Err(SaveError::SourceMissing(_)) => {}
            other => panic!("expected SourceMissing, got {:?}", other),
        }
    }
}
