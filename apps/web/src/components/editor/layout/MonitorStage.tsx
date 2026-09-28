import React, { useEffect, useRef, useState } from "react";
import { useReferenceStore } from "../../../stores/reference-store";
import { ReferenceMonitor } from "./ReferenceMonitor";

/**
 * The stage: the Reference monitor and the Edit monitor side by side, 12 px apart
 * (docs/PROPOSAL_EDITOR_REDESIGN.md R2.1-2.2, R5.6). The split between them is dragged
 * in the gap and remembered per browser - half by default, neither under 280 px - and
 * the Reference can be hidden to give the Edit monitor the whole stage, which is
 * remembered too.
 */

export const MONITOR_SPLIT_KEY = "openreel-layout-monitor-split";
const MIN_MONITOR_W = 280;
const GAP = 12;

function readSplit(): number {
  try {
    const raw = Number.parseFloat(window.localStorage.getItem(MONITOR_SPLIT_KEY) ?? "");
    return Number.isFinite(raw) && raw > 0 && raw < 1 ? raw : 0.5;
  } catch {
    return 0.5;
  }
}

/** The Reference's share of the stage, kept so that each monitor has `min` px. */
export function clampSplit(split: number, stageWidth: number, min = MIN_MONITOR_W): number {
  const usable = stageWidth - GAP;
  if (usable <= 2 * min) return 0.5;
  return Math.min(Math.max(split, min / usable), 1 - min / usable);
}

export const MonitorStage: React.FC<{ edit: React.ReactNode }> = ({ edit }) => {
  const hidden = useReferenceStore((s) => s.hidden);
  const setHidden = useReferenceStore((s) => s.setHidden);
  const setFocus = useReferenceStore((s) => s.setFocus);
  const stageRef = useRef<HTMLDivElement>(null);
  const [split, setSplit] = useState(readSplit);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setWidth(el.getBoundingClientRect().width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const stage = stageRef.current;
    if (!stage) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    let latest = split;
    const move = (ev: PointerEvent) => {
      const r = stage.getBoundingClientRect();
      latest = clampSplit((ev.clientX - r.left - GAP / 2) / (r.width - GAP), r.width);
      setSplit(latest);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      try {
        window.localStorage.setItem(MONITOR_SPLIT_KEY, String(latest));
      } catch {
        /* a per-browser convenience */
      }
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  };

  const share = clampSplit(split, width);

  return (
    <div
      ref={stageRef}
      className="relative grid h-full min-h-0 min-w-0"
      style={{
        gridTemplateColumns: hidden
          ? "minmax(0, 1fr)"
          : `minmax(0, ${share}fr) minmax(0, ${1 - share}fr)`,
        columnGap: GAP,
      }}
    >
      {!hidden && <ReferenceMonitor onHide={() => setHidden(true)} />}
      <div
        className="relative flex min-h-0 min-w-0 flex-col"
        onPointerDownCapture={() => setFocus("edit")}
      >
        {edit}
        {hidden && (
          <button
            type="button"
            onClick={() => setHidden(false)}
            className="or-control or-focus absolute right-3 top-[11px] z-10 h-[30px] px-3 text-[12px]"
            title="Show the Reference monitor"
          >
            Reference
          </button>
        )}
      </div>
      {!hidden && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the monitors"
          onPointerDown={onDrag}
          className="group absolute bottom-0 top-0 z-10 flex w-[12px] cursor-col-resize items-center justify-center"
          style={{ left: `calc(${share} * (100% - ${GAP}px))` }}
        >
          <span className="h-10 w-1 rounded-full bg-transparent transition-colors group-hover:bg-accent-glow" />
        </div>
      )}
    </div>
  );
};
