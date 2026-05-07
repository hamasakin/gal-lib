//! Shared types for the metadata subsystem.
//!
//! - `MetadataSource` distinguishes Bangumi / VNDB / Manual / None for the
//!   `games.metadata_source` column (schema v2).
//! - `Candidate` carries a single search hit with its computed confidence
//!   (0..=100) — UI selects ≥ 80 auto-bind, < 80 prompts user.
//! - `MetadataDetail` is the canonical detail view written into `games`
//!   after a candidate is committed.
//! - `MetadataError` is the unified error type returned by both clients;
//!   `Http` wraps reqwest errors so callers can pattern-match status for
//!   retry decisions.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MetadataSource {
    Bangumi,
    Vndb,
    Manual,
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Candidate {
    pub source: MetadataSource,
    /// Bangumi numeric id stringified, or VNDB "v123".
    pub source_id: String,
    pub title: String,
    pub alias: Vec<String>,
    pub cover_url: Option<String>,
    pub release_date: Option<String>,
    pub summary: Option<String>,
    /// 0..=100 confidence; ≥ 80 auto-bind, < 80 user picks.
    pub confidence: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetadataDetail {
    pub source: MetadataSource,
    pub source_id: String,
    pub title: String,
    pub title_cn: Option<String>,
    pub cover_url: Option<String>,
    pub summary: Option<String>,
    pub release_date: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum MetadataError {
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("rate limit budget exhausted")]
    RateLimited,
    #[error("not found")]
    NotFound,
    #[error("malformed response: {0}")]
    Malformed(String),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
}
