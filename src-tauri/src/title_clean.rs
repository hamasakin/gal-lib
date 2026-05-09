//! Title cleaning for metadata search.
//!
//! Standard pipeline (regex-based, data-driven via lazy `once_cell::Lazy<Regex>`):
//!   1) strip parenthesized content (full-width AND ASCII `()` `（）`)
//!   2) strip bracketed content (`[...]` `【...】`) — release groups,
//!      date codes like `[180216]`, scene tags
//!   3) strip noise tokens (汉化版 / v1.5 / DL版 / Patch / Crack / ...)
//!   4) strip publisher / fan-tl-group prefixes (1-6 CJK + separator)
//!   5) strip trailing tokuten/disc suffixes (`+ Tokuten Voice`, `DISC-15`)
//!   6) strip trailing date strings (YYYY.MM.DD / YYYYMMDD / YYMMDD)
//!   7) full-width → half-width whitespace, collapse runs, trim
//!
//! `aggressive_clean` is a fallback that returns the longest contiguous
//! CJK run (Han / Katakana / Hiragana). Used by the ingest layer when the
//! standard clean still fails to yield ≥80 confidence from any source —
//! isolates the core title from heavy doujin/scene noise.

use once_cell::sync::Lazy;
use regex::Regex;

static RE_PAREN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"[（(][^（()）]*[)）]").unwrap());

static RE_BRACKET: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"[\[【][^\[\]【】]*[\]】]").unwrap());

static RE_NOISE: Lazy<Regex> = Lazy::new(|| {
    // case-insensitive; covers common gal community noise
    Regex::new(r"(?i)(汉化版|繁体|简体|完整版|修正版|体験版|体验版|全年龄版|全年齢版|DL版|Steam版|Patch|Crack|v\d+(\.\d+)*|(\d{4}年)?\d{1,2}月发售)")
        .unwrap()
});

static RE_PREFIX: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^[\p{Han}\p{Katakana}A-Za-z]{1,6}\s*[\-_:]\s*").unwrap());

static RE_DISC: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\s*DISC[-_\s]*\d+\s*").unwrap());

// Trailing `+ <CJK or latin run>` (e.g. `+ Tokuten Voice`, `+ ボーカル特典`).
// Matched at end-of-string only — a `+` mid-title (rare but legal) is preserved.
// `ー` (U+30FC katakana-hiragana prolonged sound mark) is `Common` script,
// not `Katakana`, so it must be enumerated explicitly to keep `ボーカル`
// from breaking the run.
static RE_TOKUTEN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)\s*\+\s*[\p{Han}\p{Katakana}\p{Hiragana}A-Za-zー][\p{Han}\p{Katakana}\p{Hiragana}A-Za-zー\s]*(?:Voice|特典)?\s*$",
    )
    .unwrap()
});

static RE_TRAIL_DATE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\s*\d{4}[.\-]?\d{1,2}[.\-]?\d{1,2}\s*$").unwrap());

/// Clean a raw directory name into a search query string.
pub fn clean_title(raw: &str) -> String {
    let mut s = raw.to_string();
    s = RE_PAREN.replace_all(&s, " ").into_owned();
    s = RE_BRACKET.replace_all(&s, " ").into_owned();
    s = RE_NOISE.replace_all(&s, " ").into_owned();
    s = RE_PREFIX.replace_all(&s, "").into_owned();
    s = RE_DISC.replace_all(&s, " ").into_owned();
    s = RE_TOKUTEN.replace_all(&s, "").into_owned();
    s = RE_TRAIL_DATE.replace_all(&s, "").into_owned();
    // full-width space → half-width
    s = s.replace('\u{3000}', " ");
    // collapse whitespace
    s = s.split_whitespace().collect::<Vec<_>>().join(" ");
    s.trim().to_string()
}

