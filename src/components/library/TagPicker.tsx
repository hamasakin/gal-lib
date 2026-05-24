/**
 * TagPicker — multi-select tag picker built from shadcn `popover` + `command`.
 *
 * Phase 4 / 04e § Detail Page §标签 Tab — replaces the read-only tag chip
 * list (Phase 1 placeholder) with a fully editable picker that supports:
 *   - Searching the existing tag set (case-insensitive substring match,
 *     handled internally by `cmdk`'s default filter)
 *   - Toggling tags on/off via Command items
 *   - Creating brand-new tags inline ("创建新标签 '<query>'") when the
 *     search query has no exact-name match
 *
 * Editing model — staged commit:
 *   - Selected ids are tracked in local state while the popover is open.
 *   - Closing the popover (or clicking the explicit "保存" item) commits
 *     the diff via `setGameTags(gameId, ids)`. This avoids one round-trip
 *     per checkbox toggle and keeps the UI snappy on slow disks.
 *   - On commit success, we call `onChange?.()` so the parent (Detail page)
 *     can re-fetch `listGameTags(gameId)` + sidebar counts. Mutation refetch
 *     follows the same source-of-truth-is-DB rule as the rest of the
 *     library store (no optimistic state).
 *
 * Tag creation:
 *   - When `searchQuery` is non-empty AND no tag's exact name (lowercased,
 *     trimmed) matches, we render a "创建新标签 'X'" CommandItem.
 *   - Selecting it calls `createTag(query, null)` then immediately wires the
 *     new id into the staged selection set. The underlying `listTags()` is
 *     refreshed via the parent's `onChange?.()` after the popover commit.
 *
 * Selected-chip preview:
 *   - The trigger button face shows the count of selected tags ("标签 (N)")
 *     OR a "添加标签" placeholder when zero.
 *   - The chips themselves are NOT rendered by this component; the parent
 *     Detail page renders them above the trigger so we don't duplicate
 *     the chip layout twice (once in the trigger, once in the tab body).
 *
 * Accessibility:
 *   - The `Popover` provides focus management for the trigger.
 *   - `cmdk` provides keyboard navigation (arrow keys / Enter / Esc).
 *   - Each CommandItem gets a `data-checked` toggle so the shared CheckIcon
 *     in `command.tsx` flips visibility based on staged-selection state.
 */

import { useEffect, useMemo, useState } from "react";
import { Plus, Tag as TagIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { setGameTags, createTag, type Tag } from "@/lib/tags";
import { cn } from "@/lib/utils";

interface TagPickerProps {
  gameId: number;
  /** All tags currently known (from `useLibraryStore.tags` cache). */
  allTags: Tag[];
  /** Subset of `allTags` currently attached to this game. */
  selectedTags: Tag[];
  /**
   * Notify the parent that a save just succeeded and a refetch is needed.
   * Parent should invoke `listTags()` (in case a new tag was created) AND
   * `listGameTags(gameId)` (for the per-game tag chip set) AND
   * `getSidebarCategories()` (for sidebar tag counts).
   */
  onChange?: () => void;
  className?: string;
}

export function TagPicker({
  gameId,
  allTags,
  selectedTags,
  onChange,
  className,
}: TagPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [stagedIds, setStagedIds] = useState<Set<number>>(
    () => new Set(selectedTags.map((t) => t.id)),
  );
  const [saving, setSaving] = useState(false);

  // Re-sync staged selection when the popover opens OR when the parent's
  // `selectedTags` prop changes (e.g. after another save round-trip).
  useEffect(() => {
    if (open) {
      setStagedIds(new Set(selectedTags.map((t) => t.id)));
      setSearch("");
    }
  }, [open, selectedTags]);

  // Compute whether the current search query matches an existing tag's
  // exact (case-insensitive, trimmed) name. When it does NOT, we offer the
  // "创建新标签 '<query>'" item below the regular list.
  const trimmedSearch = search.trim();
  const exactMatch = useMemo(() => {
    if (trimmedSearch.length === 0) return true; // hide create option
    const lower = trimmedSearch.toLowerCase();
    return allTags.some((t) => t.name.toLowerCase() === lower);
  }, [trimmedSearch, allTags]);

  function toggleTag(id: number) {
    setStagedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function commitChanges() {
    setSaving(true);
    try {
      const ids = Array.from(stagedIds);
      await setGameTags(gameId, ids);
      onChange?.();
    } catch (err: unknown) {
      toast.error(`保存标签失败 — ${String(err)}`);
    } finally {
      setSaving(false);
    }
  }

  async function createAndSelect() {
    if (trimmedSearch.length === 0) return;
    setSaving(true);
    try {
      const newId = await createTag(trimmedSearch, null);
      // CR-02 fix: read the latest staged ids INSIDE the functional
      // updater so any toggles the user fired while `createTag` was in
      // flight are included in the persisted set. The previous code read
      // `stagedIds` from the closure (the render snapshot at function
      // entry), so any concurrent toggle was lost on the immediate save.
      // Strict-mode double-invocation is safe here: the updater is
      // idempotent (re-adding newId to the set yields the same set) and
      // the snapshot captured on the second call is identical to the first.
      let snapshot: number[] = [];
      setStagedIds((prev) => {
        const next = new Set(prev);
        next.add(newId);
        snapshot = Array.from(next);
        return next;
      });
      // Immediately persist so the user sees the new tag in the chip row
      // even if they close the popover via Esc without an explicit save.
      await setGameTags(gameId, snapshot);
      setSearch("");
      onChange?.();
    } catch (err: unknown) {
      toast.error(`创建标签失败 — ${String(err)}`);
    } finally {
      setSaving(false);
    }
  }

  // When the popover transitions open → closed, commit the staged diff
  // (skip when there's no actual change to avoid a no-op invoke).
  function handleOpenChange(next: boolean) {
    if (open && !next) {
      const before = new Set(selectedTags.map((t) => t.id));
      const same =
        before.size === stagedIds.size &&
        Array.from(before).every((id) => stagedIds.has(id));
      if (!same) {
        void commitChanges();
      }
    }
    setOpen(next);
  }

  const triggerLabel =
    selectedTags.length === 0
      ? "添加标签"
      : `标签 (${selectedTags.length})`;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn("gap-1.5", className)}
          aria-expanded={open}
          disabled={saving}
        >
          <TagIcon className="size-3.5" aria-hidden />
          <span>{triggerLabel}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput
            value={search}
            onValueChange={setSearch}
            placeholder="搜索或创建标签..."
          />
          <CommandList>
            <CommandEmpty>暂无匹配的标签</CommandEmpty>
            {allTags.length > 0 && (
              <CommandGroup heading="现有标签">
                {allTags.map((tag) => {
                  const checked = stagedIds.has(tag.id);
                  return (
                    <CommandItem
                      key={tag.id}
                      value={tag.name}
                      data-checked={checked}
                      onSelect={() => toggleTag(tag.id)}
                    >
                      {tag.color && (
                        <span
                          aria-hidden
                          className="inline-block size-2 rounded-full"
                          style={{ backgroundColor: tag.color }}
                        />
                      )}
                      <span>{tag.name}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
            {!exactMatch && trimmedSearch.length > 0 && (
              <>
                {allTags.length > 0 && <CommandSeparator />}
                <CommandGroup>
                  <CommandItem
                    value={`__create__${trimmedSearch}`}
                    onSelect={() => void createAndSelect()}
                  >
                    <Plus className="size-3.5" aria-hidden />
                    <span>创建新标签 “{trimmedSearch}”</span>
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
