/**
 * DeleteViewDialog — 删除视图的确认对话框。
 *
 * 用 shadcn AlertDialog 替换 window.confirm，匹配应用风格：
 *   - 印章红警示 glyph，serif 标题，mono 副标
 *   - 醒目展示视图名 + 当前条目数
 *   - 主操作红色 destructive，副操作 outline
 *
 * 控制反转：父组件持有 target 状态，提交回调 await IPC 后 close。
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

export interface DeleteViewTarget {
  id: number;
  name: string;
  count: number;
}

interface DeleteViewDialogProps {
  target: DeleteViewTarget | null;
  onClose: () => void;
  onConfirm: (target: DeleteViewTarget) => Promise<void> | void;
}

export function DeleteViewDialog({
  target,
  onClose,
  onConfirm,
}: DeleteViewDialogProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const open = target !== null;

  async function confirm() {
    if (!target || busy) return;
    setBusy(true);
    try {
      await onConfirm(target);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <AlertDialogContent
        size="sm"
        className={cn(
          "gap-0 border border-line-strong bg-bg-1 p-0 text-ink-1",
          "shadow-lift",
        )}
        style={{ borderRadius: "var(--r-md)" }}
      >
        <AlertDialogHeader className="grid grid-cols-[auto_1fr] place-items-start gap-x-3.5 gap-y-1.5 px-5 pt-5 text-left">
          <span
            aria-hidden
            className="row-span-2 grid h-9 w-9 place-items-center border text-[#d96f5a]"
            style={{
              background: "rgba(217, 111, 90, 0.12)",
              borderColor: "rgba(217, 111, 90, 0.6)",
              borderRadius: "var(--r-sm)",
            }}
          >
            <Trash2 size={15} strokeWidth={1.7} />
          </span>
          <AlertDialogTitle className="font-serif text-[15px] leading-tight text-ink-0">
            {t("views.delete.title")}
          </AlertDialogTitle>
          <p className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-ink-3">
            {t("views.delete.subtitle")}
          </p>
        </AlertDialogHeader>

        <div className="px-5 pt-3 pb-5">
          <AlertDialogDescription className="text-[12.5px] leading-[1.65] text-ink-2">
            {t("views.delete.body")}
          </AlertDialogDescription>
          <div
            className="mt-2.5 flex items-center justify-between gap-3 border border-line bg-bg-2 px-3.5 py-2.5"
            style={{ borderRadius: "var(--r-sm)" }}
          >
            <span className="truncate text-[13px] font-medium text-ink-0">
              {target?.name ?? ""}
            </span>
            <span className="shrink-0 font-mono text-[10.5px] text-ink-3 tabular-nums">
              {t("views.delete.count_works", { count: target?.count ?? 0 })}
            </span>
          </div>
          <p className="mt-3 text-[12px] leading-[1.6] text-ink-2">
            {t("views.delete.note")}
            <span className="text-ink-0">{t("views.delete.note_strong")}</span>
            {t("views.delete.note_tail")}
          </p>
        </div>

        <AlertDialogFooter className="m-0 flex-row justify-end gap-2 rounded-none border-t border-line bg-bg-0 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className={cn(
              "inline-flex h-8 items-center border border-line bg-bg-1 px-3.5 text-[12.5px] text-ink-1 transition-colors",
              "hover:border-line-strong hover:bg-bg-2 hover:text-ink-0",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
            style={{ borderRadius: "var(--r-md)" }}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={busy}
            className={cn(
              "inline-flex h-8 items-center border border-[#d96f5a] px-4 text-[12.5px] font-medium text-white transition-colors",
              "hover:brightness-110",
              "disabled:cursor-not-allowed disabled:opacity-60",
            )}
            style={{
              background: "#d96f5a",
              borderRadius: "var(--r-md)",
            }}
          >
            {busy ? t("views.delete.deleting") : t("views.delete.confirm")}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
