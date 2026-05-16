//! Filesystem walker — game-directory enumeration + per-game executable picker.
//!
//! Two distinct passes:
//!
//! 1. `collect_game_dirs(roots)` — for each `(root, depth)` pair, return all
//!    directories at exactly `depth` levels below `root`. This is the
//!    locked SCAN-04 game-boundary rule ("第 N 层子目录 = 1 款游戏").
//!    Cancellation is checked at every iteration.
//!
//! 2. `pick_best_exe(game_dir)` — full-recursive walk inside one game dir,
//!    score every `.exe`, return the highest-scoring one (mtime as tiebreak).
//!    Returns `None` if no `.exe` scored above zero (locked SCAN-05 rule:
//!    全部为负分时记录"无可识别 exe"; here zero or negative both count as
//!    "no clear winner" → caller surfaces "no exe" UI state).
//!
//! Walkdir errors on individual entries (permission denied / broken symlink
//! / vanished file) are ignored at the iterator level via `filter_map(Result::ok)`,
//! so a single inaccessible subdirectory does not abort the whole scan.

use crate::scan::exe_score::score_exe;
use crate::scan::types::ScanError;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::SystemTime;
use walkdir::WalkDir;

/// Enumerate game directories across all configured scan roots.
///
/// For each `(root, depth)`, yield every directory whose distance from
/// `root` is exactly `depth` (depth=1 → immediate children of root).
/// Non-existent roots are silently skipped (they may have been unplugged
/// removable drives). The cancel flag is polled per-entry; when tripped,
/// returns `Err(ScanError::Cancelled)`.
pub fn collect_game_dirs(
    roots: &[(PathBuf, u8)],
    cancel: &Arc<AtomicBool>,
) -> Result<Vec<PathBuf>, ScanError> {
    let mut out: Vec<PathBuf> = Vec::new();

    for (root, depth) in roots {
        if cancel.load(Ordering::Relaxed) {
            return Err(ScanError::Cancelled);
        }
        if !root.is_dir() {
            // Missing root (e.g. ejected drive) — skip silently rather than fail the whole scan.
            continue;
        }
        let depth_usize = *depth as usize;
        // min_depth == max_depth == depth → visit ONLY directories at exactly that level.
        let walker = WalkDir::new(root)
            .min_depth(depth_usize)
            .max_depth(depth_usize)
            .follow_links(false);
        for entry in walker.into_iter().filter_map(|r| r.ok()) {
            if cancel.load(Ordering::Relaxed) {
                return Err(ScanError::Cancelled);
            }
            if entry.file_type().is_dir() {
                out.push(entry.path().to_path_buf());
            }
        }
    }

    Ok(out)
}

