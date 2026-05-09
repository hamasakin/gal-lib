/**
 * Persons route — `/persons/:id`.
 *
 * Aggregate page for a single person across the library: fetches their
 * participation per role (4 parallel calls — `listGamesForPerson(id, role)`
 * for scenario / artist / voice / music) and renders 4 sections, each a
 * GameCard grid of the games that person worked on in that role.
 *
 * Person identity (name + name_cn + source) is derived from the first non-
 * empty role's first game by calling `listPersonsForGame(gameId)` and
 * looking up the matching `person_id`. There is no `getPersonById` IPC —
 * the join is the cheapest way to read the canonical name.
 *
 * Voice-role rows additionally carry a `character_name` caption beneath
 * the GameCard, looked up from the same `listPersonsForGame` payload.
 *
 * Layout pattern matches `Stats.tsx` / `Screenshots.tsx`:
 *   <PageHeader> + body grid in a single overflow-auto wrapper.
 */

import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { PageHeader } from "@/components/library/PageHeader";
import { GameCard } from "@/components/library/GameCard";
import {
  listGamesForPerson,
  listPersonsForGame,
  type GameStaffRow,
  type StaffRole,
} from "@/lib/persons";
import type { Game } from "@/lib/games";
import { useLibraryStore } from "@/store/library";
import { listGames } from "@/lib/games";

const ROLE_ORDER: StaffRole[] = ["scenario", "artist", "voice", "music"];

const ROLE_LABELS: Record<StaffRole, string> = {
  scenario: "编剧 / 剧本",
  artist: "原画 / 画师",
  voice: "声优",
  music: "音乐",
};

interface PersonIdentity {
  name: string;
  name_cn: string | null;
  source: "bangumi" | "vndb";
}

