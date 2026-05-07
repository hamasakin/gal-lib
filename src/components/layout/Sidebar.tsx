import { Settings as SettingsIcon } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Sidebar — fixed-width 220px left rail.
 *
 * Layout (top to bottom):
 *   - section heading: 分类
 *   - 4 placeholder category items (cursor-not-allowed, Tooltip "即将开放")
 *   - <Separator />
 *   - 设置 nav button (active when location.pathname === "/settings")
 *
 * UI-SPEC §Layout/Copywriting Contract — strings + dimensions are LOCKED.
 *   - Width: 220px arbitrary value syntax (no Tailwind alias, no inline style)
 *   - Section heading copy: 分类
 *   - Placeholder order: 全部 / 收藏 / 标签 / 通关状态
 *   - Tooltip: 即将开放
 *   - Settings nav copy: 设置
 *   - Active accent: 2px #7C5CFF (bg-ring) vertical bar + bg-accent
 */

/** UI-SPEC §Copywriting Contract — order locked. */
const PLACEHOLDER_CATEGORIES = ["全部", "收藏", "标签", "通关状态"] as const;

export function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const isSettingsActive = location.pathname === "/settings";

  return (
    <aside className="flex h-full w-[220px] shrink-0 flex-col bg-card border-r border-border">
      <ScrollArea className="flex-1">
        <div className="flex flex-col py-2">
          {/* Section heading: 分类 */}
          <div className="px-4 py-2 text-label text-muted-foreground select-none">
            分类
          </div>

          {/* Placeholder categories — non-interactive in P1 */}
          <TooltipProvider delayDuration={300}>
            <ul className="flex flex-col">
              {PLACEHOLDER_CATEGORIES.map((label) => (
                <li key={label}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div
                        aria-disabled="true"
                        className={cn(
                          "px-4 py-2 text-body select-none",
                          "cursor-not-allowed text-muted-foreground"
                        )}
                      >
                        {label}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="right">即将开放</TooltipContent>
                  </Tooltip>
                </li>
              ))}
            </ul>
          </TooltipProvider>
        </div>
      </ScrollArea>

      {/* Bottom: Separator + 设置 nav */}
      <div className="flex flex-col">
        <Separator />
        <button
          type="button"
          onClick={() => navigate("/settings")}
          aria-current={isSettingsActive ? "page" : undefined}
          className={cn(
            "relative flex items-center gap-2 px-4 py-2 text-body text-foreground",
            "transition-colors duration-150",
            "hover:bg-accent",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            isSettingsActive && "bg-accent"
          )}
        >
          {isSettingsActive && (
            <span
              aria-hidden="true"
              className="absolute left-0 top-0 h-full w-[2px] bg-ring"
            />
          )}
          <SettingsIcon size={16} />
          <span>设置</span>
        </button>
      </div>
    </aside>
  );
}