/// Find the best `.exe` inside one game directory via layered matching.
///
/// Walks the whole directory tree, then evaluates candidates **layer by
/// layer, shallowest first**: every positively-scoring `.exe` is bucketed
/// by its depth below `game_dir` (root files = depth 1). The first non-empty
/// layer wins — a shallow positive exe always beats a deeper higher-scoring
/// one (the shallow main is almost always the real game; deeper subdirs are
/// usually redist/tools/汉化补丁). When the shallow layer has no positive
/// candidate, matching descends to the next layer, repeating until a layer
/// hits or the tree is exhausted. Within a layer, `score_exe` ranks and
/// mtime tiebreaks. Returns `None` if no `.exe` scored > 0.
pub fn pick_best_exe(game_dir: &Path) -> Option<PathBuf> {
    // depth → best (score, mtime, path) seen at that depth so far.
    let mut by_depth: BTreeMap<usize, (i32, SystemTime, PathBuf)> = BTreeMap::new();

    for entry in WalkDir::new(game_dir)
        .follow_links(false)
        .into_iter()
        .filter_map(|r| r.ok())
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        let is_exe = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("exe"))
            .unwrap_or(false);
        if !is_exe {
            continue;
        }
        // parent_dir stays the game-dir root: prefix-match / bad-dir penalty
        // semantics in score_exe are defined against the per-game scan root.
        let score = score_exe(path, game_dir);
        if score <= 0 {
            // Locked rule: only positively-scoring candidates are eligible.
            continue;
        }
        let mtime = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .unwrap_or(SystemTime::UNIX_EPOCH);

        // Layer key: depth relative to game_dir (root files are depth 1).
        let depth = entry.depth();
        let take = match by_depth.get(&depth) {
            None => true,
            Some((bs, bt, _)) => score > *bs || (score == *bs && mtime > *bt),
        };
        if take {
            by_depth.insert(depth, (score, mtime, path.to_path_buf()));
        }
    }

    // BTreeMap iterates depth ascending → first non-empty layer is shallowest.
    by_depth.into_values().next().map(|(_, _, p)| p)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;
    use std::path::PathBuf;
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;

    fn temp_dir(label: &str) -> PathBuf {
        let mut d = std::env::temp_dir();
        let pid = std::process::id();
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|x| x.as_nanos())
            .unwrap_or(0);
        d.push(format!("gal-lib-walker-{}-{}-{}", label, pid, nanos));
        fs::create_dir_all(&d).expect("create temp dir");
        d
    }

    fn write_sized(path: &Path, size: usize) {
        let mut f = fs::File::create(path).expect("create file");
        let chunk = vec![0u8; 4096];
        let mut remaining = size;
        while remaining > 0 {
            let n = remaining.min(chunk.len());
            f.write_all(&chunk[..n]).expect("write");
            remaining -= n;
        }
    }

    #[test]
    fn collect_at_depth_one() {
        // Layout:
        //   root/
        //     Game1/
        //     Game2/
        //     Game3/sub/   (depth-2; should NOT show up at depth=1)
        let root = temp_dir("depth-1");
        for name in &["Game1", "Game2"] {
            fs::create_dir_all(root.join(name)).unwrap();
        }
        fs::create_dir_all(root.join("Game3").join("sub")).unwrap();

        let cancel = Arc::new(AtomicBool::new(false));
        let dirs = collect_game_dirs(&[(root.clone(), 1)], &cancel).expect("walk");
        // Game3/sub is at depth 2 so excluded. Game3 itself IS at depth 1.
        let names: Vec<String> = dirs
            .iter()
            .filter_map(|p| p.file_name().and_then(|s| s.to_str()).map(String::from))
            .collect();
        assert_eq!(dirs.len(), 3, "expected 3 dirs at depth 1, got {:?}", names);
        assert!(names.contains(&"Game1".to_string()));
        assert!(names.contains(&"Game2".to_string()));
        assert!(names.contains(&"Game3".to_string()));
    }

    #[test]
    fn collect_at_depth_two() {
        // Layout:
        //   root/
        //     Pub1/Title1/   (depth=2)
        //     Pub1/Title2/   (depth=2)
        //     Pub2/Title3/   (depth=2)
        //     loose/         (depth=1; should NOT show)
        let root = temp_dir("depth-2");
        fs::create_dir_all(root.join("Pub1").join("Title1")).unwrap();
        fs::create_dir_all(root.join("Pub1").join("Title2")).unwrap();
        fs::create_dir_all(root.join("Pub2").join("Title3")).unwrap();
        fs::create_dir_all(root.join("loose")).unwrap();

        let cancel = Arc::new(AtomicBool::new(false));
        let dirs = collect_game_dirs(&[(root, 2)], &cancel).expect("walk");
        let names: Vec<String> = dirs
            .iter()
            .filter_map(|p| p.file_name().and_then(|s| s.to_str()).map(String::from))
            .collect();
        assert_eq!(dirs.len(), 3, "expected 3 dirs at depth 2, got {:?}", names);
        assert!(names.contains(&"Title1".to_string()));
        assert!(names.contains(&"Title2".to_string()));
        assert!(names.contains(&"Title3".to_string()));
        // loose is at depth 1 — must NOT be included
        assert!(!names.contains(&"loose".to_string()));
    }

    #[test]
    fn cancel_flag_aborts_walk() {
        let root = temp_dir("cancel");
        for i in 0..5 {
            fs::create_dir_all(root.join(format!("g{}", i))).unwrap();
        }
        let cancel = Arc::new(AtomicBool::new(true)); // pre-set
        let result = collect_game_dirs(&[(root, 1)], &cancel);
        assert!(matches!(result, Err(ScanError::Cancelled)));
    }

    #[test]
    fn pick_best_exe_finds_main_over_setup() {
        let game = temp_dir("pick-main").join("Fate");
        fs::create_dir_all(&game).unwrap();
        write_sized(&game.join("Fate.exe"), 2_000_000); // strong winner: prefix + size
        write_sized(&game.join("setup.exe"), 2_000_000); // -10 name penalty

        let pick = pick_best_exe(&game).expect("should find an exe");
        assert_eq!(
            pick.file_name().unwrap().to_string_lossy(),
            "Fate.exe",
            "pick={}",
            pick.display()
        );
    }

    #[test]
    fn pick_best_exe_returns_none_when_all_negative() {
        let game = temp_dir("pick-none").join("X");
        fs::create_dir_all(&game).unwrap();
        // Only an installer-stub-named binary; -10 name penalty dominates → score < 0.
        write_sized(&game.join("uninstall.exe"), 500_000);
        let pick = pick_best_exe(&game);
        assert!(pick.is_none(), "expected no winner, got {:?}", pick);
    }

    #[test]
    fn pick_best_exe_prefers_shallow_over_deeper_higher_score() {
        // Game root has a positive-but-not-highest exe; a deeper neutral-named
        // subdir holds an exe that scores HIGHER. Layered matching must still
        // return the shallow (game-root) exe — the shallow main always wins
        // over a deeper higher-scoring candidate.
        let game = temp_dir("pick-shallow").join("Fate");
        fs::create_dir_all(&game).unwrap();
        // Root: Fate.exe → prefix(+5) + namelen(+1) + size(+2) = +8.
        write_sized(&game.join("Fate.exe"), 2_000_000);
        // Deep neutral subdir (no bad-dir penalty word): data/bin/.
        let deep = game.join("data").join("bin");
        fs::create_dir_all(&deep).unwrap();
        // Fate_cn.exe → prefix(+5) + namelen(+1) + size(+2) + _cn(+15) = +23.
        write_sized(&deep.join("Fate_cn.exe"), 2_000_000);

        let pick = pick_best_exe(&game).expect("should find an exe");
        assert_eq!(
            pick.file_name().unwrap().to_string_lossy(),
            "Fate.exe",
            "shallow game-root exe must beat the deeper higher-scoring exe; pick={}",
            pick.display()
        );
    }

    #[test]
    fn pick_best_exe_falls_through_to_deeper_when_shallow_has_no_positive() {
        // Game root holds only a negative-scoring exe (setup.exe). A deeper
        // neutral-named subdir holds a positive exe. With no positive
        // candidate at the shallow layer, layered matching descends and
        // returns the deeper positive exe.
        let game = temp_dir("pick-fallthrough").join("Fate");
        fs::create_dir_all(&game).unwrap();
        // Root: setup.exe → -10 name penalty dominates → net-negative.
        write_sized(&game.join("setup.exe"), 2_000_000);
        // Deep neutral subdir game/ — Fate.exe scores positive.
        let deep = game.join("game");
        fs::create_dir_all(&deep).unwrap();
        write_sized(&deep.join("Fate.exe"), 2_000_000);

        let pick = pick_best_exe(&game).expect("should fall through to deeper exe");
        assert_eq!(
            pick.file_name().unwrap().to_string_lossy(),
            "Fate.exe",
            "shallow layer has no positive candidate → must descend to deeper exe; pick={}",
            pick.display()
        );
    }
}
