/**
 * EditGameInfoDialog —「编辑条目信息」对话框（标题 + 品牌）。
 *
 * 视觉/交互契约参照 ViewNameDialog：
 *   - 受控 open；父组件持有状态，onSubmit 返回 Promise 后本组件再关闭。
 *   - 每次打开用 useEffect 重置为 initial* 并 focus+select 标题输入。
 *   - Enter 提交、忙碌禁用、footer 分割线 + 主操作 bg-brand。
 *
 * 两个字段：
 *   - 标题：自由文本 input（trim + 非空校验；空则禁用保存）。写 name_cn。
 *   - 品牌：纯下拉 Select，**只列出 brands 里的项 + 一个「无品牌」哨兵**，
 *     杜绝自由输入新品牌（避免拼写分叉产生重复品牌桶）。哨兵值 NONE 映射回 null。
 *
 * 提交语义：onSubmit(trimmedTitle, selectedBrand===NONE ? null : selectedBrand)。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pencil } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/** 品牌下拉里表示「无品牌」的哨兵值。不会与真实品牌名冲突。 */
const NONE = "__none__";

interface EditGameInfoDialogProps {
  open: boolean;
  /** 传 displayGameName(game) 结果，作为标题输入初值。 */
  initialTitle: string;
  /** game.brand。 */
  initialBrand: string | null;
  /** 已有品牌列表（含计数），下拉选项唯一来源。 */
  brands: Array<{ name: string; count: number }>;
  onClose: () => void;
  onSubmit: (title: string, brand: string | null) => Promise<void> | void;
}

export function EditGameInfoDialog({
  open,
  initialTitle,
  initialBrand,
  brands,
  onClose,
  onSubmit,
}: EditGameInfoDialogProps) {
  const { t } = useTranslation();
  const [title, setTitle] = useState("");
  const [brand, setBrand] = useState<string>(NONE);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // 每次打开重置内容 + focus/select 标题，避免复用残留。
  useEffect(() => {
    if (!open) return;
    setTitle(initialTitle);
    setBrand(initialBrand && initialBrand.trim() !== "" ? initialBrand : NONE);
    setBusy(false);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [open, initialTitle, initialBrand]);

  // 品牌选项：已有品牌 + 兜底（initialBrand 非空但不在列表里时补一项，
  // 避免选中值不可见）。
  const options = useMemo(() => {
    const list = brands.slice();
    const cur = (initialBrand ?? "").trim();
    if (cur !== "" && !list.some((b) => b.name === cur)) {
      list.unshift({ name: cur, count: 0 });
    }
    return list;
  }, [brands, initialBrand]);

  const trimmed = title.trim();
  const empty = trimmed.length === 0;
  const initBrandNorm =
    initialBrand && initialBrand.trim() !== "" ? initialBrand : NONE;
  const unchanged = trimmed === initialTitle.trim() && brand === initBrandNorm;
  const disabled = busy || empty || unchanged;

  async function submit() {
    if (disabled) return;
    setBusy(true);
    try {
      await onSubmit(trimmed, brand === NONE ? null : brand);
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
          "shadow-lift sm:max-w-[420px]",
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
              <Pencil size={14} strokeWidth={1.7} />
            </span>
            <div className="flex flex-col gap-0.5">
              <DialogTitle className="font-serif text-[15px] leading-tight text-ink-0">
                {t("detail.edit.title")}
              </DialogTitle>
              <p className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-ink-3">
                {t("detail.edit.subtitle")}
              </p>
            </div>
          </div>
          <DialogDescription className="sr-only">
            {t("detail.edit.title")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 px-5 pb-5 pt-4">
          {/* 标题 */}
          <div>
            <label
              htmlFor="edit-title-input"
              className="mb-1.5 block font-mono text-[9.5px] uppercase tracking-[0.14em] text-ink-3"
            >
              {t("detail.edit.title_label")}
            </label>
            <input
              id="edit-title-input"
              ref={inputRef}
              type="text"
              value={title}
              disabled={busy}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void submit();
                }
              }}
              placeholder={t("detail.edit.title_placeholder")}
              className={cn(
                "h-9 w-full border bg-bg-2 px-3 text-[13px] text-ink-0 outline-none transition-colors",
                "placeholder:text-ink-3",
                "border-line focus:border-line-strong",
              )}
              style={{ borderRadius: "var(--r-sm)" }}
              autoComplete="off"
            />
          </div>

          {/* 品牌 —— 纯下拉，只列已有品牌 + 无品牌 */}
          <div>
            <label
              className="mb-1.5 block font-mono text-[9.5px] uppercase tracking-[0.14em] text-ink-3"
            >
              {t("detail.edit.brand_label")}
            </label>
            <Select value={brand} onValueChange={setBrand} disabled={busy}>
              <SelectTrigger className="h-9 w-full border-line bg-bg-2 text-[13px] text-ink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>
                  <span className="text-ink-2">{t("detail.edit.brand_none")}</span>
                </SelectItem>
                {options.map((b) => (
                  <SelectItem key={b.name} value={b.name}>
                    {b.name}
                    {b.count > 0 && (
                      <span className="ml-auto font-mono text-[10px] text-ink-3">
                        {b.count}
                      </span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1.5 font-mono text-[10px] text-ink-3">
              {t("detail.edit.brand_hint")}
            </p>
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
            {t("common.cancel")}
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
            {busy ? "…" : t("detail.edit.save")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
