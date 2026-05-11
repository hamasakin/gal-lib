//! Phase 13 (PER-04) — portrait image fetcher + filesystem cache.
//!
//! On-disk layout: `data/portraits/{source}-{source_id}.{ext}`. The same shape
//! as `cover_cache` so the frontend can `convertFileSrc(data_dir + '/' + rel)`
//! without any new helper.
//!
//! Bangumi only this phase (per CONTEXT.md). VNDB portraits ship in v1.4 —
//! callers see `Ok(None)` and fall back to the text monogram already rendered
//! by `CoStaffStrip` / `Persons` header.

use std::path::{Path, PathBuf};

use crate::metadata::limiter;

const UA: &str = "gal-lib/0.1.0 (https://github.com/gal-lib/gal-lib)";
const BANGUMI_PERSON_BASE: &str = "https://api.bgm.tv/v0/persons/";

/// Picks the on-disk extension for a downloaded portrait. Mirrors the
/// content-type sniff in `cover_cache::cache_cover` so libraries built
/// from one cache speak the same vocabulary.
fn ext_for(content_type: &str) -> Option<&'static str> {
    let ct = content_type.to_ascii_lowercase();
    if ct.contains("png") {
        Some("png")
    } else if ct.contains("webp") {
        Some("webp")
    } else if ct.contains("jpeg") || ct.contains("jpg") {
        Some("jpg")
    } else {
        None
    }
}

/// Return relative path `portraits/{source}-{source_id}.{ext}` for any
/// already-cached extension. `None` if no cached file exists yet.
fn lookup_cached(data_dir: &Path, source: &str, source_id: &str) -> Option<PathBuf> {
    let dir = data_dir.join("portraits");
    for ext in ["jpg", "png", "webp"] {
        let rel = format!("portraits/{}-{}.{}", source, source_id, ext);
        if dir.join(format!("{}-{}.{}", source, source_id, ext)).exists() {
            return Some(PathBuf::from(rel));
        }
    }
    None
}

/// Bangumi `GET /v0/persons/{id}` — returns the URL of the medium-resolution
/// portrait, or `None` if Bangumi has no image for this person. The remote
/// `images` object is `{ large, medium, small, grid }`; medium is the right
/// trade-off for our 40px / 56px avatar slots.
async fn bangumi_portrait_url(source_id: &str) -> Result<Option<String>, String> {
    let url = format!("{}{}", BANGUMI_PERSON_BASE, source_id);
    limiter::wait_bangumi().await;
    let client = reqwest::Client::builder()
        .user_agent(UA)
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    let resp = resp.error_for_status().map_err(|e| e.to_string())?;
    let v: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let medium = v
        .get("images")
        .and_then(|imgs| imgs.get("medium"))
        .and_then(|s| s.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    Ok(medium)
}

/// Cache-first portrait resolver. Returns the relative path under `data/`
/// (e.g. `portraits/bangumi-12345.jpg`) on success. `Ok(None)` means the
/// source has no portrait for this person (or it's a VNDB person, which
/// this phase deliberately skips). `Err` is only network / IO trouble that
/// the caller should NOT swallow silently.
pub async fn get_or_fetch(
    data_dir: &Path,
    source: &str,
    source_id: &str,
) -> Result<Option<PathBuf>, String> {
    if source_id.trim().is_empty() {
        return Ok(None);
    }
    if let Some(p) = lookup_cached(data_dir, source, source_id) {
        return Ok(Some(p));
    }

    // VNDB portraits deferred to v1.4 per CONTEXT.md.
    if source != "bangumi" {
        return Ok(None);
    }

    let remote = match bangumi_portrait_url(source_id).await? {
        Some(u) => u,
        None => return Ok(None),
    };

    let client = reqwest::Client::builder()
        .user_agent(UA)
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(&remote).send().await.map_err(|e| e.to_string())?;
    let resp = resp.error_for_status().map_err(|e| e.to_string())?;
    let ct = resp
        .headers()
        .get("content-type")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("image/jpeg")
        .to_string();
    let ext = match ext_for(&ct) {
        Some(e) => e,
        None => return Ok(None),
    };
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;

    let dir = data_dir.join("portraits");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file_name = format!("{}-{}.{}", source, source_id, ext);
    let abs = dir.join(&file_name);
    std::fs::write(&abs, &bytes).map_err(|e| e.to_string())?;

    Ok(Some(PathBuf::from(format!("portraits/{}", file_name))))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ext_picks_known_content_types() {
        assert_eq!(ext_for("image/jpeg"), Some("jpg"));
        assert_eq!(ext_for("image/png; charset=binary"), Some("png"));
        assert_eq!(ext_for("image/webp"), Some("webp"));
        assert_eq!(ext_for("application/octet-stream"), None);
    }

    #[test]
    fn lookup_returns_none_when_missing() {
        let tmp = std::env::temp_dir().join(format!(
            "gal-lib-portrait-lookup-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        std::fs::create_dir_all(&tmp).unwrap();
        assert!(lookup_cached(&tmp, "bangumi", "nope").is_none());
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn lookup_finds_cached_jpg() {
        let tmp = std::env::temp_dir().join(format!(
            "gal-lib-portrait-find-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        std::fs::create_dir_all(tmp.join("portraits")).unwrap();
        std::fs::write(tmp.join("portraits/bangumi-99.jpg"), b"x").unwrap();
        let got = lookup_cached(&tmp, "bangumi", "99").unwrap();
        assert_eq!(
            got.to_string_lossy().replace('\\', "/"),
            "portraits/bangumi-99.jpg"
        );
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
