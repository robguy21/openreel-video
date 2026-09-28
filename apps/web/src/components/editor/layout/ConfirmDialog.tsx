import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

/**
 * A question that has to be answered before something irreversible happens, on glass over
 * the editor: the reason in a sentence, the way out first and the action second. Escape
 * and a click outside cancel. Portalled to the body, because the rail it opens from is glass,
 * and a backdrop filter makes any `fixed` child fixed to the rail instead of to the page.
 */
export const ConfirmDialog: React.FC<{
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ open, title, body, confirmLabel, cancelLabel = "Cancel", onConfirm, onCancel }) => {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [open, onCancel]);

  if (!open) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-[color:var(--room-scrim-look)] p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
        className="or-glass flex w-full max-w-[420px] flex-col gap-3 bg-bg-1 p-6"
      >
        <h2 id="confirm-title" className="text-[15px] font-semibold text-fg-strong">
          {title}
        </h2>
        <p id="confirm-body" className="text-[13px] leading-relaxed text-fg-2">
          {body}
        </p>
        <div className="mt-2 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="or-control or-focus h-9 px-4 text-[13px]"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="or-primary or-focus h-9 px-4 text-[13px] font-medium"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
