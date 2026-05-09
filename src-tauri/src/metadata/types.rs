//! Shared types for the metadata subsystem.
//!
//! - `MetadataSource` distinguishes Bangumi / VNDB / Manual / None for the
//!   `games.metadata_source` column (schema v2).
//! - `Candidate` carries a single search hit with its computed confidence
//!   (0..=100) — UI selects ≥ 80 auto-bind, < 80 prompts user.
//! - `MetadataDetail` is the canonical detail view written into `games`
//!   after a candidate is committed.
//! - `StaffRole` / `PersonRef` / `OfficialTagRef` are Phase 11 enrichment
//!   types used by `fetch_persons` / `fetch_characters` / extended
//!   `fetch_detail` to populate `persons` + `game_staff` + `game_official_tags`.
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

/// Phase 11 — locked 4-role enum for game_staff (matches v7 migration CHECK
/// constraint exactly). Cross-source role normalization happens in the
/// bangumi/vndb client modules; consumers see only this normalized form.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StaffRole {
    Scenario,
    Artist,
    Voice,
    Music,
}

impl StaffRole {
    pub fn as_str(&self) -> &'static str {
        match self {
            StaffRole::Scenario => "scenario",
            StaffRole::Artist => "artist",
            StaffRole::Voice => "voice",
            StaffRole::Music => "music",
        }
    }
}

/// One staff entry: a person + their role in a single game.
/// `character_name` is set only when role == Voice (the CV's character).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersonRef {
    pub source: MetadataSource,
    /// Bangumi person id stringified, or VNDB staff id like "s123".
    pub source_id: String,
    pub name: String,
    pub name_cn: Option<String>,
    pub role: StaffRole,
    pub character_name: Option<String>,
}

/// One official tag entry on a game (Bangumi user-tag with count, or VNDB
/// tag with rating). `weight` semantics differ by source — we store as-is
/// and let the UI render relative weights per-game.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OfficialTagRef {
    pub name: String,
    pub weight: i32,
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
    /// Phase 11 — brand / publisher / circle name extracted from
    /// Bangumi infobox `开发`/`发行` or VNDB `developers[0].name`.
    pub brand: Option<String>,
    /// Phase 11 — official tags for this title (already normalized + sorted
    /// by descending weight by the client).
    pub tags: Vec<OfficialTagRef>,
    /// Quick 20260510b — age-rating signal from the source.
    /// `Some(true)` = R18, `Some(false)` = all-ages, `None` = unknown
    /// (source returned no signal). Bangumi uses the `nsfw` boolean directly;
    /// VNDB derives from the presence of `category=ero` tags above a rating
    /// threshold.
    pub is_r18: Option<bool>,
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
