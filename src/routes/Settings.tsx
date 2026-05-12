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
 *   6. 扫描操作                   — full/incremental scan
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
  refreshAllMetadata,
  removeScanRoot,
  startScan,
} from "@/lib/scan";
import { backfillReleaseYear } from "@/lib/persons";
import { getSidebarCategories, searchGames } from "@/lib/search";
import { getLePath, setLePath as applyLePath } from "@/lib/launch";
import { useLibraryStore } from "@/store/library";
import { TagManager } from "@/components/settings/TagManager";
import { UIPreferences } from "@/components/settings/UIPreferences";
import { cn } from "@/lib/utils";

const SECTIONS = [
  { id: "appearance", label: "外观" },
  { id: "scan-roots", label: "扫描根目录" },
  { id: "single-add", label: "添加单个游戏" },
  { id: "le", label: "Locale Emulator" },
  { id: "tags", label: "标签管理" },
  { id: "scan-ops", label: "扫描操作" },
  { id: "ui", label: "UI 偏好" },
  { id: "debug", label: "调试" },
] as const;

export function Settings() {
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
      toast.error(`打开文件选择失败 — ${String(e)}`);
      return;
    }
    if (typeof picked !== "string") return;
    try {
      await applyLePath(picked);
      setLePath(picked);
      toast.success("已设置 LE 路径");
    } catch (e: unknown) {
      toast.error(`设置失败 — ${String(e)}`);
    }
  }

  async function onAdd() {
    let picked: string | string[] | null;
    try {
      picked = await openDialog({ directory: true, multiple: false });
    } catch (e: unknown) {
      toast.error(`打开目录选择失败 — ${String(e)}`);
      return;
    }
    if (typeof picked !== "string") return;
    try {
      await addScanRoot(picked, 1);
      const rs = await listScanRoots();
      setScanRoots(rs);
      toast.success("已添加根目录");
    } catch (e: unknown) {
      toast.error(`添加失败 — ${String(e)}`);
    }
  }

  async function onAddSingleGame() {
    let picked: string | string[] | null;
    try {
      picked = await openDialog({ directory: true, multiple: false });
    } catch (e: unknown) {
      toast.error(`打开目录选择失败 — ${String(e)}`);
      return;
    }
    if (typeof picked !== "string") return;
    const basename = picked.split(/[\\/]/).pop() || picked;
    setIsAddingGame(true);
    const job = (async () => {
      await addGame(picked as string);
      const [games, sidebar] = await Promise.all([
        searchGames(null, "last_played", null),
        getSidebarCategories(),
      ]);
      useLibraryStore.getState().setGames(games);
      useLibraryStore.getState().setSidebar(sidebar);
    })();
    toast.promise(job, {
      loading: `正在添加 ${basename} ...`,
      success: "已添加游戏",
      error: (e) => `添加失败 — ${String(e)}`,
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
      toast.success("已移除根目录");
    } catch (e: unknown) {
      toast.error(`移除失败 — ${String(e)}`);
    }
  }

  async function onChangeDepth(id: number, depth: 1 | 2 | 3) {
    const target = scanRoots.find((r) => r.id === id);
    if (!target) return;
    try {
      await removeScanRoot(id);
      await addScanRoot(target.path, depth);
      const rs = await listScanRoots();
      setScanRoots(rs);
    } catch (e: unknown) {
      toast.error(`修改深度失败 — ${String(e)}`);
    }
  }

  async function onClearAllData() {
    try {
      await clearAllData();
      const [games, sidebar, roots] = await Promise.all([
        searchGames(null, "last_played", null),
        getSidebarCategories(),
        listScanRoots(),
      ]);
      useLibraryStore.getState().setGames(games);
      useLibraryStore.getState().setSidebar(sidebar);
      setScanRoots(roots);
      toast.success("已清除所有数据");
    } catch (e: unknown) {
      toast.error(`清除失败 — ${String(e)}`);
    }
  }

  async function onScan(mode: "full" | "incremental") {
    if (scanRoots.length === 0) {
      toast.error("请先添加至少一个扫描根目录");
      return;
    }
    try {
      await startScan(mode);
      toast.info("扫描已启动");
      navigate("/");
    } catch (e: unknown) {
      toast.error(`启动扫描失败 — ${String(e)}`);
    }
  }

  async function onRefreshAllMetadata() {
    try {
      await refreshAllMetadata();
      toast.info("元数据刷新已启动");
      navigate("/");
    } catch (e: unknown) {
      toast.error(`启动失败 — ${String(e)}`);
    }
  }

  async function onBackfillReleaseYear() {
    try {
      await backfillReleaseYear();
      toast.info("已开始补全发行年份 — 后台运行，受 API 限速影响可能耗时数分钟");
      navigate("/");
    } catch (e: unknown) {
      toast.error(`启动失败 — ${String(e)}`);
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
            设置
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
                <span>{s.label}</span>
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
                设置 / Preferences
              </div>
              <h1 className="mt-0.5 font-serif text-[26px] font-medium text-ink-0">
                偏好与配置
              </h1>
              <div className="mt-1 font-mono text-[11px] text-ink-2">
                所有数据存储在 portable `data/` 目录 · 共 {totalRoots} 个扫描根
              </div>
            </div>
          </header>

          <Section
            id="appearance"
            title="外观"
            lede="主题 / 强调色 / 圆角 / 侧栏宽度 / 封面密度"
            sectionRefs={sectionRefs}
          >
            <p className="font-sans text-[12.5px] leading-[1.7] text-ink-1">
              通过屏幕右下浮动 <span className="font-serif text-brand">Tweaks</span> 面板调整
              5 个外观维度，所有偏好实时生效并保存到 localStorage。
            </p>
            <p className="mt-2 font-mono text-[11px] text-ink-3">
              提示：滑块/分段控件就在面板里，不需要在这里复制一份开关。
            </p>
          </Section>

          <Section
            id="scan-roots"
            title="扫描根目录"
            lede="gal-lib 会扫描这些目录下的游戏"
            sectionRefs={sectionRefs}
          >
            <div className="space-y-2">
              {scanRoots.length === 0 ? (
                <div
                  className="border border-dashed border-line bg-bg-1 p-8 text-center font-mono text-[11px] text-ink-3"
                  style={{ borderRadius: "var(--r-md)" }}
                >
                  还没有根目录 — 点下方按钮添加
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
                        <SelectItem value="1">第 1 层</SelectItem>
                        <SelectItem value="2">第 2 层</SelectItem>
                        <SelectItem value="3">第 3 层</SelectItem>
                      </SelectContent>
                    </Select>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <button
                          type="button"
                          aria-label="移除"
                          className="grid h-7 w-7 place-items-center text-ink-3 transition-colors hover:bg-bg-2 hover:text-destructive"
                          style={{ borderRadius: "var(--r-sm)" }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>确定移除该根目录？</AlertDialogTitle>
                          <AlertDialogDescription>
                            已扫描的游戏不会被删除
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>取消</AlertDialogCancel>
                          <AlertDialogAction onClick={() => void onRemove(r.id)}>
                            移除
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                ))
              )}
            </div>
            <SettingButton onClick={() => void onAdd()} className="mt-3.5">
              + 添加根目录
            </SettingButton>
          </Section>

          <Section
            id="single-add"
            title="添加单个游戏"
            lede="跳过扫描，直接选择某个游戏目录加入库"
            sectionRefs={sectionRefs}
          >
            <SettingButton
              onClick={() => void onAddSingleGame()}
              disabled={isAddingGame}
            >
              {isAddingGame ? "正在添加..." : "选择游戏目录"}
            </SettingButton>
          </Section>

          <Section
            id="le"
            title="Locale Emulator"
            lede="日区转区启动器 — 已内置 LE，老 galgame 可一键 Shift-JIS 启动"
            sectionRefs={sectionRefs}
          >
            <p className="font-sans text-[12.5px] leading-[1.7] text-ink-1">
              在游戏卡片右键选「用日区启动器」即可启动；首次启动会弹一次 UAC 同意框（LE 自身需要管理员权限）。
              想换成 ntleas / LEx / 自定义批处理，在下面填入它的 exe 路径作为覆盖。
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
                title={lePath ?? "默认使用内置 LE"}
              >
                {lePath ?? <span className="text-ink-3">默认使用内置 LE（无需配置）</span>}
              </code>
              <SettingButton onClick={() => void onPickLePath()}>
                覆盖：选择启动器 .exe
              </SettingButton>
            </div>
          </Section>

          <Section
            id="tags"
            title="标签管理"
            lede="自定义标签 · 颜色 · 关联游戏"
            sectionRefs={sectionRefs}
          >
            <TagManager />
          </Section>

          <Section
            id="scan-ops"
            title="扫描操作"
            lede="增量扫描跳过已绑定的游戏，自动复审「待复核」 · 全量扫描重新发现并匹配 · 强制刷新重跑全部元数据 · 补全发行年份只对历史绑定但缺年份的游戏拉取（不改其它字段）"
            sectionRefs={sectionRefs}
          >
            <div className="flex flex-wrap gap-2.5">
              <SettingButton primary onClick={() => void onScan("full")}>
                全量扫描
              </SettingButton>
              <SettingButton onClick={() => void onScan("incremental")}>
                增量扫描
              </SettingButton>
              <SettingButton onClick={() => void onBackfillReleaseYear()}>
                补全发行年份
              </SettingButton>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <SettingButton>强制刷新全部元数据</SettingButton>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>确定刷新全部元数据？</AlertDialogTitle>
                    <AlertDialogDescription>
                      会对所有游戏重新搜索 Bangumi/VNDB，
                      <span className="text-ink-1">含已绑定与手动绑定的</span>
                      。手动指定的封面/标题可能被覆盖。受 API 限速器约束，库越大越慢。若只想给历史绑定补回发行年份（不改其它字段），请使用「补全发行年份」按钮。
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>取消</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => void onRefreshAllMetadata()}
                    >
                      确定刷新
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </Section>

          <Section
            id="ui"
            title="UI 偏好"
            lede="默认排序 · 主题（占位）"
            sectionRefs={sectionRefs}
          >
            <UIPreferences />
          </Section>

          <Section
            id="debug"
            title="调试"
            lede="清除所有游戏 · 扫描根 · 会话与封面/截图/存档备份（保留标签与 LE 路径）"
            sectionRefs={sectionRefs}
          >
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button
                  type="button"
                  className="inline-flex h-8 items-center border border-destructive/40 bg-destructive/10 px-4 text-[12.5px] text-destructive transition-colors hover:bg-destructive/20"
                  style={{ borderRadius: "var(--r-md)" }}
                >
                  清除所有数据
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>确定清除所有数据？</AlertDialogTitle>
                  <AlertDialogDescription>
                    此操作不可撤销，将删除全部游戏、扫描根、会话历史与缓存文件
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>取消</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void onClearAllData()}>
                    清除
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
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
