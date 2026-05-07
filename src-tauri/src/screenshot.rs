//! Phase 5 (05b) — primary-monitor screenshot capture pipeline.
//!
//! Single public entry-point: [`capture_to_disk`]. Used by the launch
//! orchestrator's per-session screenshot-interval task (see
//! `launch::orchestrator`) and by the future "manual screenshot" UI wired in
//! 05e. Output paths live under `data/screenshots/<game_id>/<unix_ts>.png` and
//! are returned **relative to `data_dir`** so the value can be inserted as-is
//! into the `screenshots.path` column (the frontend prepends `data_dir` from
//! `get_data_dir` when building `<img src>`).
//!
//! Why pure-sync (no async): the `screenshots = "0.8"` crate is blocking
//! (DXGI/GDI calls under the hood), and the work is short-lived (≤ 100ms per
//! capture). Wrapping it in `tokio::task::spawn_blocking` is the caller's
//! concern — orchestrator already runs the interval loop on a tokio task, so
//! a sync function is the simplest contract.
//!
//! Error mapping:
//!   - `Capture` wraps `screenshots::Error` (it's not Sized for thiserror's
//!     `#[from]` reasonably across versions, so we stringify on entry).
//!   - `NoScreen` surfaces the `screens.first()` empty-vec case (headless /
//!     RDP-disconnected sessions); orchestrator treats this as "skip this
//!     interval" rather than killing the session.
//!   - `Png` wraps the encoder failure (image-data → PNG bytes); these are
//!     practically impossible for valid RGBA frames but keep the error
//!     surface explicit.

use std::fs::{self, File};
use std::io::BufWriter;
use std::path::Path;

use screenshots::Screen;

#[derive(Debug, thiserror::Error)]
pub enum ScreenshotError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("no screen available")]
    NoScreen,
    #[error("screenshot capture: {0}")]
    Capture(String),
    #[error("png encode: {0}")]
    Png(String),
}

/// Capture the **primary** monitor and persist to
/// `data/screenshots/<game_id>/<unix_timestamp_seconds>.png`.
///
/// Returns the **relative** path string (e.g. `"screenshots/42/1714723200.png"`)
/// so the caller can insert it directly into `screenshots.path`. The frontend
/// joins this onto the `data_dir` returned by `get_data_dir` to render images.
///
/// The directory `data/screenshots/<game_id>/` is auto-created if it doesn't
/// exist (data_dir bootstrap pre-creates the parent `screenshots/` already in
/// 01a, but per-game subdirs are created on first capture).
pub fn capture_to_disk(data_dir: &Path, game_id: i64) -> Result<String, ScreenshotError> {
    // Enumerate available monitors. `Screen::all()` returns Vec<Screen>; if
    // it errors we forward the message verbatim (the crate's error type isn't
    // `'static` across versions, hence the `to_string` shim).
    let screens = Screen::all().map_err(|e| ScreenshotError::Capture(e.to_string()))?;
    let screen = screens.first().ok_or(ScreenshotError::NoScreen)?;

    // Capture returns a `screenshots::image::RgbaImage` (8-bit RGBA). We
    // encode ourselves via the `png` crate (already a Cargo dep) instead of
    // reaching for `image::ImageBuffer::write_to`, because:
    //   - screenshots 0.8 re-exports image v0.24 internally, while our
    //     project's `image` is v0.25 — there is no shared `RgbaImage` type
    //     across the two, so we can't call 0.25's `write_to` on a 0.24 buffer.
    //   - `png` is the lowest-level encode anyway; one straight raw → PNG
    //     pipe with no conversion cost.
    let img = screen
        .capture()
        .map_err(|e| ScreenshotError::Capture(e.to_string()))?;
    let (width, height) = img.dimensions();

    // Per-game subdir. `screenshots/` itself is pre-created at app boot
    // (data_dir::ensure_subdirs), so this is normally a single mkdir.
    let dir = data_dir.join("screenshots").join(game_id.to_string());
    fs::create_dir_all(&dir)?;

    // Filename = unix-seconds. Collisions within the same second are vanishingly
    // unlikely (interval lower-bound is 60s in orchestrator), but if they did
    // happen the second capture would simply overwrite — acceptable for v1.
    let ts = chrono::Utc::now().timestamp();
    let target = dir.join(format!("{ts}.png"));

    // Stream PNG straight to disk (avoid an intermediate Vec<u8> for ~8MB
    // 4K frames). BufWriter coalesces the encoder's small writes into 8KB
    // syscalls. On error the partially-written file may exist; the DB
    // INSERT happens AFTER the encoder's `finish()`, so a half-written
    // .png never gets a screenshots row pointing at it.
    let raw = img.into_raw(); // RGBA8 contiguous bytes, len = w*h*4
    let file = File::create(&target)?;
    let buf_writer = BufWriter::new(file);
    let mut encoder = png::Encoder::new(buf_writer, width, height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder
        .write_header()
        .map_err(|e| ScreenshotError::Png(e.to_string()))?;
    writer
        .write_image_data(&raw)
        .map_err(|e| ScreenshotError::Png(e.to_string()))?;
    writer
        .finish()
        .map_err(|e| ScreenshotError::Png(e.to_string()))?;

    Ok(format!("screenshots/{game_id}/{ts}.png"))
}

#[cfg(test)]
mod tests {
    //! Compile-only smoke. Real capture requires a windowing session
    //! (CI on Windows headless can't grab a DXGI desktop), so the
    //! end-to-end path is exercised manually before a release.
    use super::*;
    use std::path::PathBuf;

    #[allow(dead_code)]
    fn _signature_compiles(data_dir: PathBuf) {
        let _ = capture_to_disk(&data_dir, 1);
    }
}
