/**
 * v1.1 — 5-axis design preferences (theme/accent/radius/sidebar/density).
 *
 * Persisted to localStorage under `gal-lib:prefs` as a single JSON blob.
 * Applied to <html> via data-* attributes which the CSS variable system reads.
 */

export type Theme = "midnight" | "papyrus" | "ink";
export type Accent = "violet" | "teal" | "sakura" | "matcha";
export type Radius = "sharp" | "soft";
export type SidebarWidth = "narrow" | "regular" | "wide";
export type Density = "small" | "medium" | "large";

export interface Preferences {
  theme: Theme;
  accent: Accent;
  radius: Radius;
  sidebar: SidebarWidth;
  density: Density;
}

export const DEFAULT_PREFS: Preferences = {
  theme: "midnight",
  accent: "violet",
  radius: "sharp",
  sidebar: "regular",
  density: "medium",
};

export const THEMES: Theme[] = ["midnight", "papyrus", "ink"];
export const ACCENTS: Accent[] = ["violet", "teal", "sakura", "matcha"];
export const RADII: Radius[] = ["sharp", "soft"];
export const SIDEBAR_WIDTHS: SidebarWidth[] = ["narrow", "regular", "wide"];
export const DENSITIES: Density[] = ["small", "medium", "large"];

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
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePreferences(prefs: Preferences): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* quota exceeded / private mode — silently degrade */
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
}
