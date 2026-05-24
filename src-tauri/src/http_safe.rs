//! Shared HTTP safety helpers — SSRF guard + capped-size download.
//!
//! Both `cover_cache` and `portrait_cache` ingest remote image URLs that
//! originate from Bangumi/VNDB JSON responses. Without these guards a
//! malicious / tampered metadata response could:
//!   1. Coerce us into fetching internal/loopback URLs (SSRF — Warning in
//!      260524 review).
//!   2. Stream an arbitrarily large body straight into a `Vec<u8>` until
//!      the process OOMs (no size cap — same review).
//!
//! `validate_remote_image_url` does an upfront URL sanity check; download
//! callers should pass it before issuing the request. `download_capped`
//! streams the response and aborts the moment cumulative bytes exceed the
//! cap, so an unbounded body never lands in memory.

use futures_util::StreamExt;
use std::net::IpAddr;
use std::str::FromStr;

/// Maximum body size for image downloads. 10 MiB is overkill for a cover
/// (typical Bangumi JPGs are ~80 KiB; ling.bgm.tv tops out around 1 MiB)
/// but cheap enough that we don't need separate caps per asset type.
pub const MAX_IMAGE_BYTES: usize = 10 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum HttpSafeError {
    #[error("invalid url: {0}")]
    InvalidUrl(String),
    #[error("disallowed url: {0}")]
    DisallowedUrl(String),
    #[error("http: {0}")]
    Http(#[from] reqwest::Error),
    #[error("response exceeded {limit} bytes")]
    TooLarge { limit: usize },
}

/// Validate that a URL is safe to fetch as a remote image asset.
///
/// Accepts only `http`/`https` schemes, rejects IP-literal hosts (forces
/// the URL through DNS so an attacker can't sidestep host allow-lists with
/// a numeric address), and rejects well-known loopback / link-local host
/// names. Returns the parsed URL on success.
///
/// Not a substitute for an explicit host allow-list — but raises the bar
/// from "fetches anything the JSON tells it to" to "fetches anything
/// resolvable on the public internet". The downstream OS network stack
/// still applies (e.g. corp DNS may resolve internal names, which is the
/// caller's risk model to address).
pub fn validate_remote_image_url(url: &str) -> Result<reqwest::Url, HttpSafeError> {
    let parsed =
        reqwest::Url::parse(url).map_err(|e| HttpSafeError::InvalidUrl(format!("{}: {}", url, e)))?;
    match parsed.scheme() {
        "http" | "https" => {}
        other => {
            return Err(HttpSafeError::DisallowedUrl(format!(
                "scheme '{}' not allowed",
                other
            )))
        }
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| HttpSafeError::DisallowedUrl("url has no host".to_string()))?;
    if IpAddr::from_str(host).is_ok() {
        return Err(HttpSafeError::DisallowedUrl(format!(
            "IP-literal host '{}' not allowed",
            host
        )));
    }
    let host_lc = host.to_ascii_lowercase();
    const FORBIDDEN_HOSTS: &[&str] = &["localhost", "local", "broadcasthost"];
    if FORBIDDEN_HOSTS.iter().any(|f| host_lc == *f) {
        return Err(HttpSafeError::DisallowedUrl(format!(
            "host '{}' not allowed",
            host
        )));
    }
    Ok(parsed)
}

/// Stream a response body into memory, aborting if cumulative bytes exceed
/// `limit`. Use this instead of `resp.bytes().await?` for any download
/// whose size you don't otherwise control — image CDNs occasionally serve
/// surprise XXL artifacts and we'd rather error out than swallow them.
pub async fn download_capped(
    resp: reqwest::Response,
    limit: usize,
) -> Result<Vec<u8>, HttpSafeError> {
    // Honor Content-Length when the server provides it — short-circuits
    // before allocating any buffer for blatantly oversized responses.
    if let Some(len) = resp.content_length() {
        if (len as usize) > limit {
            return Err(HttpSafeError::TooLarge { limit });
        }
    }
    let mut stream = resp.bytes_stream();
    let mut buf: Vec<u8> = Vec::with_capacity(64 * 1024);
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        if buf.len() + chunk.len() > limit {
            return Err(HttpSafeError::TooLarge { limit });
        }
        buf.extend_from_slice(&chunk);
    }
    Ok(buf)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_http_scheme() {
        assert!(matches!(
            validate_remote_image_url("file:///etc/passwd"),
            Err(HttpSafeError::DisallowedUrl(_))
        ));
        assert!(matches!(
            validate_remote_image_url("ftp://example.com/x.png"),
            Err(HttpSafeError::DisallowedUrl(_))
        ));
    }

    #[test]
    fn rejects_ip_literals() {
        assert!(matches!(
            validate_remote_image_url("http://127.0.0.1/x.png"),
            Err(HttpSafeError::DisallowedUrl(_))
        ));
        assert!(matches!(
            validate_remote_image_url("http://192.168.1.1/x.png"),
            Err(HttpSafeError::DisallowedUrl(_))
        ));
        assert!(matches!(
            validate_remote_image_url("http://[::1]/x.png"),
            Err(HttpSafeError::DisallowedUrl(_))
        ));
    }

    #[test]
    fn rejects_loopback_names() {
        assert!(matches!(
            validate_remote_image_url("http://localhost/x.png"),
            Err(HttpSafeError::DisallowedUrl(_))
        ));
    }

    #[test]
    fn accepts_https_image_host() {
        assert!(validate_remote_image_url("https://lain.bgm.tv/r/400/x.jpg").is_ok());
    }
}