/// Aggressive fallback: extract the longest contiguous "title-char" run
/// from the standard-cleaned title.
///
/// Title-chars are Han + Hiragana + Katakana + halfwidth/fullwidth digits
/// + a few in-title punctuation marks (`・々、。〜！？ー`). Including digits
/// matters: titles like `艶嬢学園２` / `シンフォギア２` were otherwise
/// severed at the digit. ASCII letters are *intentionally excluded* —
/// when a directory is dominated by Latin (e.g. `Symphonic Rain`), the
/// standard clean is already correct and the aggressive fallback should
/// defer to it rather than picking a sub-word like `Symphonic`.
///
/// After picking the longest run, leading and trailing pure-punctuation
/// chars are trimmed (so a subtitle delimited by `ー...ー` doesn't
/// retain its decorative book-ends in the search query).
///
/// Used by the ingest layer when both Bangumi and VNDB miss the standard
/// query — isolates the core title from heavy doujin scene-release noise
/// that survived the regex pipeline. Returns the standard clean
/// unchanged if no CJK run exists (pure-Latin titles, all-punctuation
/// pathological directories).
pub fn aggressive_clean(raw: &str) -> String {
    let standard = clean_title(raw);
    let mut best = String::new();
    let mut current = String::new();
    for ch in standard.chars() {
        if is_cjk_titlechar(ch) {
            current.push(ch);
        } else {
            if has_cjk(&current) && current.chars().count() > best.chars().count() {
                best = current.clone();
            }
            current.clear();
        }
    }
    if has_cjk(&current) && current.chars().count() > best.chars().count() {
        best = current;
    }
    let trimmed = trim_title_punct(&best);
    if trimmed.is_empty() {
        standard
    } else {
        trimmed.to_string()
    }
}

/// True iff `s` contains at least one Han / Hiragana / Katakana character.
/// Used to reject pure-digit / pure-punctuation runs from the aggressive
/// pick — those are junk fallbacks for an API search.
fn has_cjk(s: &str) -> bool {
    s.chars().any(|ch| {
        let n = ch as u32;
        let in_han = (0x4E00..=0x9FFF).contains(&n) || (0x3400..=0x4DBF).contains(&n);
        let in_hira = (0x3040..=0x309F).contains(&n);
        let in_kana = (0x30A0..=0x30FF).contains(&n);
        in_han || in_hira || in_kana
    })
}

fn is_cjk_titlechar(ch: char) -> bool {
    // Unicode blocks: CJK Unified, Hiragana, Katakana, plus halfwidth +
    // fullwidth digits, and a few common in-title punctuation chars that
    // shouldn't break a contiguous run. ASCII letters are deliberately
    // not included — see `aggressive_clean` doc.
    let n = ch as u32;
    let in_han = (0x4E00..=0x9FFF).contains(&n) || (0x3400..=0x4DBF).contains(&n);
    let in_hira = (0x3040..=0x309F).contains(&n);
    let in_kana = (0x30A0..=0x30FF).contains(&n);
    let in_digit = ch.is_ascii_digit() || (0xFF10..=0xFF19).contains(&n); // 0-9 / ０-９
    let punctuation = is_title_punct(ch);
    in_han || in_hira || in_kana || in_digit || punctuation
}

fn is_title_punct(ch: char) -> bool {
    matches!(ch, '・' | '々' | '、' | '。' | '〜' | '！' | '？' | 'ー')
}

