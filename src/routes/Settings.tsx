/**
 * Settings route ("/settings") — v1.1 redesign.
 *
 * Layout: 200px left nav + main content (max 720px).
 * Sections (anchored, smooth-scroll):
 *   1. 外观                       — points to Tweaks panel for axes
 *   2. 扫描根目录                 — list + depth + remove + add
 *   3. 添加单个游戏               — directory picker for ad-hoc add
 *   4. Locale Emulator           — bundled LE info + override picker
 *   5. 标签管理                   — TagManager component
 *   6. 扫描操作                   — scan
 *   7. UI 偏好                    — UIPreferences component
 *   8. 调试                       — clear-all-data
 *
 * Logic preserved from v1.0:
 *   - listScanRoots refresh after every CRUD
 *   - addGame toast.promise progress flow
 *   - LE path picker via openDialog filtered to .exe
 *   - clearAllData confirm + multi-source refetch
 *
 * Visual: 200px nav (sticky) + main column. Each section is a `setting-block`
 * with serif h2 + mono lede + path-row / setting rows. nav active state
 * driven by scroll-spy via IntersectionObserver.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  addGame,
  addScanRoot,
  clearAllData,
  listScanRoots,
  refreshMetadataSmart,
  removeScanRoot,
  updateScanRootDepth,
  startScan,
} from "@/lib/scan";
import { getSidebarCategories, searchGames } from "@/lib/search";
import { getLePath, setLePath as applyLePath } from "@/lib/launch";
import { useLibraryStore } from "@/store/library";
import { TagManager } from "@/components/settings/TagManager";
import { UIPreferences } from "@/components/settings/UIPreferences";
import { AboutSection } from "@/components/settings/AboutSection";
import { cn } from "@/lib/utils";

/**
 * Quick 260524-olt — nav label 改由 t() 解析,这里只保留 id + i18nKey 配对。
 * "Locale Emulator" 是专有名词,与英文/日文版同名,直接走 i18n 也能输出 LE,
 * 不再硬编码字面值,保证排序、扫描操作等条目跟随语言切换。
 */
const SECTIONS = [
  { id: "appearance", i18nKey: "settings.section.appearance" },
  { id: "scan-roots", i18nKey: "settings.section.scan_roots" },
  { id: "single-add", i18nKey: "settings.section.single_add" },
  { id: "le", i18nKey: "settings.section.le" },
  { id: "tags", i18nKey: "settings.section.tags" },
  { id: "scan-ops", i18nKey: "settings.section.scan_ops" },
  { id: "ui", i18nKey: "settings.section.ui" },
  { id: "debug", i18nKey: "settings.section.debug" },
  { id: "about", i18nKey: "settings.section.about" },
] as const;

