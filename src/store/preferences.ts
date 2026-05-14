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
  type Theme,
  type ViewMode,
} from "@/lib/preferences";

interface PreferencesStore extends Preferences {
  setTheme: (v: Theme) => void;
  setAccent: (v: Accent) => void;
  setRadius: (v: Radius) => void;
  setSidebar: (v: SidebarWidth) => void;
  setDensity: (v: Density) => void;
  setViewMode: (v: ViewMode) => void;
  setAutoCheckUpdate: (v: boolean) => void;
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
  };
  applyPreferences(next);
  savePreferences(next);
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
  reset: () => update({ ...DEFAULT_PREFS }, set, get),
}));
