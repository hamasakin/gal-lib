//! Cover image fetcher + filesystem cache under `data/covers/{game_id}.{ext}`.
//!
//! - Reads the remote URL, picks the on-disk extension from the response
//!   `Content-Type` header (no transcoding), and writes the bytes verbatim.
//! - Returns the **relative** path (`covers/{game_id}.{ext}`) for the caller
//!   to persist into `games.cover_path`. Frontend resolves against `data_dir`
//!   via the existing `get_data_dir` command.
//! - Failure modes are explicit: invalid URL, unsupported content type,
//!   network error, IO error. The caller (ingest::process_game) treats any
//!   error as "skip cover, leave cover_path NULL"; UI shows the placeholder
//!   per 02-CONTEXT § Cover Cache.

use std::path::{Path, PathBuf};
use thiserror::Error;

use crate::http_safe::{
    download_capped, validate_remote_image_url, HttpSafeError, MAX_IMAGE_BYTES,
};

#[derive(Error, Debug)]
pub enum CacheError {
    #[error("http: {0}")]
    Http(#[from] reqwest::Error),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("invalid url: {0}")]
    InvalidUrl(String),
    #[error("unsupported content type: {0}")]
    UnsupportedType(String),
    #[error("http-safe: {0}")]
    HttpSafe(#[from] HttpSafeError),
}

const UA: &str = "gal-lib/0.1.0 (https://github.com/gal-lib/gal-lib)";

/// Download `url` and write to `data_dir/covers/{game_id}.{ext}`.
///
/// Returns the **relative** path `covers/{game_id}.{ext}` so callers can
/// store it directly in `games.cover_path` (resolved at render time against
/// the portable `data/` dir).
pub async fn cache_cover(
    data_dir: &Path,
    game_id: i64,
    url: &str,
) -> Result<PathBuf, CacheError> {
    // SSRF guard: reject non-http(s), IP-literal hosts, and loopback names
    // before issuing the request. Bangumi/VNDB cover URLs are user-influenced
    // (a tampered metadata response could inject internal URLs).
    let safe_url = validate_remote_image_url(url)
        .map_err(|e| CacheError::InvalidUrl(format!("{}: {}", url, e)))?;

    let client = reqwest::Client::builder()
        .user_agent(UA)
        .timeout(std::time::Duration::from_secs(30))
        .build()?;
    let resp = client.get(safe_url).send().await?.error_for_status()?;

    // Pick extension from Content-Type; default to jpg if header missing.
    let ct = resp
        .headers()
        .get("content-type")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("image/jpeg")
        .to_ascii_lowercase();
    let ext = if ct.contains("png") {
        "png"
    } else if ct.contains("webp") {
        "webp"
    } else if ct.contains("jpeg") || ct.contains("jpg") {
        "jpg"
    } else {
        return Err(CacheError::UnsupportedType(ct));
    };

    // Cap response body at MAX_IMAGE_BYTES so a misbehaving CDN can't OOM
    // the process. The cover JPGs we usually see are ~80 KiB; 10 MiB is
    // headroom for genuine high-res assets without being open-ended.
    let bytes = download_capped(resp, MAX_IMAGE_BYTES).await?;

    let covers_dir = data_dir.join("covers");
    std::fs::create_dir_all(&covers_dir)?;

    let target = covers_dir.join(format!("{}.{}", game_id, ext));
    std::fs::write(&target, &bytes)?;

    Ok(PathBuf::from(format!("covers/{}.{}", game_id, ext)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_http_url() {
        // We can't easily test the network success path without a mock server,
        // but the URL gate is pure and covered here. Network is exercised by
        // the dev smoke test in 02d Task 3.
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let dir = std::env::temp_dir().join(format!(
            "gal-lib-cover-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|x| x.as_nanos())
                .unwrap_or(0)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let res = rt.block_on(cache_cover(&dir, 1, "file:///etc/passwd"));
        assert!(matches!(res, Err(CacheError::InvalidUrl(_))));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn module_compiles() {
        // presence is the assertion
    }
}