export function Settings() {
  const { t } = useTranslation();
  const scanRoots = useLibraryStore((s) => s.scanRoots);
  const setScanRoots = useLibraryStore((s) => s.setScanRoots);
  const navigate = useNavigate();
  const [lePath, setLePath] = useState<string | null>(null);
  const [isAddingGame, setIsAddingGame] = useState(false);
  const [activeSection, setActiveSection] = useState<string>("appearance");
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    listScanRoots()
      .then(setScanRoots)
      .catch((e: unknown) => {
        // eslint-disable-next-line no-console
        console.error("[Settings] listScanRoots failed:", e);
      });
    getLePath()
      .then(setLePath)
      .catch((e: unknown) => {
        // eslint-disable-next-line no-console
        console.error("[Settings] getLePath failed:", e);
      });
  }, [setScanRoots]);

  // Scroll-spy: observe each section, update activeSection on intersection.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) {
          const id = (visible[0].target as HTMLElement).dataset.sectionId;
          if (id) setActiveSection(id);
        }
      },
      { rootMargin: "-20% 0px -60% 0px" },
    );
    for (const sec of SECTIONS) {
      const el = sectionRefs.current[sec.id];
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  function scrollTo(id: string) {
    sectionRefs.current[id]?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
    setActiveSection(id);
  }

  async function onPickLePath() {
    let picked: string | string[] | null;
    try {
      picked = await openDialog({
        filters: [{ name: "LEProc", extensions: ["exe"] }],
        multiple: false,
      });
    } catch (e: unknown) {
      toast.error(t("toast.pick_file_failed", { err: String(e) }));
      return;
    }
    if (typeof picked !== "string") return;
    try {
      await applyLePath(picked);
      setLePath(picked);
      toast.success(t("toast.le_set"));
    } catch (e: unknown) {
      toast.error(t("toast.set_failed", { err: String(e) }));
    }
  }

  async function onAdd() {
    let picked: string | string[] | null;
    try {
      picked = await openDialog({ directory: true, multiple: false });
    } catch (e: unknown) {
      toast.error(t("toast.pick_dir_failed", { err: String(e) }));
      return;
    }
    if (typeof picked !== "string") return;
    try {
      await addScanRoot(picked, 1);
      const rs = await listScanRoots();
      setScanRoots(rs);
      toast.success(t("toast.root_added"));
    } catch (e: unknown) {
      toast.error(t("toast.add_failed", { err: String(e) }));
    }
  }

  async function onAddSingleGame() {
    let picked: string | string[] | null;
    try {
      picked = await openDialog({ directory: true, multiple: false });
    } catch (e: unknown) {
      toast.error(t("toast.pick_dir_failed", { err: String(e) }));
      return;
    }
    if (typeof picked !== "string") return;
    const basename = picked.split(/[\\/]/).pop() || picked;
    setIsAddingGame(true);
    const job = (async () => {
      await addGame(picked as string);
      const [games, sidebar] = await Promise.all([
        searchGames(null, "last_played", "desc", null),
        getSidebarCategories(),
      ]);
      useLibraryStore.getState().setGames(games);
      useLibraryStore.getState().setSidebar(sidebar);
    })();
    toast.promise(job, {
      loading: t("toast.adding_basename", { basename }),
      success: t("toast.game_added"),
      error: (e) => t("toast.add_failed", { err: String(e) }),
    });
    try {
      await job;
    } catch {
      // Errors surfaced via toast.promise.
    } finally {
      setIsAddingGame(false);
    }
  }

  async function onRemove(id: number) {
    try {
      await removeScanRoot(id);
      const rs = await listScanRoots();
      setScanRoots(rs);
      toast.success(t("toast.root_removed"));
    } catch (e: unknown) {
      toast.error(t("toast.remove_failed", { err: String(e) }));
    }
  }

  async function onChangeDepth(id: number, depth: 1 | 2 | 3) {
    const target = scanRoots.find((r) => r.id === id);
    if (!target) return;
    try {
      // WR-04 fix: single atomic UPDATE replacing the old
      // removeScanRoot+addScanRoot dance — that pair could leave the row
      // missing entirely if the second IPC failed (no rollback), and the
      // user would have to re-add the scan root manually.
      await updateScanRootDepth(id, depth);
      const rs = await listScanRoots();
      setScanRoots(rs);
    } catch (e: unknown) {
      toast.error(t("toast.depth_failed", { err: String(e) }));
    }
  }

  async function onClearAllData() {
    try {
      await clearAllData();
      const [games, sidebar, roots] = await Promise.all([
        searchGames(null, "last_played", "desc", null),
        getSidebarCategories(),
        listScanRoots(),
      ]);
      useLibraryStore.getState().setGames(games);
      useLibraryStore.getState().setSidebar(sidebar);
      setScanRoots(roots);
      toast.success(t("toast.data_cleared"));
    } catch (e: unknown) {
      toast.error(t("toast.clear_failed", { err: String(e) }));
    }
  }

  async function onScan() {
    if (scanRoots.length === 0) {
      toast.error(t("toast.need_root_first"));
      return;
    }
    try {
      await startScan("full");
      toast.info(t("toast.scan_started_info"));
      navigate("/");
    } catch (e: unknown) {
      toast.error(t("toast.start_scan_failed", { err: String(e) }));
    }
  }

  async function onRefreshMetadata() {
    // Quick 260515-loading-phase-sort (round-3) — flag a full-library refresh
    // so every not-yet-processed card renders the queued ("pending") visual.
    // Cleared on terminal scan-progress (see main.tsx clearFetchingMetaIds).
    const store = useLibraryStore.getState();
    store.setMetaRefreshActive(true);
    try {
      await refreshMetadataSmart();
      toast.info(t("toast.refresh_started"));
      navigate("/");
    } catch (e: unknown) {
      // IPC failed to even spawn the task — no terminal event will arrive,
      // so reset the flag here to avoid a stuck library-wide pulse.
      store.setMetaRefreshActive(false);
      toast.error(t("toast.launch_failed", { err: String(e) }));
    }
  }

  const totalRoots = useMemo(() => scanRoots.length, [scanRoots]);

  return (
    <div className="h-full overflow-auto">
      <div
        className="mx-auto grid max-w-[1100px] gap-8 px-2 py-10"
        style={{ gridTemplateColumns: "200px 1fr" }}
      >
        {/* ── Left nav ────────────────────────────────────────────── */}
        <nav className="sticky top-10 self-start border-r border-line pl-6 pr-6">
          <div className="mb-3 font-mono text-[9.5px] uppercase tracking-[0.14em] text-ink-3">
            {t("settings.nav_header")}
          </div>
          {SECTIONS.map((s) => {
            const on = activeSection === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => scrollTo(s.id)}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12.5px] transition-colors",
                  on
                    ? "bg-brand-soft text-ink-0"
                    : "text-ink-2 hover:bg-bg-2 hover:text-ink-0",
                )}
                style={{ borderRadius: "var(--r-sm)" }}
              >
                <span>{t(s.i18nKey)}</span>
              </button>
            );
          })}
        </nav>

        {/* ── Main content ────────────────────────────────────────── */}
        <main className="pr-9">
          <header className="mb-7 flex items-start gap-4">
            {/* Hakoniwa wordmark — supplementary §9 wordmark variant.
                Square seal mark + serif title pair, mirrors the titlebar
                lockup but sized for the page header. */}
            <div
              aria-hidden
              className="grid h-12 w-12 flex-shrink-0 place-items-center font-serif text-[28px] font-bold text-white"
              style={{
                background:
                  "linear-gradient(155deg, var(--accent), var(--accent-deep))",
                borderRadius: "var(--r-md)",
                boxShadow: "0 6px 20px -8px var(--accent)",
                color: "var(--accent-on)",
              }}
            >
              箱
            </div>
            <div className="min-w-0">
              <div className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-3">
                {t("settings.nav_header")} / Preferences
              </div>
              <h1 className="mt-0.5 font-serif text-[26px] font-medium text-ink-0">
                {t("settings.page_title")}
              </h1>
              <div className="mt-1 font-mono text-[11px] text-ink-2">
                {t("settings.page_sub", { count: totalRoots })}
              </div>
            </div>
          </header>

          <Section
            id="appearance"
            title={t("settings.section.appearance")}
            lede={t("settings.section.appearance_lede")}
            sectionRefs={sectionRefs}
          >
            <p className="font-sans text-[12.5px] leading-[1.7] text-ink-1">
              {(() => {
                const body = t("settings.section.appearance_body");
                const parts = body.split(/<0>|<\/0>/);
                return (
                  <>
                    {parts[0]}
                    <span className="font-serif text-brand">{parts[1] ?? "Tweaks"}</span>
                    {parts[2]}
                  </>
                );
              })()}
            </p>
            <p className="mt-2 font-mono text-[11px] text-ink-3">
              {t("settings.section.appearance_hint")}
            </p>
          </Section>

          <Section
            id="scan-roots"
            title={t("settings.section.scan_roots")}
            lede={t("settings.section.scan_roots_lede")}
            sectionRefs={sectionRefs}
          >
            <div className="space-y-2">
              {scanRoots.length === 0 ? (
                <div
                  className="border border-dashed border-line bg-bg-1 p-8 text-center font-mono text-[11px] text-ink-3"
                  style={{ borderRadius: "var(--r-md)" }}
                >
                  {t("settings.scan_roots.empty")}
                </div>
              ) : (
                scanRoots.map((r) => (
                  <div
                    key={r.id}
                    className="grid items-center gap-2.5 border border-line bg-bg-1 px-3.5 py-2.5"
                    style={{
                      gridTemplateColumns: "1fr 90px 32px",
                      borderRadius: "var(--r-sm)",
                    }}
                  >
                    <code
                      className="truncate font-mono text-[11px] text-ink-0"
                      title={r.path}
                    >
                      {r.path}
                    </code>
                    <Select
                      value={String(r.depth)}
                      onValueChange={(v) =>
                        void onChangeDepth(r.id, Number(v) as 1 | 2 | 3)
                      }
                    >
                      <SelectTrigger className="h-7 text-[11px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">{t("settings.scan_roots.depth", { n: 1 })}</SelectItem>
                        <SelectItem value="2">{t("settings.scan_roots.depth", { n: 2 })}</SelectItem>
                        <SelectItem value="3">{t("settings.scan_roots.depth", { n: 3 })}</SelectItem>
                      </SelectContent>
                    </Select>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <button
                          type="button"
                          aria-label={t("common.remove")}
                          className="grid h-7 w-7 place-items-center text-ink-3 transition-colors hover:bg-bg-2 hover:text-destructive"
                          style={{ borderRadius: "var(--r-sm)" }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>{t("settings.scan_roots.remove_confirm_title")}</AlertDialogTitle>
                          <AlertDialogDescription>
                            {t("settings.scan_roots.remove_confirm_desc")}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                          <AlertDialogAction onClick={() => void onRemove(r.id)}>
                            {t("common.remove")}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                ))
              )}
            </div>
            <SettingButton onClick={() => void onAdd()} className="mt-3.5">
              {t("settings.scan_roots.add")}
            </SettingButton>
          </Section>

          <Section
            id="single-add"
            title={t("settings.section.single_add")}
            lede={t("settings.section.single_add_lede")}
            sectionRefs={sectionRefs}
          >
            <SettingButton
              onClick={() => void onAddSingleGame()}
              disabled={isAddingGame}
            >
              {isAddingGame ? t("settings.single_add.adding") : t("settings.single_add.pick")}
            </SettingButton>
          </Section>

          <Section
            id="le"
            title={t("settings.section.le")}
            lede={t("settings.section.le_lede")}
            sectionRefs={sectionRefs}
          >
            <p className="font-sans text-[12.5px] leading-[1.7] text-ink-1">
              {t("settings.section.le_body")}
            </p>
            <div
              className="mt-3.5 grid items-center gap-2.5 border border-line bg-bg-1 px-3.5 py-2.5"
              style={{
                gridTemplateColumns: "1fr 200px",
                borderRadius: "var(--r-sm)",
              }}
            >
              <code
                className="truncate font-mono text-[11px] text-ink-0"
                title={lePath ?? t("settings.section.le_default_hint")}
              >
                {lePath ?? <span className="text-ink-3">{t("settings.section.le_default_hint")}</span>}
              </code>
              <SettingButton onClick={() => void onPickLePath()}>
                {t("settings.section.le_override_pick")}
              </SettingButton>
            </div>
          </Section>

          <Section
            id="tags"
            title={t("settings.section.tags")}
            lede={t("settings.section.tags_lede")}
            sectionRefs={sectionRefs}
          >
            <TagManager />
          </Section>

          <Section
            id="scan-ops"
            title={t("settings.section.scan_ops")}
            lede={t("settings.section.scan_ops_lede")}
            sectionRefs={sectionRefs}
          >
            <div className="flex flex-wrap gap-2.5">
              <SettingButton primary onClick={() => void onScan()}>
                {t("settings.section.scan_ops_btn_scan")}
              </SettingButton>
              <SettingButton onClick={() => void onRefreshMetadata()}>
                {t("settings.section.scan_ops_btn_refresh")}
              </SettingButton>
            </div>
          </Section>

          <Section
            id="ui"
            title={t("settings.section.ui")}
            lede={t("settings.section.ui_lede")}
            sectionRefs={sectionRefs}
          >
            <UIPreferences />
          </Section>

          <Section
            id="debug"
            title={t("settings.section.debug")}
            lede={t("settings.section.debug_lede")}
            sectionRefs={sectionRefs}
          >
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button
                  type="button"
                  className="inline-flex h-8 items-center border border-destructive/40 bg-destructive/10 px-4 text-[12.5px] text-destructive transition-colors hover:bg-destructive/20"
                  style={{ borderRadius: "var(--r-md)" }}
                >
                  {t("settings.section.debug_clear")}
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("settings.section.debug_clear_confirm_title")}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("settings.section.debug_clear_confirm_desc")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void onClearAllData()}>
                    {t("settings.section.debug_clear_action")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </Section>

          <Section
            id="about"
            title={t("settings.section.about")}
            lede={t("settings.section.about_lede")}
            sectionRefs={sectionRefs}
          >
            <AboutSection />
          </Section>
        </main>
      </div>
    </div>
  );
}