/// Strip leading and trailing pure-punctuation chars from a title run.
/// Leaves interior punctuation untouched (`艶嬢学園・第二章` keeps the `・`).
fn trim_title_punct(s: &str) -> &str {
    s.trim_matches(|ch: char| is_title_punct(ch) || ch.is_whitespace())
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

    #[test]
    fn strips_brackets() {
        // Release-group / scene tags / date codes like [180216] go away.
        assert_eq!(
            clean_title("[PULLTOP] [180216] 見上げてごらん、夜空の星を"),
            "見上げてごらん、夜空の星を"
        );
        // Full-width brackets too.
        assert_eq!(
            clean_title("【天使汉化】CLANNAD"),
            "CLANNAD"
        );
    }

    #[test]
    fn strips_tokuten_suffix() {
        assert_eq!(
            clean_title("凛とした最愛妻 + Tokuten Voice"),
            "凛とした最愛妻"
        );
        assert_eq!(
            clean_title("クロスチャンネル + ボーカル特典"),
            "クロスチャンネル"
        );
    }

    #[test]
    fn strips_disc_token() {
        assert_eq!(
            clean_title("Premium Anniversary Pack DISC-15 見上げてごらん"),
            "Premium Anniversary Pack 見上げてごらん"
        );
    }

    #[test]
    fn aggressive_picks_longest_cjk_run() {
        // The bracket-heavy doujin example — standard clean strips brackets
        // and parens, aggressive isolates the longest Japanese run.
        let raw = "(18禁ゲーム) [PULLTOP] [180216] PULLTOP 15th X 15タイトル \
                   Premium Anniversary Pack DISC-15 見上げてごらん、夜空の星を \
                   FINE DAYS (iso+mds+rr3)";
        let agg = aggressive_clean(raw);
        // Longest contiguous CJK run is the title itself (or 15タイトル — but
        // 見上げてごらん、夜空の星を is much longer).
        assert_eq!(agg, "見上げてごらん、夜空の星を");
    }

    #[test]
    fn aggressive_falls_back_to_standard_when_no_cjk() {
        // Pure English / Latin titles have no CJK run — return the standard
        // clean unchanged so we don't return an empty query.
        assert_eq!(aggressive_clean("Symphonic Rain v1.5"), "Symphonic Rain");
    }

    #[test]
    fn aggressive_keeps_digits_in_cjk_run() {
        // 「艶嬢学園２」 should stay as a single 5-char run (was previously
        // severed at the fullwidth digit ２, leaving 「艶嬢学園」 4 chars).
        // The longer subtitle still wins overall, but the leading 「ー」
        // is now trimmed so it returns clean.
        let raw = "(18禁ゲーム) [240927] [アストロノーツ・シリウス] \
                   艶嬢学園２ ー熾天使たちの花園ー";
        let agg = aggressive_clean(raw);
        assert_eq!(agg, "熾天使たちの花園");
        // And the digits-in-run guarantee: a title where the digit-bearing
        // run IS the longest must keep the digit.
        let r2 = aggressive_clean("[150227] シンフォギア２");
        assert_eq!(r2, "シンフォギア２");
    }

    #[test]
    fn aggressive_trims_leading_trailing_punct() {
        // Decorative ー/〜/！ book-ends are stripped from the chosen run.
        assert_eq!(aggressive_clean("ーー雪月華〜！"), "雪月華");
    }

    #[test]
    fn aggressive_rejects_pure_digit_runs() {
        // Without the has_cjk guard, "Night Shift Nurses_r18" would AGG to
        // "18" (a 2-char digit run beats no CJK run). We instead want to
        // fall back to the standard clean so the Latin title gets a fair
        // shot at matching by itself.
        assert_eq!(aggressive_clean("Night Shift Nurses_r18"), "Night Shift Nurses_r18");
        assert_eq!(
            aggressive_clean("Applique.081023.Concerto Note"),
            "Applique.081023.Concerto Note"
        );
        assert_eq!(aggressive_clean("ROOM ver.1.0.2"), "ROOM ver.1.0.2");
    }

    #[test]
    fn full_pipeline_gnarly_doujin_example() {
        // The user's real-world example #2.
        let raw = "[220325] [ANIM.teamMM] 凛とした最愛妻は、人知れず淫乱ら妻へと堕ちて + Tokuten Voice";
        assert_eq!(
            clean_title(raw),
            "凛とした最愛妻は、人知れず淫乱ら妻へと堕ちて"
        );
    }
}
