/**
 * ViewNameDialog — 共用的"新建/重命名视图"对话框。
 *
 * 两种模式：
 *   - kind="create"：标题"新建视图"，副文案介绍视图概念，提交按钮"创建视图"
 *   - kind="rename"：标题"重命名视图"，提交按钮"保存"
 *
 * 视觉契约：
 *   - serif 标题 + mono uppercase 副标，呼应 PageHeader / FilterPanel
 *   - input 单独一块带 line border + 聚焦换 line-strong + 描述行可选
 *   - footer 分割线 + 主操作 bg-brand
 *
 * 控制反转：父组件持有 open 状态，提交回调里再做异步 IPC + toast。
 * 这里只关心 UI / 输入校验（trim + 非空 + 不超过 60 字）。
 */

import { useEffect, useRef, useState } from "react";
import { Bookmark, Pencil } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type ViewNameDialogMode =
  | { kind: "create" }
  | { kind: "rename"; initial: string };

interface ViewNameDialogProps {
  /** 非 null 表示打开；mode.kind 决定文案。 */
  mode: ViewNameDialogMode | null;
  onClose: () => void;
  /** 用户提交后调用。返回 Promise 以便对话框在 await 完成后才关闭。 */
  onSubmit: (name: string) => Promise<void> | void;
}

const MAX_LEN = 60;

export function ViewNameDialog({ mode, onClose, onSubmit }: ViewNameDialogProps) {
  const open = mode !== null;
  const isRename = mode?.kind === "rename";
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // 每次打开重置内容；用 useEffect 而不是 defaultValue，避免对话框关闭复用残留。
  useEffect(() => {
    if (mode === null) return;
    setValue(mode.kind === "rename" ? mode.initial : "");
    setBusy(false);
    // Radix 自带 autofocus 给第一个可聚焦元素，但 onOpenAutoFocus 会被消费；
    // 这里多保一个 raf focus + 全选，体感更可靠。
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [mode]);

  const trimmed = value.trim();
  const tooLong = trimmed.length > MAX_LEN;
  const empty = trimmed.length === 0;
  const unchanged = isRename && mode?.kind === "rename" && trimmed === mode.initial.trim();
  const disabled = busy || empty || tooLong || unchanged;

  async function submit() {
    if (disabled) return;
    setBusy(true);
    try {
      await onSubmit(trimmed);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className={cn(
          "gap-0 border border-line-strong bg-bg-1 p-0 text-ink-1",
          "shadow-lift sm:max-w-[400px]",
        )}
        style={{ borderRadius: "var(--r-md)" }}
        onEscapeKeyDown={(e) => {
          if (busy) e.preventDefault();
        }}
      >
        <DialogHeader className="gap-1.5 px-5 pt-5">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="grid h-8 w-8 place-items-center border border-brand bg-brand-soft text-brand"
              style={{ borderRadius: "var(--r-sm)" }}
            >
              {isRename ? (
                <Pencil size={14} strokeWidth={1.7} />
              ) : (
                <Bookmark size={14} strokeWidth={1.7} />
              )}
            </span>
            <div className="flex flex-col gap-0.5">
              <DialogTitle className="font-serif text-[15px] leading-tight text-ink-0">
                {isRename ? "重命名视图" : "新建视图"}
              </DialogTitle>
              <p className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-ink-3">
                {isRename ? "Rename collection" : "Custom collection"}
              </p>
            </div>
          </div>
          <DialogDescription className="pt-3 text-[12.5px] leading-[1.6] text-ink-2">
            {isRename
              ? "改名只影响显示，视图里的游戏保持不动。"
              : "视图是你保存的一组游戏 — 在网格里批量选中后可以加入，或者从详情卡上一键收纳。"}
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 pb-5 pt-4">
          <label
            htmlFor="view-name-input"
            className="mb-1.5 block font-mono text-[9.5px] uppercase tracking-[0.14em] text-ink-3"
          >
            视图名称
          </label>
          <input
            id="view-name-input"
            ref={inputRef}
            type="text"
            value={value}
            disabled={busy}
            maxLength={MAX_LEN + 8 /* 让多输入几个再视觉示警 */}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder={
              isRename
                ? "新的视图名称"
                : "如：本月在玩 / 通关候补 / TOP 10…"
            }
            className={cn(
              "h-9 w-full border bg-bg-2 px-3 text-[13px] text-ink-0 outline-none transition-colors",
              "placeholder:text-ink-3",
              tooLong
                ? "border-[#d96f5a] focus:border-[#d96f5a]"
                : "border-line focus:border-line-strong",
            )}
            style={{ borderRadius: "var(--r-sm)" }}
            autoComplete="off"
          />
          <div className="mt-1.5 flex items-center justify-between font-mono text-[10px] text-ink-3">
            <span aria-live="polite">
              {tooLong
                ? `已超出 ${trimmed.length - MAX_LEN} 字`
                : "回车提交 · Esc 取消"}
            </span>
            <span className={tooLong ? "text-[#d96f5a]" : ""}>
              {trimmed.length}/{MAX_LEN}
            </span>
          </div>
        </div>

        <DialogFooter className="m-0 flex-row justify-end gap-2 rounded-none border-t border-line bg-bg-0 px-5 py-3">
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
            取消
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={disabled}
            className={cn(
              "inline-flex h-8 items-center border border-brand bg-brand px-4 text-[12.5px] font-medium text-[var(--accent-on)] transition-colors",
              "hover:bg-brand-deep hover:text-white",
              "disabled:cursor-not-allowed disabled:border-line disabled:bg-bg-2 disabled:text-ink-3",
            )}
            style={{ borderRadius: "var(--r-md)" }}
          >
            {busy ? "…" : isRename ? "保存" : "创建视图"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
