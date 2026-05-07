//! Bangumi-priority + VNDB-fallback metadata pipeline.
//!
//! Responsibilities:
//! - `clean_title` (in `crate::title_clean`)
//! - HTTP clients with rate-limiting + retry
//! - Confidence scoring (Levenshtein normalized)
//! - Public API: `search` / `fetch_detail` / `download_cover`

pub mod bangumi;
pub mod limiter;
pub mod match_score;
pub mod types;
pub mod vndb;

pub use types::{Candidate, MetadataDetail, MetadataError, MetadataSource};
