/**
 * Tauri invoke wrapper for the `games` table read API.
 *
 * Phase 2's Library route reads the full `games` rowset to render the cover
 * grid. Mutations to `games` flow through the dedicated commands wired in
 * 02d (`bind_metadata` / `refresh_metadata`) and the scan ingest pipeline
 * (`start_scan` UPSERTs + UPDATEs); this file only exposes the read path.
 *
 * Type shape mirrors `src-tauri/migrations/0002_*.sql` `games` columns 1:1.
 * Optional columns are typed as `T | null` (sqlx returns `NULL` as `null`
 * over JSON; never `undefined`). Column ordering here matches the schema's
 * declaration order so manual diffs against the migration stay readable.
 *
 * `status` and `metadata_source` are typed as string-literal unions even
 * though SQLite stores them as TEXT — the Rust ingest path is the only
 * writer for `metadata_source` (whitelisted to "bangumi"|"vndb"|"none"|
 * "manual") and the schema's CHECK constraint enforces `status` to one of
 * the four locked values.
 */

import { invoke } from "@tauri-apps/api/core";

/** Row from the `games` table (Phase 2 schema v2). */
export interface Game {
  id: number;
  /** Absolute filesystem path of the game directory (UNIQUE in DB). */
  path: string;
  /** Authoritative title — bound from Bangumi/VNDB or cleaned from disk name. */
  name: string;
  /** Localized (Chinese) title from the metadata source, when available. */
  name_cn: string | null;
  /** Best-scored .exe within the game directory, or null if none qualified. */
  executable_path: string | null;
  /** Relative cover path under data_dir (e.g. `covers/42.jpg`); resolved
   *  via `convertFileSrc(dataDir + '/' + cover_path)` for `<img>` use. */
  cover_path: string | null;
  /** Remote cover URL (used for retry / re-cache; not rendered directly). */
  cover_url: string | null;
  /** Bangumi numeric subject id, stringified. */
  bangumi_id: string | null;
  /** VNDB id (e.g. "v1234"). */
  vndb_id: string | null;
  /** Cumulative play time across all sessions (Phase 3 will populate). */
  total_playtime_sec: number;
  last_played_at: string | null;
  status: "unplayed" | "playing" | "cleared" | "dropped";
  notes: string | null;
  metadata_source: "bangumi" | "vndb" | "manual" | "none" | null;
  /** 0..=100; `null` until ingest runs. ≥80 = auto-bind, <80 = needs review. */
  match_confidence: number | null;
  last_scanned_at: string | null;
  /**
   * Quick 260515-loading-phase-sort — 元数据最近一次获取的时间锚点。
   * 当前与 `last_scanned_at` 同值，但语义上专门用于排序：scan/refresh 中
   * Library 按这个字段 DESC 排，让"最近刚获取过元数据"的卡浮在前列。未来
   * 若引入只更新 last_scanned_at 的非元数据扫描，这个字段不被污染。
   */
  metadata_fetched_at: string | null;
  // ── Phase 4 / schema v4 fields ──
  /**
   * Brand / publisher / circle name from the metadata source. Filled by the
   * Phase-4 metadata-fetch pipeline (META) and surfaced as a sidebar
   * auto-category (`get_sidebar_categories().brands`).
   */
  brand: string | null;
  /**
   * Release year (4 digits, e.g. 2018). Bucketed into decade categories on
   * the sidebar (`get_sidebar_categories().year_decades`).
   */
  release_year: number | null;
  /**
   * Favorite flag. SQLite stores as INTEGER 0/1; Rust `serde` serializes
   * the Tauri command output as a real JS boolean (see `row_to_game` in
   * `src-tauri/src/commands.rs` — `is_favorite = ... != 0`), so consumers
   * can rely on `=== true` / `=== false`.
   */
  is_favorite: boolean;
  // ── Phase 11 / schema v7 fields ──
  /**
   * Game synopsis from the metadata source (Bangumi `summary` or VNDB
   * `description`). Multiline plain text; rendered as paragraphs in the
   * Detail page summary section. `null` when the metadata source returned
   * no description, when the game is unbound, or before the v7 backfill
   * has reached this row.
   */
  summary: string | null;
  // ── Quick 260525-g1m / schema v13 fields ──
  /**
   * 官方评分（Bangumi rating.score 或 VNDB rating/10 后的 0..=10 浮点，1 位小数精度）。
   * `null` 表示未绑定 / 源未返回。「评分」排序键按本字段 DESC NULL LAST。
   * Quick 260526-0bi — 本地用户打分字段 `games.rating` 已移除，
   * 现在 external_rating 是唯一评分维度。
   */
  external_rating: number | null;
  /** 参与打分人数（Bangumi rating.total / VNDB votecount）。 */
  external_rating_count: number | null;
  /** 评分来源，与 metadata_source 同口径。 */
  external_rating_source: "bangumi" | "vndb" | null;
  // ── Phase 3 / schema v3 launch-config fields ──
  // 260526 历史欠账修复：后端 list_games / get_game / search_games 长期漏读这
  // 三列，导致前端拿不到持久化值，详情页「启动配置」保存后再进入永远被重置成
  // 默认（"le-jp" / 空 args / 空 cwd）。补回 SELECT + Game struct + 这里的
  // TS interface 后保存才真正可见。
  /** LE 启动 profile 哨兵值："Japanese" = 日区 LE 启动；"direct" = 直接启动。
   *  Detail 页通过 `leProfileToMethod` 把这个映射回 LaunchMethod。 */
  le_profile: string;
  /** 自定义启动参数（whitespace 分割）；null = 未设置。 */
  launch_args: string | null;
  /** 自定义工作目录；null = 自动取 exe 父目录。 */
  cwd: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Fetch all games, newest first.
 *
 * Phase 2 has no pagination because typical libraries are 50-500 entries —
 * within virtualization-safe range. If a user reports 5k+ entries, the
 * Phase 4 search/filter rework is the right place to introduce server-side
 * paging (the current shape is a strict subset of any future paginated API).
 */
export async function listGames(): Promise<Game[]> {
  return invoke<Game[]>("list_games");
}

/**
 * Fetch a single game by id. Returns `null` when no row matches.
 *
 * The Detail page used to call `listGames()` then `.find()`, which pulled the
 * full library on every mutation (status / rating / favorite / notes / etc.)
 * — see BL-02 in the 260524 review. `getGame` issues one bound query and
 * the caller is expected to upsert the result into the library store so
 * subsequent navigation back to /library reflects the change without a
 * second round-trip.
 */
export async function getGame(gameId: number): Promise<Game | null> {
  return invoke<Game | null>("get_game", { gameId });
}

// ── Phase 4 / 04b: per-game property updates ─────────────────────────────────
//
// Each helper wraps a dedicated `update_game_*` Tauri command that issues a
// single targeted UPDATE on the `games` row + bumps `updated_at`. Mutations
// here are NOT optimistically applied to the Zustand store — callers should
// re-fetch via `searchGames()` / `listGames()` (and `getSidebarCategories()`
// when status/favorite/brand/year change, since those affect sidebar counts)
// after a successful command, matching the source-of-truth rule documented
// in `src/store/library.ts`.

/**
 * Set a game's status. Backend enforces the 4-value enum and returns a
 * precise `String` error for invalid input (the games.status CHECK
 * constraint is also a backstop).
 */
export async function updateGameStatus(
  gameId: number,
  status: "unplayed" | "playing" | "cleared" | "dropped",
): Promise<void> {
  await invoke("update_game_status", { gameId, status });
}

/**
 * Toggle the favorite flag. Backend stores INTEGER 0/1; the wire arg is a
 * real JS boolean (Rust `serde` deserializes it as `bool`).
 */
export async function updateGameFavorite(gameId: number, favorite: boolean): Promise<void> {
  await invoke("update_game_favorite", { gameId, isFavorite: favorite });
}

/**
 * Set or clear the free-form notes column. Pass `null` to clear; pass the
 * empty string to keep an empty-but-present value (backend writes both
 * faithfully — only `null` becomes SQL NULL).
 */
export async function updateGameNotes(gameId: number, notes: string | null): Promise<void> {
  await invoke("update_game_notes", { gameId, notes });
}

/**
 * Atomically update `brand` + `release_year` together. Each arg is
 * independently nullable; passing `null` for either CLEARS that column
 * (overwrite-with-NULL semantics — matches what the Phase-4 metadata
 * refresh pipeline needs when the source returns no brand).
 */
export async function updateGameBrandYear(
  gameId: number,
  brand: string | null,
  releaseYear: number | null,
): Promise<void> {
  await invoke("update_game_brand_year", { gameId, brand, releaseYear });
}

/**
 * Open a filesystem path in the OS file manager (Windows Explorer).
 * Wraps the `open_in_explorer` Tauri command added for the Detail page's
 * 更多 ▸ 打开本地目录 entry. Errors propagate as toast-friendly Chinese
 * strings ("路径不存在...", "无法打开 Explorer...").
 */
export async function openGameDir(path: string): Promise<void> {
  await invoke("open_in_explorer", { path });
}

/**
 * Phase 14 (FS-01) — canonical wrapper for the `open_path` IPC. Backed by
 * `tauri-plugin-opener` so file managers / browsers / shell handlers all
 * route through the platform's permission-gated API. Prefer this over
 * `openGameDir` for new callsites.
 */
export async function openPath(path: string): Promise<void> {
  await invoke("open_path", { path });
}

/**
 * Quick 260517-qnn — remove a game from the library.
 *
 * Deletes the database record for `gameId` (the `games` row plus every child
 * row that references it — sessions / screenshots / save_backups / game_tags /
 * game_staff / game_official_tags / custom_view_games / scan_review_queue).
 *
 * L9N-02 — additionally writes a hidden `.gal-lib-removed` marker file into the
 * game's on-disk folder so the next scan SKIPS that directory instead of
 * silently re-adding the game the user just deleted. The game files themselves
 * are NOT touched; the marker is reversible via the Scan page『已删除条目』
 * section (`restoreRemovedDir`). Throws "游戏不存在" if no row matched the id.
 */
export async function deleteGame(gameId: number): Promise<void> {
  await invoke("delete_game", { gameId });
}
