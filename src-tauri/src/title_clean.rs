//! Title cleaning for metadata search.
//!
//! Applies a fixed 5-step pipeline (regex-based) to convert raw directory
//! names into search queries suitable for Bangumi/VNDB. Documented order:
//!   1) strip parenthesized content (full-width AND ASCII)
//!   2) strip noise tokens (汉化版 / v1.5 / DL版 / Patch / Crack / 完整版 ...)
//!   3) strip publisher / fan-tl-group prefixes (1-3 CJK + separator)
//!   4) strip trailing date strings (YYYY.MM.DD / YYYYMMDD / YYMMDD)
//!   5) full-width → half-width whitespace, collapse runs, trim
//!
//! Pipeline is data-driven via 4 lazy regexes (`once_cell::Lazy<Regex>`).

use once_cell::sync::Lazy;
use regex::Regex;

static RE_PAREN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"[（(][^（()）]*[)）]").unwrap());

static RE_NOISE: Lazy<Regex> = Lazy::new(|| {
    // case-insensitive; covers common gal community noise
    Regex::new(r"(?i)(汉化版|繁体|简体|完整版|修正版|体験版|体验版|全年龄版|全年齢版|DL版|Steam版|Patch|Crack|v\d+(\.\d+)*|(\d{4}年)?\d{1,2}月发售)")
        .unwrap()
});

static RE_PREFIX: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^[\p{Han}\p{Katakana}A-Za-z]{1,6}\s*[\-_:]\s*").unwrap());

static RE_TRAIL_DATE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\s*\d{4}[.\-]?\d{1,2}[.\-]?\d{1,2}\s*$").unwrap());

/// Clean a raw directory name into a search query string.
pub fn clean_title(raw: &str) -> String {
    let mut s = raw.to_string();
    s = RE_PAREN.replace_all(&s, " ").into_owned();
    s = RE_NOISE.replace_all(&s, " ").into_owned();
    s = RE_PREFIX.replace_all(&s, "").into_owned();
    s = RE_TRAIL_DATE.replace_all(&s, "").into_owned();
    // full-width space → half-width
    s = s.replace('\u{3000}', " ");
    // collapse whitespace
    s = s.split_whitespace().collect::<Vec<_>>().join(" ");
    s.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_parenthesized_versions() {
        assert_eq!(clean_title("Fate/stay night (汉化版) (v1.5)"), "Fate/stay night");
    }

    #[test]
    fn strips_publisher_prefix() {
        assert_eq!(clean_title("天使汉化_FateStayNight"), "FateStayNight");
        assert_eq!(clean_title("ABC社 - クロスチャンネル"), "クロスチャンネル");
    }

    #[test]
    fn strips_noise_tokens() {
        assert_eq!(clean_title("Saya no Uta 完整版 v2.0"), "Saya no Uta");
    }

    #[test]
    fn strips_trailing_date() {
        assert_eq!(clean_title("Steins;Gate 2009.10.15"), "Steins;Gate");
    }

    #[test]
    fn collapses_whitespace_and_fullwidth() {
        assert_eq!(clean_title("  CLANNAD\u{3000}\u{3000} 全年龄版  "), "CLANNAD");
    }

    #[test]
    fn empty_input_safe() {
        assert_eq!(clean_title(""), "");
    }
}
