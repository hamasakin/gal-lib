/**
 * TagManager — Settings page section for tag CRUD.
 *
 * Phase 4 / 04f §Settings Page Polish (TAG-01) — gives users a full-CRUD
 * surface for the tag library:
 *   - List existing tags with inline-edit (name + color)
 *   - Create new tags via "添加标签" button (opens an inline draft row)
 *   - Save edits (name + color) — backend `update_tag` validates non-empty
 *     name and UNIQUE constraint
 *   - Delete with confirmation AlertDialog (cascade-delete via DB schema, so
 *     associated game_tags rows are automatically removed)
 *
 * Color palette — 8 preset Tailwind-named hues per 04-CONTEXT decision:
 *   slate / blue / emerald / amber / rose / violet / orange / pink
 *
 * Stored as a HEX string in the DB (`tags.color` is TEXT; null = unspecified).
 * The 8 hex values below match Tailwind v3 `*-500` shades, picked so the
 * sidebar dot-indicator + Detail tag chips render with consistent visual
 * weight. Users cannot enter arbitrary hex — restricting to the preset set
 * keeps the UI predictable across light/dark themes (Phase 5) and avoids
 * accessibility-contrast headaches.
 *
 * State-flow — source-of-truth rule:
 *   - `listTags()` reads from SQLite on mount
 *   - After every mutation (create/update/delete) we re-fetch `listTags()`
 *     and push into `useLibraryStore.tags` so the sidebar (which subscribes
 *     to that slice) reflects the new state without a manual refresh
 *   - We do NOT optimistically mutate the store — same convention as the
 *     scan_roots flow in Settings.tsx
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Trash2, Pencil, Plus, Check, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import {
  createTag,
  deleteTag,
  listTags,
  updateTag,
  type Tag,
} from "@/lib/tags";
import { useLibraryStore } from "@/store/library";

/**
 * 8 preset Tailwind-named hues (v3 *-500 shade). Order is deliberate —
 * neutral first (slate), warm/cool alternating, with the "decorative" hues
 * (violet/orange/pink) trailing so the picker reads left-to-right as
 * "default → expressive".
 */
const PRESET_COLORS: ReadonlyArray<{ name: string; hex: string }> = [
  { name: "slate", hex: "#64748b" },
  { name: "blue", hex: "#3b82f6" },
  { name: "emerald", hex: "#10b981" },
  { name: "amber", hex: "#f59e0b" },
  { name: "rose", hex: "#f43f5e" },
  { name: "violet", hex: "#8b5cf6" },
  { name: "orange", hex: "#f97316" },
  { name: "pink", hex: "#ec4899" },
] as const;

/** Default color for newly-created tags (matches the first preset). */
const DEFAULT_COLOR = PRESET_COLORS[0].hex;

/**
 * Local edit state for a single row. `id === null` means "draft new tag";
 * any other id maps to an existing row being edited inline.
 */
interface EditState {
  id: number | null;
  name: string;
  color: string;
}

/**
 * Color swatch picker — 8 round buttons, the active one ringed. Stateless;
 * parent owns the selected value.
 */
function ColorSwatchPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (hex: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-1.5" role="radiogroup" aria-label={t("tag_manager.color_aria")}>
      {PRESET_COLORS.map((c) => {
        const active = c.hex.toLowerCase() === value.toLowerCase();
        return (
          <button
            key={c.hex}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={c.name}
            onClick={() => onChange(c.hex)}
            className={cn(
              "size-5 rounded-full border border-border transition-all",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active && "ring-2 ring-ring ring-offset-2 ring-offset-background",
            )}
            style={{ backgroundColor: c.hex }}
          />
        );
      })}
    </div>
  );
}

