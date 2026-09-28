import { describe, expect, it } from "vitest";
import type { StudioShot } from "./studio-client";
import { planTimeline } from "./studio-layout";

const FPS = 24;

/** A manifest shot with a 124-frame take (5.1667 s) and its master, and nothing else. */
function shot(i: number, over: Partial<StudioShot> = {}): StudioShot {
  return {
    id: `s${i}`,
    order: i,
    summary: `Shot ${i + 1}`,
    length_frames: 121,
    line: {},
    take_id: `t${i}`,
    video: { asset: `assets/v${i}.mp4`, url: `/v${i}`, duration_s: 124 / FPS, bytes: 1 },
    audio: { asset: `assets/a${i}.flac`, url: `/a${i}`, duration_s: 5.175, bytes: 1, source: "h3" },
    narration: null,
    include_vo: true,
    gap_s: 0,
    crossfade_s: 0,
    location_ref: null,
    ...over,
  };
}

const whole = (s: StudioShot) => s.video?.duration_s || 0;

describe("planTimeline: cut points", () => {
  it("lays a studio from before chaining whole and end to end, as it always did", () => {
    const { clips, leadIns } = planTimeline([shot(0), shot(1)], FPS, whole);
    expect(clips).toEqual([
      { shot: 0, startTime: 0, inPoint: 0, outPoint: 124 / FPS, crossfadeIn: 0 },
      { shot: 1, startTime: 124 / FPS, inPoint: 0, outPoint: 124 / FPS, crossfadeIn: 0 },
    ]);
    expect(leadIns).toEqual([]);
  });

  it("cuts an overlap seam where the stitch does: A ends on its pin, B drops its repeat", () => {
    const a = shot(0, { start_frame: 0, end_frame: 107, continues: false });
    const b = shot(1, { start_frame: 22, end_frame: null, continues: true });
    const { clips } = planTimeline([a, b], FPS, whole);
    expect(clips[0]).toMatchObject({ startTime: 0, inPoint: 0, outPoint: 107 / FPS });
    // butted on A's last kept frame, no gap and no transition
    expect(clips[1]).toMatchObject({
      startTime: 107 / FPS,
      inPoint: 22 / FPS,
      outPoint: 124 / FPS,
      crossfadeIn: 0,
    });
  });

  it("starts every clip on an exact frame instant, the time the export renders it at", () => {
    const shots = [
      shot(0, { end_frame: 115 }),
      shot(1, { start_frame: 1, end_frame: 91, continues: true }),
      shot(2, { start_frame: 1, continues: true }),
    ];
    const { clips } = planTimeline(shots, FPS, whole);
    expect(clips.map((c) => c.startTime)).toEqual([0, 115 / FPS, (115 + 90) / FPS]);
  });

  it("keeps the author's gap and crossfade at a chained cut that does not continue", () => {
    const a = shot(0, { end_frame: 113, gap_s: 0.25, crossfade_s: 0.5 });
    const b = shot(1, { start_frame: 0, continues: false });
    const { clips } = planTimeline([a, b], FPS, whole);
    expect(clips[1].startTime).toBeCloseTo(113 / FPS + 0.25, 9);
    expect(clips[1].crossfadeIn).toBe(0.5);
  });

  it("drops a gap and a fade into a continuation even if a studio sent them", () => {
    const a = shot(0, { end_frame: 107, gap_s: 0.25, crossfade_s: 0.5 });
    const b = shot(1, { start_frame: 22, continues: true });
    const { clips } = planTimeline([a, b], FPS, whole);
    expect(clips[1]).toMatchObject({ startTime: 107 / FPS, crossfadeIn: 0 });
  });

  it("holds an end past the file to the file, and lays a span that cannot be right whole", () => {
    const { clips } = planTimeline(
      [shot(0, { end_frame: 500 }), shot(1, { start_frame: 124, end_frame: 124 })],
      FPS,
      whole,
    );
    expect(clips[0].outPoint).toBe(124 / FPS);
    expect(clips[1]).toMatchObject({ inPoint: 0, outPoint: 124 / FPS });
  });

  it("uses the imported media's own length for an open end", () => {
    const { clips } = planTimeline([shot(0, { start_frame: 22 })], FPS, () => 5.162);
    expect(clips[0]).toMatchObject({ inPoint: 22 / FPS, outPoint: 5.162 });
  });

  it("skips a shot with no take and does not count it as the shot before", () => {
    const shots = [shot(0), shot(1, { video: null }), shot(2)];
    const { clips } = planTimeline(shots, FPS, whole);
    expect(clips.map((c) => [c.shot, c.startTime])).toEqual([
      [0, 0],
      [2, 124 / FPS],
    ]);
  });
});

describe("planTimeline: the lead-in under a chained cut", () => {
  it("lays the previous shot's sound from its out point, lead_in_ms long, at the next clip's start", () => {
    const a = shot(0, { end_frame: 115 });
    const b = shot(1, { start_frame: 1, continues: true, lead_in_ms: 60 });
    const { leadIns, clips } = planTimeline([a, b], FPS, whole);
    expect(leadIns).toHaveLength(1);
    expect(leadIns[0]).toMatchObject({ from: 0, to: 1, startTime: clips[1].startTime, inPoint: 115 / FPS });
    expect(leadIns[0].duration).toBeCloseTo(0.06, 12);
  });

  it("lays none where the studio sends none, or 0", () => {
    const a = shot(0, { end_frame: 115 });
    expect(planTimeline([a, shot(1, { start_frame: 1, continues: true })], FPS, whole).leadIns).toEqual([]);
    expect(
      planTimeline([a, shot(1, { start_frame: 1, continues: true, lead_in_ms: 0 })], FPS, whole).leadIns,
    ).toEqual([]);
  });

  it("lays none without the previous shot's sound, its cut point or its clip", () => {
    const b = shot(1, { start_frame: 1, continues: true, lead_in_ms: 60 });
    expect(planTimeline([shot(0, { end_frame: 115, audio: null }), b], FPS, whole).leadIns).toEqual([]);
    expect(planTimeline([shot(0, { end_frame: null }), b], FPS, whole).leadIns).toEqual([]);
    expect(planTimeline([shot(0, { end_frame: 115, video: null }), b], FPS, whole).leadIns).toEqual([]);
  });

  it("stops the lead-in where the previous sound ends", () => {
    const a = shot(0, { end_frame: 124 });
    const b = shot(1, { continues: false, lead_in_ms: 60 });
    const { leadIns } = planTimeline([a, b], FPS, whole);
    expect(leadIns[0].duration).toBeCloseTo(5.175 - 124 / FPS, 9);
  });
});
