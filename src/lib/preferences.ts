/**
 * v1.1 — 5-axis design preferences (theme/accent/radius/sidebar/density).
 *
 * Persisted to localStorage under `gal-lib:prefs` as a single JSON blob.
 * Applied to <html> via data-* attributes which the CSS variable system reads.
 */

export type Theme = "midnight" | "papyrus" | "ink";
export type Accent = "violet" | "teal" | "sakura" | "matcha";
export type Radius = "sharp" | "soft";
export type SidebarWidth = "icon" | "narrow" | "regular" | "wide";
export type ViewMode = "grid" | "list";
export type Density = "small" | "medium" | "large";
/**
 * Quick 260524-olt — UI 语言（i18next 用同名 lng）。
 * 注意：preferences.ts 不能 import i18n.ts(单向依赖)，因此此处独立定义类型。
 */
export type SupportedLng = "zh-CN" | "ja-JP" | "en-US";

export interface Preferences {
  theme: Theme;
  accent: Accent;
  radius: Radius;
  sidebar: SidebarWidth;
  density: Density;
  viewMode: ViewMode;
  /**
   * Quick 260514-upd — when true, App boot triggers a silent
   * `updater.check()` 5 s after launch. Errors swallowed.
   */
  autoCheckUpdate: boolean;
  /**
   * Quick 260524-olt — 界面语言，与 i18n.ts 的 lng 同步。
   * 默认 "zh-CN"；首次启动若 localStorage 为空，i18n.ts 的 detectInitialLng
   * 会进一步根据 navigator.language 选择更合适的语言（不写回 prefs）。
   */
  language: SupportedLng;
}

export const DEFAULT_PREFS: Preferences = {
  theme: "midnight",
  accent: "violet",
  radius: "sharp",
  sidebar: "regular",
  density: "medium",
  viewMode: "grid",
  autoCheckUpdate: true,
  language: "zh-CN",
};

export const THEMES: Theme[] = ["midnight", "papyrus", "ink"];
export const ACCENTS: Accent[] = ["violet", "teal", "sakura", "matcha"];
export const RADII: Radius[] = ["sharp", "soft"];
export const SIDEBAR_WIDTHS: SidebarWidth[] = [
  "icon",
  "narrow",
  "regular",
  "wide",
];
export const DENSITIES: Density[] = ["small", "medium", "large"];
export const VIEW_MODES: ViewMode[] = ["grid", "list"];
export const SUPPORTED_LNGS: SupportedLng[] = ["zh-CN", "ja-JP", "en-US"];

const STORAGE_KEY = "gal-lib:prefs";

const isTheme = (v: unknown): v is Theme =>
  typeof v === "string" && (THEMES as string[]).includes(v);
const isAccent = (v: unknown): v is Accent =>
  typeof v === "string" && (ACCENTS as string[]).includes(v);
const isRadius = (v: unknown): v is Radius =>
  typeof v === "string" && (RADII as string[]).includes(v);
const isSidebar = (v: unknown): v is SidebarWidth =>
  typeof v === "string" && (SIDEBAR_WIDTHS as string[]).includes(v);
const isDensity = (v: unknown): v is Density =>
  typeof v === "string" && (DENSITIES as string[]).includes(v);
const isViewMode = (v: unknown): v is ViewMode =>
  typeof v === "string" && (VIEW_MODES as string[]).includes(v);
const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const isLanguage = (v: unknown): v is SupportedLng =>
  typeof v === "string" && (SUPPORTED_LNGS as string[]).includes(v);

/** Read preferences from localStorage, validating each axis against its enum. */
export function loadPreferences(): Preferences {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<Record<keyof Preferences, unknown>>;
    return {
      theme: isTheme(parsed.theme) ? parsed.theme : DEFAULT_PREFS.theme,
      accent: isAccent(parsed.accent) ? parsed.accent : DEFAULT_PREFS.accent,
      radius: isRadius(parsed.radius) ? parsed.radius : DEFAULT_PREFS.radius,
      sidebar: isSidebar(parsed.sidebar)
        ? parsed.sidebar
        : DEFAULT_PREFS.sidebar,
      density: isDensity(parsed.density)
        ? parsed.density
        : DEFAULT_PREFS.density,
      viewMode: isViewMode(parsed.viewMode)
        ? parsed.viewMode
        : DEFAULT_PREFS.viewMode,
      autoCheckUpdate: isBool(parsed.autoCheckUpdate)
        ? parsed.autoCheckUpdate
        : DEFAULT_PREFS.autoCheckUpdate,
      language: isLanguage(parsed.language)
        ? parsed.language
        : DEFAULT_PREFS.language,
    };
  } catch (e: unknown) {
    // WR-04 fix: log the parse failure so a corrupted localStorage key
    // surfaces in the devtools console instead of silently reverting to
    // defaults. Still returns DEFAULT_PREFS — we don't want to crash on
    // bad persisted JSON, just make the failure visible to anyone tailing
    // logs.
    // eslint-disable-next-line no-console
    console.warn("[preferences] failed to parse persisted prefs:", e);
    return DEFAULT_PREFS;
  }
}

export function savePreferences(prefs: Preferences): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch (e: unknown) {
    // WR-04 fix: log quota / private-mode failures (was previously a
    // silent /* … */ swallow). The next app-launch still re-applies
    // DEFAULT_PREFS so the user isn't locked out, but the warn lets us
    // diagnose disappearing settings.
    // eslint-disable-next-line no-console
    console.warn("[preferences] savePreferences failed:", e);
  }
}

/** Mutate <html data-*> in-place. Cheap; safe to call on every state change. */
export function applyPreferences(prefs: Preferences): void {
  if (typeof document === "undefined") return;
  const r = document.documentElement;
  r.setAttribute("data-theme", prefs.theme);
  r.setAttribute("data-accent", prefs.accent);
  r.setAttribute("data-radius", prefs.radius);
  r.setAttribute("data-sidebar", prefs.sidebar);
  r.setAttribute("data-density", prefs.density);
  r.setAttribute("data-view", prefs.viewMode);
}