// ── Internals ────────────────────────────────────────────────────────────

interface SectionProps {
  id: string;
  title: string;
  lede: string;
  children: React.ReactNode;
  sectionRefs: React.MutableRefObject<Record<string, HTMLElement | null>>;
}

function Section({ id, title, lede, children, sectionRefs }: SectionProps) {
  return (
    <section
      data-section-id={id}
      ref={(el) => {
        sectionRefs.current[id] = el;
      }}
      className="mb-9 scroll-mt-4"
    >
      <h2 className="font-serif text-[16px] font-medium text-ink-0">{title}</h2>
      <div className="mt-1 mb-3 font-mono text-[10.5px] text-ink-3">{lede}</div>
      <div>{children}</div>
    </section>
  );
}

interface SettingButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  primary?: boolean;
}

const SettingButton = React.forwardRef<HTMLButtonElement, SettingButtonProps>(
  function SettingButton(
    { primary, disabled, className, children, ...rest },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type="button"
        disabled={disabled}
        className={cn(
          "inline-flex h-8 items-center border px-3.5 text-[12.5px] transition-colors",
          primary
            ? "bg-brand text-bg-0 border-brand hover:bg-brand-deep"
            : "border-line bg-bg-2 text-ink-1 hover:border-line-strong hover:bg-bg-3 hover:text-ink-0",
          disabled && "cursor-not-allowed opacity-50",
          className,
        )}
        style={{ borderRadius: "var(--r-md)" }}
        {...rest}
      >
        {children}
      </button>
    );
  },
);
