//! Database migration registry for tauri-plugin-sql.
//!
//! Schema v1 lives in `migrations/0001_init.sql` and is embedded at compile
//! time via `include_str!` so the migration ships inside the exe (no external
//! .sql file shipped alongside the binary).

use tauri_plugin_sql::{Migration, MigrationKind};

const INIT_SQL: &str = include_str!("../migrations/0001_init.sql");

/// All migrations to register with tauri-plugin-sql, in version order.
/// Add future migrations as additional entries with monotonically increasing
/// `version` values (sqlx tracks applied versions in `_sqlx_migrations`).
pub fn migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "init_schema",
        sql: INIT_SQL,
        kind: MigrationKind::Up,
    }]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_v1_includes_required_objects() {
        let m = migrations();
        assert_eq!(m.len(), 1, "v1: exactly one migration");
        assert_eq!(m[0].version, 1);
        assert_eq!(m[0].description, "init_schema");
        // sanity-check the embedded SQL covers all five tables and the schema_version row
        assert!(m[0].sql.contains("CREATE TABLE games"));
        assert!(m[0].sql.contains("CREATE TABLE sessions"));
        assert!(m[0].sql.contains("CREATE TABLE tags"));
        assert!(m[0].sql.contains("CREATE TABLE game_tags"));
        assert!(m[0].sql.contains("CREATE TABLE app_meta"));
        assert!(m[0].sql.contains("'schema_version', '1'"));
    }
}
