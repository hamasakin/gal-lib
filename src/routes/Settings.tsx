import { ScrollArea } from "@/components/ui/scroll-area";

/**
 * Settings route ("/settings").
 *
 * Phase 1 placeholder only — real settings interactions (scan roots, LE path,
 * default locale) land in Phase 4. Copy is verbatim from UI-SPEC
 * §Copywriting Contract (locked): `设置 — 即将上线`
 * (note: U+2014 中文长破折号, NOT `-` or `--`).
 */
export function Settings() {
  return (
    <ScrollArea className="h-full w-full">
      <div className="flex h-full min-h-full w-full items-center justify-center px-8">
        <h2 className="text-h2 text-foreground">设置 — 即将上线</h2>
      </div>
    </ScrollArea>
  );
}
