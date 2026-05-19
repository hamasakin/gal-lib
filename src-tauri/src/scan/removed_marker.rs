//! L9N-02 — "已从库中移除"磁盘标记文件。
//!
//! `delete_game` 在游戏目录内写一个隐藏标记文件 `.gal-lib-removed`，
//! 扫描时检测到该文件即跳过该目录（不再自动加回库）。
//! `restore_removed_dir` 删除标记并把目录作为新条目重新导入。
//!
//! Windows 上额外给标记文件设 HIDDEN 属性（best-effort）—— 通过已链接的
//! `windows` crate 调 `SetFileAttributesW`；失败不影响功能（隐藏只是观感，
//! 标记文件本身的点号前缀已足以避免与游戏文件冲突）。
use std::path::Path;

/// 标记文件名 —— 点号前缀避免与游戏文件冲突，Windows 上额外设隐藏属性。
pub const MARKER_FILENAME: &str = ".gal-lib-removed";

/// 在 `dir` 内写入标记文件并（Windows）设隐藏属性。已存在则视为成功（覆写）。
pub fn write_marker(dir: &Path) -> std::io::Result<()> {
    let marker = dir.join(MARKER_FILENAME);
    // 内容写一个 RFC3339 时间戳，便于将来排查；内容本身不参与逻辑。
    std::fs::write(&marker, chrono::Utc::now().to_rfc3339())?;
    set_hidden(&marker);
    Ok(())
}

/// 删除标记文件。文件不存在视为成功（幂等）。
pub fn remove_marker(dir: &Path) -> std::io::Result<()> {
    let marker = dir.join(MARKER_FILENAME);
    match std::fs::remove_file(&marker) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
}

/// `dir` 是否带 removed 标记。用 `Path::join + exists` —— 单次 stat，
/// 扫描热路径可接受。
pub fn has_marker(dir: &Path) -> bool {
    dir.join(MARKER_FILENAME).exists()
}

#[cfg(windows)]
fn set_hidden(path: &Path) {
    // best-effort：失败不影响功能（隐藏只是观感）。
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{
        SetFileAttributesW, FILE_ATTRIBUTE_HIDDEN,
    };
    let wide: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    // SAFETY: `wide` is a NUL-terminated UTF-16 buffer that outlives the call;
    // PCWSTR borrows it for the duration of `SetFileAttributesW` only.
    unsafe {
        let _ = SetFileAttributesW(PCWSTR(wide.as_ptr()), FILE_ATTRIBUTE_HIDDEN);
    }
}

#[cfg(not(windows))]
fn set_hidden(_path: &Path) {}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(label: &str) -> std::path::PathBuf {
        let mut d = std::env::temp_dir();
        let pid = std::process::id();
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|x| x.as_nanos())
            .unwrap_or(0);
        d.push(format!("gal-lib-marker-{}-{}-{}", label, pid, nanos));
        std::fs::create_dir_all(&d).expect("create temp dir");
        d
    }

    #[test]
    fn write_then_has_then_remove() {
        let dir = temp_dir("roundtrip");
        assert!(!has_marker(&dir), "fresh dir should have no marker");

        write_marker(&dir).expect("write marker");
        assert!(has_marker(&dir), "marker should exist after write");
        assert!(dir.join(MARKER_FILENAME).exists());

        remove_marker(&dir).expect("remove marker");
        assert!(!has_marker(&dir), "marker should be gone after remove");

        // remove is idempotent — second call on a missing file is Ok.
        remove_marker(&dir).expect("remove again is idempotent");

        let _ = std::fs::remove_dir_all(&dir);
    }
}
