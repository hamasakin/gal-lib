//! Per-source token-bucket rate limiters.
//!
//! Bangumi: 1 req/sec (community-recommended; no formal docs).
//! VNDB:    1 req / 2s ≈ 30 req/min, BURST CAPACITY CLAMPED TO 1.
//!          VNDB documents 200 req/5min ≈ 40/min but real-world responses
//!          429 well before that, especially when Phase 11 enrichment fans
//!          out 3 calls per game in close succession.
//!
//! Why `with_period` (burst = 1) rather than `per_minute(30)` (burst = 30):
//!   `Quota::per_minute(30)` gives governor a token bucket with **burst
//!   capacity 30** — at process start the bucket is full, so the first ~30
//!   `wait_vndb()` calls return INSTANTLY with no spacing. The concurrent
//!   ingest path (INGEST_CONCURRENCY games × up to 4 VNDB calls each) drains
//!   that whole burst at scan-start, hammering VNDB hard enough to trip its
//!   server-side 429 throttle — which the bounded `with_retry` budget can't
//!   outlast, so games past the first ~8 silently lose all VNDB candidates.
//!   `with_period(2s)` produces the same 30/min steady rate but with the
//!   default burst of 1: every request is spaced ≥ 2s apart, even the very
//!   first batch. No more startup thundering herd. (debug session
//!   auto-scan-metadata-match-low, 2026-05-15.)
//!
//! Both are process-wide singletons via `once_cell::Lazy`. Callers
//! `await wait_bangumi()` / `wait_vndb()` immediately before issuing the
//! HTTP request. governor handles fairness + back-pressure under load.

use governor::{
    clock::DefaultClock,
    state::{InMemoryState, NotKeyed},
    Quota, RateLimiter as Gov,
};
use once_cell::sync::Lazy;
use std::num::NonZeroU32;
use std::time::Duration;

pub type RateLimiter = Gov<NotKeyed, InMemoryState, DefaultClock>;

pub static BANGUMI: Lazy<RateLimiter> =
    Lazy::new(|| Gov::direct(Quota::per_second(NonZeroU32::new(1).unwrap())));

/// VNDB: one cell every 2 s (≈ 30/min). `Quota::with_period` defaults the
/// burst capacity to 1 — exactly what we want so the startup batch can't
/// fire 30 requests at once. `expect` is safe: 2 s is a non-zero period.
pub static VNDB: Lazy<RateLimiter> = Lazy::new(|| {
    Gov::direct(
        Quota::with_period(Duration::from_secs(2)).expect("VNDB quota period is non-zero"),
    )
});

pub async fn wait_bangumi() {
    BANGUMI.until_ready().await;
}

pub async fn wait_vndb() {
    VNDB.until_ready().await;
}
