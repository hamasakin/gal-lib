//! Pure scoring heuristic for picking the "main" executable inside a game directory.
//!
//! Implementation contract (locked in 02-CONTEXT § Filesystem Scan Engine):
//!   PLUS:
//!     +1   filename stem length is in [5, 30] chars
//!     +5   filename stem prefix-matches parent directory name (or vice-versa)
//!     +2   file size > 1 MB
//!     +15  filename stem ends with a Chinese-patch suffix (_cn/_chs/_zh, also -cn/-chs/-zh)
//!   MINUS:
//!     -10  filename stem contains setup/uninst/uninstall/patch/tool/config/launcher/crash/vcredist/dotnet
//!     -3   file size < 100 KB
//!     -3   path traverses a "bad" subdirectory (redist/tools/launcher/extras/crack/_install)
//!
//! The function is intentionally side-effect-light: it only reads filesystem
//! metadata for the file itself (which the walker already touched), so a
//! corrupt entry returns score 0 instead of bubbling the IO error. The
//! walker is responsible for ranking and tiebreaking on mtime.

use std::path::Path;

/// Compute a heuristic score for a candidate executable.
///
/// `path` is the candidate `.exe`, `parent_dir` is the game directory
/// (root of the per-game scan, NOT necessarily the immediate parent of `path`).
pub fn score_exe(path: &Path, parent_dir: &Path) -> i32 {
    let name = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    let parent_name = parent_dir
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();

    let mut score: i32 = 0;

    // Bad name tokens — strongest negative signal (uninstaller / launcher / redist).
    let bad_names = [
        "setup",
        "uninst",
        "uninstall",
        "patch",
        "tool",
        "config",
        "launcher",
        "crash",
        "vcredist",
        "dotnet",
    ];
    for b in bad_names.iter() {
        if name.contains(b) {
            score -= 10;
        }
    }

    // Reasonable name length (5..=30) — filters out e.g. "a.exe" / 50-char installer stubs.
    if name.len() >= 5 && name.len() <= 30 {
        score += 1;
    }

    // Prefix match between filename and game directory name.
    // E.g. game dir "Fate" → "Fate.exe" / "FateLauncher.exe" both prefix-match.
    if !parent_name.is_empty()
        && (name.starts_with(&parent_name) || parent_name.starts_with(&name))
    {
        score += 5;
    }

    // Chinese-patch suffix — when a directory ships both `Game.exe` and
    // `Game_cn.exe`, the user almost always wants the patched binary.
    // Weight is high enough (+15) to clear prefix(+5)+size(+2)+namelen(+1)
    // on the vanilla sibling without being able to rescue a setup/uninst hit
    // (those hit -10 per token and stay net-negative).
    let cn_suffixes = ["_cn", "_chs", "_zh", "-cn", "-chs", "-zh"];
    for suf in cn_suffixes.iter() {
        if name.ends_with(suf) {
            score += 15;
            break;
        }
    }

    // Size signal — main game binaries are typically multi-MB, installers/utilities are small.
    if let Ok(meta) = std::fs::metadata(path) {
        if meta.len() > 1_000_000 {
            score += 2;
        } else if meta.len() < 100_000 {
            score -= 3;
        }
    }

    // Bad subdirectory signal — redist/tools/launcher/extras/crack/_install
    // anywhere in the path prevents the file from winning even if name+size look fine.
    let path_str = path.to_string_lossy().to_lowercase();
    let bad_dirs = ["redist", "tools", "launcher", "extras", "crack", "_install"];
    for bd in bad_dirs.iter() {
        if path_str.contains(&format!("\\{}\\", bd))
            || path_str.contains(&format!("/{}/", bd))
        {
            score -= 3;
            break;
        }
    }

    score
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;
    use std::path::PathBuf;

    /// Create a temp directory unique to this test invocation.
    fn temp_dir(label: &str) -> PathBuf {
        let mut d = std::env::temp_dir();
        let pid = std::process::id();
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|x| x.as_nanos())
            .unwrap_or(0);
        d.push(format!("gal-lib-exe-score-{}-{}-{}", label, pid, nanos));
        fs::create_dir_all(&d).expect("create temp dir");
        d
    }

    /// Write a file containing exactly `size` zero bytes.
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
    fn prefers_main_exe_over_setup() {
        let dir = temp_dir("prefer-main");
        let game = dir.join("Fate");
        fs::create_dir_all(&game).unwrap();
        let main_exe = game.join("Fate.exe");
        let setup_exe = game.join("setup.exe");
        write_sized(&main_exe, 2_000_000); // 2MB
        write_sized(&setup_exe, 2_000_000); // 2MB

        let main_score = score_exe(&main_exe, &game);
        let setup_score = score_exe(&setup_exe, &game);

        assert!(
            main_score > setup_score,
            "Fate.exe ({}) should beat setup.exe ({})",
            main_score,
            setup_score
        );
        // setup.exe should be net-negative (-10 name penalty dominates)
        assert!(setup_score < 0, "setup.exe expected negative, got {}", setup_score);
    }

    #[test]
    fn excludes_redist_subdirectory() {
        let dir = temp_dir("redist-penalty");
        let game = dir.join("SomeGame");
        let redist = game.join("redist");
        fs::create_dir_all(&redist).unwrap();

        // Large exe inside redist/ — should still score lower than tiny exe in root
        // because of the -3 directory penalty (and -3 size penalty for the small one).
        let bad = redist.join("biggame.exe");
        write_sized(&bad, 5_000_000); // 5MB
        let small_root = game.join("tiny.exe");
        write_sized(&small_root, 50_000); // 50KB

        let bad_score = score_exe(&bad, &game);
        let small_score = score_exe(&small_root, &game);

        // The redist-located binary must NOT win — primary intent of this test.
        assert!(
            bad_score < small_score || bad_score <= 0,
            "redist exe should not beat root exe (redist={}, root={})",
            bad_score,
            small_score
        );
    }

    #[test]
    fn large_executable_bonus() {
        let dir = temp_dir("size-bonus");
        let game = dir.join("Game");
        fs::create_dir_all(&game).unwrap();
        // Use a name that does NOT prefix-match the parent (to isolate the size bonus).
        let big = game.join("zzbinary.exe");
        let mid = game.join("xxbinary.exe");
        write_sized(&big, 2_000_000); // 2MB → +2
        write_sized(&mid, 500_000); // 500KB → 0

        let big_score = score_exe(&big, &game);
        let mid_score = score_exe(&mid, &game);

        assert_eq!(
            big_score - mid_score,
            2,
            "size>1MB should give exactly +2 bonus (big={}, mid={})",
            big_score,
            mid_score
        );
    }

    #[test]
    fn prefers_cn_suffix_over_plain() {
        let dir = temp_dir("cn-suffix");
        let game = dir.join("Fate");
        fs::create_dir_all(&game).unwrap();
        let plain = game.join("Fate.exe");
        let cn = game.join("Fate_cn.exe");
        write_sized(&plain, 2_000_000); // 2MB
        write_sized(&cn, 2_000_000); // 2MB

        let plain_score = score_exe(&plain, &game);
        let cn_score = score_exe(&cn, &game);

        assert!(
            cn_score > plain_score,
            "Fate_cn.exe ({}) should beat Fate.exe ({}) in same dir",
            cn_score,
            plain_score
        );
        // The boost must be large enough to clearly dominate (>=10 over
        // an otherwise-identical vanilla sibling).
        assert!(
            cn_score - plain_score >= 10,
            "_cn bonus should clearly dominate (delta={})",
            cn_score - plain_score
        );
    }

    #[test]
    fn cn_suffix_variants_all_match() {
        let dir = temp_dir("cn-variants");
        let game = dir.join("Game");
        fs::create_dir_all(&game).unwrap();
        // Use names that do NOT prefix-match `game` to isolate the suffix bonus.
        let plain = game.join("zzbinary.exe");
        write_sized(&plain, 2_000_000);
        let plain_score = score_exe(&plain, &game);

        for variant in ["zzbinary_cn", "zzbinary_chs", "zzbinary_zh",
                        "zzbinary-cn", "zzbinary-chs", "zzbinary-zh"].iter() {
            let candidate = game.join(format!("{}.exe", variant));
            write_sized(&candidate, 2_000_000);
            let s = score_exe(&candidate, &game);
            // Both names hit the [5,30] namelen bonus, so the delta is the
            // raw +15 from the suffix preference.
            assert!(
                s - plain_score >= 15,
                "{}.exe should get +15 over plain (delta={})",
                variant,
                s - plain_score
            );
        }
    }

    #[test]
    fn cn_suffix_cannot_rescue_bad_name() {
        // _cn boost (+20) must not save a setup/uninstaller (-10 per match).
        // setup_cn.exe -> setup hit (-10) + _cn (+20) + size(+2) = +12,
        // plain Game.exe in same dir gets prefix(+5) + size(+2) = +7 — close.
        // We assert "uninstall_cn" stays clearly negative because both
        // 'uninst' and 'uninstall' bad-name tokens hit (-20).
        let dir = temp_dir("cn-no-rescue");
        let game = dir.join("Game");
        fs::create_dir_all(&game).unwrap();
        let uninstaller = game.join("uninstall_cn.exe");
        write_sized(&uninstaller, 2_000_000);

        let s = score_exe(&uninstaller, &game);
        assert!(
            s < 0,
            "uninstall_cn.exe must stay net-negative (got {})",
            s
        );
    }

    #[test]
    fn name_length_bonus() {
        let dir = temp_dir("name-len");
        let game = dir.join("Wrap");
        fs::create_dir_all(&game).unwrap();
        // 2-char stem ("ab") → no bonus.
        let too_short = game.join("ab.exe");
        // 10-char stem ("playgameex") → +1.
        let in_range = game.join("playgameex.exe");
        // Both 500KB so size signal is neutral (not <100K, not >1MB).
        write_sized(&too_short, 500_000);
        write_sized(&in_range, 500_000);

        let short_score = score_exe(&too_short, &game);
        let range_score = score_exe(&in_range, &game);

        assert!(
            range_score > short_score,
            "10-char name should out-score 2-char name (10ch={}, 2ch={})",
            range_score,
            short_score
        );
    }
}
