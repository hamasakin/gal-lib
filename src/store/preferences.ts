import { create } from "zustand";
import {
  applyPreferences,
  DEFAULT_PREFS,
  loadPreferences,
  savePreferences,
  type Accent,
  type Density,
  type Preferences,
  type Radius,
  type SidebarWidth,
  type SupportedLng,
  type Theme,
  type ViewMode,
} from "@/lib/preferences";
import i18n from "@/i18n";

interface PreferencesStore extends Preferences {
  setTheme: (v: Theme) => void;
  setAccent: (v: Accent) => void;
  setRadius: (v: Radius) => void;
  setSidebar: (v: SidebarWidth) => void;
  setDensity: (v: Density) => void;
  setViewMode: (v: ViewMode) => void;
  setAutoCheckUpdate: (v: boolean) => void;
  /** Quick 260524-olt — 切换界面语言：同时写 prefs 与 i18n.changeLanguage。 */
  setLanguage: (v: SupportedLng) => void;
  reset: () => void;
}

const initial = loadPreferences();

const update = (
  patch: Partial<Preferences>,
  set: (state: Partial<PreferencesStore>) => void,
  get: () => PreferencesStore,
) => {
  set(patch);
  const next: Preferences = {
    theme: get().theme,
    accent: get().accent,
    radius: get().radius,
    sidebar: get().sidebar,
    density: get().density,
    viewMode: get().viewMode,
    autoCheckUpdate: get().autoCheckUpdate,
    language: get().language,
  };
  applyPreferences(next);
  savePreferences(next);
  // Quick 260524-olt — 同步 i18n。如果 next.language 与 i18n.language 已相同
  // 则 i18next 内部会 no-op，不重复触发 changeLanguage 事件。
  if (i18n.language !== next.language) {
    void i18n.changeLanguage(next.language);
  }
};

export const usePreferencesStore = create<PreferencesStore>((set, get) => ({
  ...initial,
  setTheme: (theme) => update({ theme }, set, get),
  setAccent: (accent) => update({ accent }, set, get),
  setRadius: (radius) => update({ radius }, set, get),
  setSidebar: (sidebar) => update({ sidebar }, set, get),
  setDensity: (density) => update({ density }, set, get),
  setViewMode: (viewMode) => update({ viewMode }, set, get),
  setAutoCheckUpdate: (autoCheckUpdate) =>
    update({ autoCheckUpdate }, set, get),
  setLanguage: (language) => update({ language }, set, get),
  reset: () => update({ ...DEFAULT_PREFS }, set, get),
}));

export type { SupportedLng } from "@/lib/preferences";
