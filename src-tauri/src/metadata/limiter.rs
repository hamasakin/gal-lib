//! Per-source token-bucket rate limiters.
//!
//! Bangumi: 1 req/sec (community-recommended; no formal docs).
//! VNDB:    30 req/min (conservative; VNDB documents 200 req/5min ≈ 40/min
//!          but real-world responses 429 well before that, especially when
//!          Phase 11 enrichment fans out 3 calls per game in close succession).
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

pub type RateLimiter = Gov<NotKeyed, InMemoryState, DefaultClock>;

pub static BANGUMI: Lazy<RateLimiter> =
    Lazy::new(|| Gov::direct(Quota::per_second(NonZeroU32::new(1).unwrap())));

pub static VNDB: Lazy<RateLimiter> =
    Lazy::new(|| Gov::direct(Quota::per_minute(NonZeroU32::new(30).unwrap())));

pub async fn wait_bangumi() {
    BANGUMI.until_ready().await;
}

pub async fn wait_vndb() {
    VNDB.until_ready().await;
}
