import React, { useEffect, useRef, useState } from "react";
import type { MonitorZoom } from "../Preview";

/**
 * The Edit monitor's Fit control, in its header (docs/PROPOSAL_EDITOR_REDESIGN.md R6.1):
 * the monitor's zoom, which used to sit in its "...". 100% fits the frame to the monitor,
 * so it is called Fit; the others say how far past or short of that they are.
 */
export function fitLabel(level: number): string {
  return level === 1 ? "Fit" : `${Math.round(level * 100)}%`;
}

export const FitControl: React.FC<{ zoom: MonitorZoom }> = ({ zoom }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Monitor size: ${fitLabel(zoom.level)}`}
        title="Monitor size"
        onClick={() => setOpen((v) => !v)}
        className="or-control or-focus h-[30px] min-w-[52px] px-3 font-mono text-[12px]"
      >
        {fitLabel(zoom.level)}
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Monitor size"
          className="or-glass absolute right-0 top-full z-50 mt-1.5 flex min-w-[96px] flex-col gap-0.5 bg-bg-1 p-1.5"
          style={{ borderRadius: 16 }}
        >
          {zoom.options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="menuitemradio"
              aria-checked={zoom.level === opt.value}
              onClick={() => {
                zoom.set(opt.value);
                setOpen(false);
              }}
              className={`or-focus rounded-[10px] px-2.5 py-1.5 text-left font-mono text-[12px] hover:bg-hover ${
                zoom.level === opt.value ? "text-accent-text" : "text-fg-2"
              }`}
            >
              {fitLabel(opt.value)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
