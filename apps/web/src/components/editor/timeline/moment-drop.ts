import type { ActionResult, MomentKind } from "@openreel/core";
import { MOMENT_KINDS } from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";

/**
 * Drag payload for the Moments panel buttons. It rides the same
 * `application/json` dataTransfer channel as media cards, so the timeline's
 * existing drop handlers pick it up; `moment` distinguishes it from `mediaId`.
 */
export interface MomentDropPayload {
  moment: MomentKind;
}

export function serializeMomentDropPayload(kind: MomentKind): string {
  return JSON.stringify({ moment: kind } satisfies MomentDropPayload);
}

/** The moment kind carried by a dataTransfer JSON payload, or null. */
export function parseMomentDropPayload(raw: unknown): MomentKind | null {
  const data =
    typeof raw === "string"
      ? (() => {
          try {
            return JSON.parse(raw) as unknown;
          } catch {
            return null;
          }
        })()
      : raw;
  const kind = (data as { moment?: unknown } | null)?.moment;
  return typeof kind === "string" && (MOMENT_KINDS as string[]).includes(kind)
    ? (kind as MomentKind)
    : null;
}

/**
 * A moment dropped on the timeline always lands on the Moments track at the
 * drop time (the track is created on first use). Overlaps are refused by
 * `addMoment`, which shows the "Moments can't overlap" toast itself.
 */
export function dropMomentOnTimeline(
  kind: MomentKind,
  time: number,
): Promise<ActionResult> {
  return useProjectStore.getState().addMoment(kind, Math.max(0, time));
}
