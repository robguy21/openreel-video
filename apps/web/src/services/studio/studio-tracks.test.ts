import { describe, expect, it } from "vitest";
import { studioTrackPlan } from "./studio-session";
import type { PlannedClip } from "./studio-layout";

/** The rows of a laid-out studio film (docs/PROPOSAL_EDITOR_REDESIGN.md R8.2). */

const clip = (shot: number, lane: number): PlannedClip =>
  ({ shot, lane, startTime: shot, inPoint: 0, outPoint: 1, pictureIn: 0, pictureOut: 0,
     soundFadeIn: 0, soundFadeOut: 0, volume: 1 }) as PlannedClip;

/** Replays `addTrack`'s placement (undefined appends, 0 is the top) to read top to bottom. */
function topToBottom(rows: ReturnType<typeof studioTrackPlan>): string[] {
  const out: string[] = [];
  for (const r of rows) {
    if (r.position === undefined) out.push(r.name);
    else out.splice(r.position, 0, r.name);
  }
  return out;
}

describe("studioTrackPlan", () => {
  it("lays each lane's sound on its own row, between the pictures and the narration", () => {
    const rows = studioTrackPlan(
      { clips: [clip(0, 0), clip(1, 1), clip(2, 0)], lanes: 2, narrations: [{ shot: 0, startTime: 0 }] },
      () => true,
      true,
    );
    expect(topToBottom(rows)).toEqual([
      "Crossfades", "Shots", "Shot sound", "Crossfade sound", "Narration", "Seam sound",
    ]);
    expect(rows.find((r) => r.key === "sound:1")?.type).toBe("audio");
  });

  it("numbers the lanes when there are several, so no two overlapping sounds share a row", () => {
    const rows = studioTrackPlan(
      { clips: [clip(0, 0), clip(1, 1), clip(2, 2)], lanes: 3, narrations: [] },
      () => true,
      false,
    );
    expect(topToBottom(rows)).toEqual([
      "Crossfades 2", "Crossfades 1", "Shots", "Shot sound", "Crossfade sound 1", "Crossfade sound 2",
    ]);
  });

  it("makes no sound row for a lane whose shots have no separate sound", () => {
    const rows = studioTrackPlan(
      { clips: [clip(0, 0), clip(1, 1)], lanes: 2, narrations: [] },
      (shot) => shot === 0,
      false,
    );
    expect(rows.map((r) => r.name)).toEqual(["Shots", "Crossfades", "Shot sound"]);
    expect(studioTrackPlan({ clips: [clip(0, 0)], lanes: 1, narrations: [] }, () => false, false)
      .map((r) => r.name)).toEqual(["Shots"]);
  });
});
