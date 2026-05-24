import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";

let dbPromise: Promise<Database> | null = null;

/**
 * Resolve the portable data dir (e.g. `C:/.../data` or
 * `.../target/debug/data` in dev) by calling the Rust `get_data_dir` command.
 * Path returned uses the OS-native separator; convert to forward slashes
 * before passing to sqlx via `Database.load`.
 */
export async function getDataDir(): Promise<string> {
  return invoke<string>("get_data_dir");
}

/**
 * Lazy singleton accessor for the SQLite connection.
 * First call: invokes `get_data_dir`, builds `sqlite:<abs>/app.db` URL,
 * and triggers tauri-plugin-sql to open the connection (which also runs
 * pending migrations on first open).
 *
 * WR-02 fix: previous version cached the rejected Promise forever — once
 * `Database.load` failed (e.g. transient permission glitch, plugin not
 * ready yet at very early app start), every subsequent `getDb()` returned
 * the cached rejection without retrying. Now we attach a `.catch` that
 * clears `dbPromise` so the next caller gets a fresh attempt.
 */
export function getDb(): Promise<Database> {
  if (!dbPromise) {
    const pending = (async () => {
      const dataDir = await getDataDir();
      const url = `sqlite:${dataDir.replace(/\\/g, "/")}/app.db`;
      return Database.load(url);
    })();
    // Side-channel error handler — does NOT replace the consumer's rejection.
    // The next get() after a failed init sees `dbPromise === null` and
    // re-attempts the load.
    pending.catch(() => {
      if (dbPromise === pending) {
        dbPromise = null;
      }
    });
    dbPromise = pending;
  }
  return dbPromise;
}
