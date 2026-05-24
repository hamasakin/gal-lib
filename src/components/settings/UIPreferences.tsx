/**
 * UIPreferences — Settings page section for UI-only preferences.
 *
 * Phase 4 / 04f §Settings Page Polish (LIB-07) — exposes two knobs:
 *   1. 默认排序 — picks which `SortBy` the library grid uses on app boot.
 *      Persisted to localStorage under `gal-lib:default-sort`. Phase 5 may
 *      promote this to backend-side `config.json` (alongside `le_path` and
 *      friends); the localStorage key is the simplest cross-route
 *      persistence layer we have today, and the value space is small (a
 *      single SortBy string), so we don't need IndexedDB or a Tauri command.
 *   2. 界面语言 — Quick 260524-olt 新增。复用 `usePreferencesStore.language`
 *      持久化进 localStorage 的 `gal-lib:prefs` blob，切换时同步
 *      `i18n.changeLanguage(lang)` 触发所有 useTranslation() 订阅者刷新。
 *
 * Reading the saved sort:
 *   - On app boot, the library route should call `loadDefaultSort()` once
 *     and seed `useLibraryStore.sortBy` with the result. We do NOT do that
 *     here because this component is owned by /settings and shouldn't
 *     reach across into the boot sequence — exposing a pure helper keeps
 *     the dependency direction clean.
 *
 * Locked copy (04f plan Critical guardrails):
 *   原「UI 偏好」标题 + 「默认排序」行 i18n 后改由 t() 提供，Locked copy
 *   契约从字面值转为 i18n key 路径，见 src/locales/*\/translation.json:
 *     settings.ui_section_title / settings.default_sort_label /
 *     settings.language_label / settings.sort.* / lang.*
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SortBy } from "@/lib/search";
import { SUPPORTED_LNGS, type SupportedLng } from "@/lib/preferences";
import { usePreferencesStore } from "@/store/preferences";

/** localStorage key for the default sort preference. */
export const DEFAULT_SORT_STORAGE_KEY = "gal-lib:default-sort";

/**
 * Sort options — value 是写库的 `SortBy` enum,label 用 t() 在组件内解析。
 * 这里只保留稳定的 value + i18nKey 配对,与 `src/components/library/SortSelect.tsx`
 * 同 enum、同 key 命名空间(已经在 zh/ja/en 三套 translation.json 里维护)。
 */
const SORT_OPTIONS: ReadonlyArray<{ value: SortBy; i18nKey: string }> = [
  { value: "last_played", i18nKey: "settings.sort.last_played" },
  { value: "created_at", i18nKey: "settings.sort.created_at" },
  { value: "name", i18nKey: "settings.sort.name" },
  { value: "playtime", i18nKey: "settings.sort.playtime" },
  { value: "rating", i18nKey: "settings.sort.rating" },
] as const;

/** Whitelist of valid SortBy values for storage validation. */
const VALID_SORTS = new Set<SortBy>(SORT_OPTIONS.map((o) => o.value));

/**
 * Read the persisted default sort from localStorage. Returns `null` if no
 * value is stored OR the stored value is not in the SortBy whitelist
 * (defensive — a corrupt write or a future schema change should not crash
 * the boot path; callers should fall back to the store's compile-time
 * default of `last_played`).
 *
 * Exported so the Library route can seed `useLibraryStore.sortBy` on boot.
 */
export function loadDefaultSort(): SortBy | null {
  try {
    const raw = window.localStorage.getItem(DEFAULT_SORT_STORAGE_KEY);
    if (raw === null) return null;
    if (VALID_SORTS.has(raw as SortBy)) return raw as SortBy;
    return null;
  } catch {
    // Privacy-mode browsers may throw on localStorage access. Silently
    // ignore — the in-memory default still applies.
    return null;
  }
}

/** Write a SortBy choice to localStorage. Errors are swallowed (private mode). */
function saveDefaultSort(sort: SortBy): void {
  try {
    window.localStorage.setItem(DEFAULT_SORT_STORAGE_KEY, sort);
  } catch {
    // ignore
  }
}

export function UIPreferences() {
  const { t } = useTranslation();
  const language = usePreferencesStore((s) => s.language);
  const setLanguage = usePreferencesStore((s) => s.setLanguage);
  const [defaultSort, setDefaultSort] = useState<SortBy>("last_played");

  // Hydrate from localStorage on mount. We avoid `useState(() => loadDefaultSort())`
  // because the persisted value is also re-used by the Library boot path —
  // keeping the read in `useEffect` makes the side-effect explicit and SSR-safe
  // (Tauri renders client-side, but the discipline costs nothing).
  useEffect(() => {
    const persisted = loadDefaultSort();
    if (persisted !== null) {
      setDefaultSort(persisted);
    }
  }, []);

  function onChange(next: string) {
    const value = next as SortBy;
    setDefaultSort(value);
    saveDefaultSort(value);
  }

  return (
    <section className="space-y-4">
      <h2 className="text-base font-semibold text-foreground">
        {t("settings.ui_section_title")}
      </h2>

      {/* Row 1 — default sort. */}
      <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-card p-3">
        <span className="text-body text-foreground">
          {t("settings.default_sort_label")}
        </span>
        <Select value={defaultSort} onValueChange={onChange}>
          <SelectTrigger className="w-40" aria-label={t("settings.default_sort_label")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {t(opt.i18nKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Row 2 — interface language (Quick 260524-olt). */}
      <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-card p-3">
        <span className="text-body text-foreground">
          {t("settings.language_label")}
        </span>
        <Select
          value={language}
          onValueChange={(v) => setLanguage(v as SupportedLng)}
        >
          <SelectTrigger className="w-40" aria-label={t("settings.language_label")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SUPPORTED_LNGS.map((lng) => (
              <SelectItem key={lng} value={lng}>
                {t(`lang.${lng}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </section>
  );
}
