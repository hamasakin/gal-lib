import { useNavigate } from "react-router-dom";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";

/**
 * Library route ("/").
 *
 * Phase 1 ships only the empty state — no game grid, no scan UI. Copy is
 * verbatim from UI-SPEC §Copywriting Contract (locked):
 *   H2:  还没有游戏
 *   Body: 请到设置页添加扫描根目录
 *   CTA:  打开设置  → navigate("/settings")
 *
 * The whole pane is wrapped in <ScrollArea> so Phase 2's card grid drops in
 * cleanly without restructuring the route.
 */
export function Library() {
  const navigate = useNavigate();
  return (
    <ScrollArea className="h-full w-full">
      <div className="flex h-full min-h-full w-full items-center justify-center px-8">
        <div className="flex flex-col items-center gap-6 text-center">
          <h2 className="text-h2 text-foreground">还没有游戏</h2>
          <p className="text-body text-muted-foreground">
            请到设置页添加扫描根目录
          </p>
          <Button variant="ghost" onClick={() => navigate("/settings")}>
            打开设置
          </Button>
        </div>
      </div>
    </ScrollArea>
  );
}