export function TagManager() {
  const { t } = useTranslation();
  const tags = useLibraryStore((s) => s.tags);
  const setTags = useLibraryStore((s) => s.setTags);

  /** Currently-editing row, or `null` when nothing is in edit mode. */
  const [editing, setEditing] = useState<EditState | null>(null);
  /** Tag pending delete confirmation, or `null` when no dialog is open. */
  const [pendingDelete, setPendingDelete] = useState<Tag | null>(null);
  const [busy, setBusy] = useState(false);

  // Initial load — refresh tags so the section shows DB truth on mount even
  // if the user opens Settings before any tag invocation has populated the
  // store cache.
  useEffect(() => {
    listTags()
      .then(setTags)
      .catch((e: unknown) => {
        // eslint-disable-next-line no-console
        console.error("[TagManager] listTags failed:", e);
      });
  }, [setTags]);

  /** Refresh `useLibraryStore.tags` from DB (post-mutation reconcile). */
  async function refresh() {
    try {
      const fresh = await listTags();
      setTags(fresh);
    } catch (e: unknown) {
      toast.error(t("toast.tag_refresh_failed", { err: String(e) }));
    }
  }

  function startEdit(tag: Tag) {
    setEditing({
      id: tag.id,
      name: tag.name,
      color: tag.color ?? DEFAULT_COLOR,
    });
  }

  function startCreate() {
    setEditing({ id: null, name: "", color: DEFAULT_COLOR });
  }

  function cancelEdit() {
    setEditing(null);
  }

  async function commitEdit() {
    if (!editing) return;
    const name = editing.name.trim();
    if (name.length === 0) {
      toast.error(t("toast.tag_empty_name"));
      return;
    }
    setBusy(true);
    try {
      if (editing.id === null) {
        await createTag(name, editing.color);
      } else {
        await updateTag(editing.id, name, editing.color);
      }
      await refresh();
      setEditing(null);
    } catch (e: unknown) {
      toast.error(t("toast.save_failed", { err: String(e) }));
    } finally {
      setBusy(false);
    }
  }

  async function commitDelete() {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      await deleteTag(pendingDelete.id);
      await refresh();
      setPendingDelete(null);
    } catch (e: unknown) {
      toast.error(t("toast.delete_failed", { err: String(e) }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-foreground">{t("tag_manager.title")}</h2>
        <p className="text-body text-muted-foreground">
          {t("tag_manager.lede")}
        </p>
      </div>

      <ul className="space-y-2">
        {tags.map((tag) => {
          const isEditingThis = editing?.id === tag.id;
          if (isEditingThis && editing) {
            return (
              <li
                key={tag.id}
                className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card p-3"
              >
                <Input
                  autoFocus
                  value={editing.name}
                  onChange={(e) =>
                    setEditing({ ...editing, name: e.currentTarget.value })
                  }
                  className="w-48"
                  placeholder={t("tag_manager.placeholder_name")}
                  disabled={busy}
                />
                <ColorSwatchPicker
                  value={editing.color}
                  onChange={(hex) => setEditing({ ...editing, color: hex })}
                />
                <div className="ml-auto flex items-center gap-1">
                  <Button
                    size="sm"
                    onClick={() => void commitEdit()}
                    disabled={busy}
                  >
                    <Check className="size-4" aria-hidden />
                    {t("tag_manager.save")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={cancelEdit}
                    disabled={busy}
                    aria-label={t("common.cancel")}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              </li>
            );
          }
          return (
            <li
              key={tag.id}
              className="flex items-center gap-3 rounded-md border border-border bg-card p-3"
            >
              <span
                aria-hidden
                className="inline-block size-3 rounded-full"
                style={{ backgroundColor: tag.color ?? DEFAULT_COLOR }}
              />
              <span className="flex-1 truncate text-body text-foreground">
                {tag.name}
              </span>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => startEdit(tag)}
                disabled={busy || editing !== null}
                aria-label={t("common.edit")}
              >
                <Pencil className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="hover:text-destructive"
                onClick={() => setPendingDelete(tag)}
                disabled={busy || editing !== null}
                aria-label={t("common.delete")}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          );
        })}

        {/* Inline draft row for the "create new" flow. */}
        {editing?.id === null && (
          <li className="flex flex-wrap items-center gap-3 rounded-md border border-dashed border-border bg-card p-3">
            <Input
              autoFocus
              value={editing.name}
              onChange={(e) =>
                setEditing({ ...editing, name: e.currentTarget.value })
              }
              className="w-48"
              placeholder="标签名"
              disabled={busy}
            />
            <ColorSwatchPicker
              value={editing.color}
              onChange={(hex) => setEditing({ ...editing, color: hex })}
            />
            <div className="ml-auto flex items-center gap-1">
              <Button
                size="sm"
                onClick={() => void commitEdit()}
                disabled={busy}
              >
                <Check className="size-4" aria-hidden />
                保存
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={cancelEdit}
                disabled={busy}
                aria-label="取消"
              >
                <X className="size-4" />
              </Button>
            </div>
          </li>
        )}

        {tags.length === 0 && editing === null && (
          <li className="rounded-md border border-dashed border-border p-6 text-center text-body text-muted-foreground">
            {t("tag_manager.empty")}
          </li>
        )}
      </ul>

      <Button
        variant="secondary"
        onClick={startCreate}
        disabled={editing !== null || busy}
      >
        <Plus className="size-4" aria-hidden />
        {t("tag_manager.add")}
      </Button>

      {/* Delete confirmation dialog — open is driven by `pendingDelete`. */}
      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => {
          if (!o) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingDelete
                ? t("tag_manager.delete_title_with_name", { name: pendingDelete.name })
                : t("tag_manager.delete_title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("tag_manager.delete_desc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void commitDelete();
              }}
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