export default function Persons() {
  const { id } = useParams<{ id: string }>();
  const personId = Number(id);

  const games = useLibraryStore((s) => s.games);
  const setGames = useLibraryStore((s) => s.setGames);

  const [dataDir, setDataDir] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [byRole, setByRole] = useState<Record<StaffRole, Game[]>>({
    scenario: [],
    artist: [],
    voice: [],
    music: [],
  });
  const [identity, setIdentity] = useState<PersonIdentity | null>(null);
  /**
   * Voice-role character lookup: `{ [gameId]: characterName }`. Built from
   * the same `listPersonsForGame` call we already issue to derive identity
   * — for every game that this person has a `voice` row in, we capture
   * `character_name` so the GameCard caption can show it.
   */
  const [voiceCharByGame, setVoiceCharByGame] = useState<Record<number, string>>(
    {},
  );

  useEffect(() => {
    invoke<string>("get_data_dir").then(setDataDir).catch(() => {});
  }, []);

  // Hydrate the cached games[] for context-menu / favorite mutations on
  // GameCard (mirrors Stats / Screenshots — route can be hit directly).
  useEffect(() => {
    if (games.length === 0) {
      void listGames()
        .then(setGames)
        .catch((e: unknown) => {
          // eslint-disable-next-line no-console
          console.error("[Persons] hydrate games failed:", e);
        });
    }
  }, [games.length, setGames]);

  // ── main fetch: 4 role-scoped calls in parallel + identity derivation ────
  useEffect(() => {
    if (!Number.isFinite(personId)) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [scenario, artist, voice, music] = await Promise.all([
          listGamesForPerson(personId, "scenario"),
          listGamesForPerson(personId, "artist"),
          listGamesForPerson(personId, "voice"),
          listGamesForPerson(personId, "music"),
        ]);
        if (cancelled) return;
        setByRole({ scenario, artist, voice, music });

        // Identity: pick the first game across all roles, look up the
        // matching person_id row in its persons list. Defensive fallback
        // to "未知人物" if no match.
        const firstGame =
          scenario[0] ?? artist[0] ?? voice[0] ?? music[0] ?? null;
        if (firstGame) {
          try {
            const persons = await listPersonsForGame(firstGame.id);
            if (cancelled) return;
            const me = persons.find((p) => p.person_id === personId);
            if (me) {
              setIdentity({
                name: me.name,
                name_cn: me.name_cn,
                source: me.source,
              });
            } else {
              setIdentity({ name: "未知人物", name_cn: null, source: "bangumi" });
            }
          } catch {
            if (!cancelled) {
              setIdentity({ name: "未知人物", name_cn: null, source: "bangumi" });
            }
          }
        } else {
          setIdentity(null);
        }

        // Voice character-name lookup: only if there are voice games. One
        // listPersonsForGame call per voice game — typically a small list
        // (the # of games where this seiyuu performed), so the N is small.
        if (voice.length > 0) {
          try {
            const charPairs = await Promise.all(
              voice.map(async (g) => {
                try {
                  const persons = await listPersonsForGame(g.id);
                  const v = persons.find(
                    (p) => p.person_id === personId && p.role === "voice",
                  );
                  return [g.id, v?.character_name ?? null] as const;
                } catch {
                  return [g.id, null] as const;
                }
              }),
            );
            if (cancelled) return;
            const map: Record<number, string> = {};
            for (const [gid, name] of charPairs) {
              if (name) map[gid] = name;
            }
            setVoiceCharByGame(map);
          } catch {
            if (!cancelled) setVoiceCharByGame({});
          }
        } else {
          setVoiceCharByGame({});
        }
      } catch (e: unknown) {
        // eslint-disable-next-line no-console
        console.error("[Persons] role fetch failed:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [personId]);

  const totalCount = useMemo(() => {
    const seen = new Set<number>();
    for (const role of ROLE_ORDER) {
      for (const g of byRole[role]) seen.add(g.id);
    }
    return seen.size;
  }, [byRole]);

  const resolveCover = useMemo(() => {
    return (game: Game): string | null => {
      if (game.cover_path && dataDir) {
        const abs = `${dataDir.replace(/\\/g, "/")}/${game.cover_path}`;
        return convertFileSrc(abs);
      }
      return game.cover_url ?? null;
    };
  }, [dataDir]);

  if (!Number.isFinite(personId)) {
    return (
      <div className="p-8 font-mono text-[12px] text-ink-2">无效的人物 id</div>
    );
  }

  const displayName = identity
    ? (identity.name_cn ?? identity.name)
    : loading
      ? "加载中…"
      : "未知人物";

  const nonEmptyRoles = ROLE_ORDER.filter((r) => byRole[r].length > 0);

  return (
    <div className="h-full overflow-auto">
      <PageHeader
        crumb="图书馆 / 人物"
        title={<>{displayName}</>}
        sub={
          identity
            ? `${identity.source.toUpperCase()} · 共参与 ${totalCount} 部作品`
            : loading
              ? "正在载入…"
              : "未参与任何作品"
        }
      />

      <div className="px-8 pb-16 pt-6">
        {loading ? (
          <p className="font-mono text-[12px] text-ink-3">加载中…</p>
        ) : nonEmptyRoles.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24">
            <p className="font-serif text-[20px] text-ink-1">未参与任何游戏</p>
            <p className="font-mono text-[11px] text-ink-3">
              该人物暂无关联作品
            </p>
          </div>
        ) : (
          nonEmptyRoles.map((role) => (
            <RoleSection
              key={role}
              role={role}
              games={byRole[role]}
              resolveCover={resolveCover}
              voiceCharByGame={role === "voice" ? voiceCharByGame : null}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ── Internals ────────────────────────────────────────────────────────────

interface RoleSectionProps {
  role: StaffRole;
  games: Game[];
  resolveCover: (g: Game) => string | null;
  /** Voice-only: maps gameId → character_name for the caption under the card. */
  voiceCharByGame: Record<number, string> | null;
}

function RoleSection({
  role,
  games,
  resolveCover,
  voiceCharByGame,
}: RoleSectionProps) {
  return (
    <section className="mb-12">
      <header className="mb-3.5 flex items-baseline justify-between border-b border-line pb-2">
        <div className="flex items-baseline gap-3.5">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-1">
            {ROLE_LABELS[role]}
          </span>
          <span className="font-mono text-[10.5px] text-ink-3">
            {games.length} 部
          </span>
        </div>
      </header>

      <div
        className="grid gap-x-[22px] gap-y-7"
        style={{
          gridTemplateColumns: "repeat(auto-fill, minmax(172px, 1fr))",
        }}
      >
        {games.map((g) => (
          <div key={g.id} className="flex flex-col">
            <GameCard
              game={g}
              coverDataUrl={resolveCover(g)}
              onPickMetadata={noopPickMetadata}
              onRefreshCover={noopRefreshCover}
            />
            {voiceCharByGame && voiceCharByGame[g.id] ? (
              <div className="mt-1 font-mono text-[10px] text-ink-3">
                饰 · {voiceCharByGame[g.id]}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

// GameCard requires onPickMetadata + onRefreshCover (Library re-binding /
// cover-refresh flows). On the Persons page these context-menu actions
// aren't meaningful — silently no-op rather than re-implementing the
// metadata-picker modal. The launch / favorite / status submenu paths
// don't depend on these.
function noopPickMetadata(_g: Game): void {
  // no-op
}
function noopRefreshCover(_g: Game): void {
  // no-op
}

// Suppress "declared but never used" for GameStaffRow re-export consumer.
void (null as unknown as GameStaffRow);
