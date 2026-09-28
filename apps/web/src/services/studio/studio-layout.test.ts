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
    video: { asset: `assets/v${i}.mp4`, url: `/v${i}`, duration_s: 124 / FPS, bytes: 1, frames: 124 },
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
    const { clips, leadIns, narrations, lanes } = planTimeline([shot(0), shot(1)], FPS, whole);
    const plain = { lane: 0, pictureIn: 0, pictureOut: 0, soundFadeIn: 0, soundFadeOut: 0, volume: 1 };
    expect(clips).toEqual([
      { shot: 0, startTime: 0, inPoint: 0, outPoint: 124 / FPS, ...plain },
      { shot: 1, startTime: 124 / FPS, inPoint: 0, outPoint: 124 / FPS, ...plain },
    ]);
    expect(leadIns).toEqual([]);
    expect(narrations).toEqual([]);
    expect(lanes).toBe(1);
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
      lane: 0,
      pictureIn: 0,
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
    // 6 frames of gap, and a 12-frame fade over them and the last 6 frames of A
    expect(clips[1].startTime).toBe((113 + 6 - 12) / FPS);
    expect(clips[1]).toMatchObject({ lane: 1, pictureIn: 12 / FPS, soundFadeIn: 12 / FPS });
  });

  it("drops a gap and a fade into a continuation even if a studio sent them", () => {
    const a = shot(0, { end_frame: 107, gap_s: 0.25, crossfade_s: 0.5 });
    const b = shot(1, { start_frame: 22, continues: true });
    const { clips } = planTimeline([a, b], FPS, whole);
    expect(clips[1]).toMatchObject({ startTime: 107 / FPS, lane: 0, pictureIn: 0, soundFadeIn: 0 });
    expect(clips[0]).toMatchObject({ pictureOut: 0, soundFadeOut: 0 });
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

  it("runs an open end to the video's own frame count, not its container or its shot", () => {
    // Timing audit #10 and #12: a take that lost a frame is 157 frames in a 6.575 s
    // container, and its shot may have been re-lengthed since (length_frames 175).
    const v = { asset: "v.mp4", url: "/v", duration_s: 6.575, bytes: 1, frames: 157 };
    const shots = [shot(0, { video: v, length_frames: 175 }), shot(1)];
    const { clips } = planTimeline(shots, FPS, () => 6.575);
    expect(clips[0].outPoint).toBe(157 / FPS);
    expect(clips[1].startTime).toBe(157 / FPS);
  });

  it("from a studio that sends no frame count, takes whole frames of the media's length", () => {
    const v = { asset: "v.mp4", url: "/v", duration_s: 6.58, bytes: 1 };
    const { clips } = planTimeline([shot(0, { video: v, start_frame: 22 }), shot(1)], FPS, () => 6.575);
    expect(clips[0]).toMatchObject({ inPoint: 22 / FPS, outPoint: 157 / FPS });
    expect(clips[1].startTime).toBe((157 - 22) / FPS);
    // a healthy take whose duration is a hair under its frames still counts them all
    const h = { asset: "h.mp4", url: "/h", duration_s: 5.167, bytes: 1 };
    expect(planTimeline([shot(0, { video: h })], FPS, () => 5.1666).clips[0].outPoint).toBe(124 / FPS);
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
    expect(leadIns[0]).toMatchObject({
      from: 0,
      to: 1,
      startTime: clips[1].startTime,
      inPoint: 115 / FPS,
      volume: 1,
    });
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

describe("planTimeline: a crossfade overlaps, as the Film stitch's xfade does", () => {
  const faded = (i: number, over: Partial<StudioShot> = {}) => shot(i, { crossfade_s: 0.3, ...over });

  it("starts the next clip one fade early, on a whole number of frames, on the track above", () => {
    // 0.3 s at 24 fps is 7.2 frames: the fade is 7 frames, as the stitch rounds it
    const { clips, lanes } = planTimeline([faded(0), shot(1)], FPS, whole);
    expect(lanes).toBe(2);
    expect(clips[0]).toMatchObject({ lane: 0, pictureOut: 0, soundFadeOut: 7 / FPS });
    expect(clips[1]).toMatchObject({
      startTime: (124 - 7) / FPS,
      lane: 1,
      pictureIn: 7 / FPS,
      soundFadeIn: 7 / FPS,
    });
  });

  it("makes the film shorter by the fades, so every later clip is where the stitch puts it", () => {
    const shots = [faded(0), faded(1), faded(2), shot(3)];
    const { clips, lanes } = planTimeline(shots, FPS, whole);
    expect(clips.map((c) => c.startTime)).toEqual([0, 117 / FPS, 234 / FPS, 351 / FPS]);
    const last = clips[3];
    expect(last.startTime + last.outPoint - last.inPoint).toBe((4 * 124 - 3 * 7) / FPS);
    // a run of fades alternates between two tracks: the upper clip fades in over the one
    // below it, then out over the next one, which is laid under it
    expect(clips.map((c) => c.lane)).toEqual([0, 1, 0, 1]);
    expect(lanes).toBe(2);
    expect(clips[1]).toMatchObject({ pictureIn: 7 / FPS, pictureOut: 7 / FPS });
    expect(clips[2]).toMatchObject({
      pictureIn: 0,
      pictureOut: 0,
      soundFadeIn: 7 / FPS,
      soundFadeOut: 7 / FPS,
    });
    expect(clips[3]).toMatchObject({ pictureIn: 7 / FPS });
  });

  it("fades over the gap's black first, and only the rest of the fade over the clip before", () => {
    // gap 0.25 s = 6 frames, fade 7: one frame of the fade overlaps A
    const { clips } = planTimeline([faded(0, { gap_s: 0.25 }), shot(1)], FPS, whole);
    expect(clips[1]).toMatchObject({ startTime: (124 + 6 - 7) / FPS, lane: 1, pictureIn: 7 / FPS });
    expect(clips[0].soundFadeOut).toBe(1 / FPS);
  });

  it("lays a fade no longer than its gap on the same track, fading in from black", () => {
    const a = faded(0, { gap_s: 0.5 }); // 12 frames of gap, a 7-frame fade inside it
    const { clips, lanes } = planTimeline([a, shot(1)], FPS, whole);
    expect(lanes).toBe(1);
    expect(clips[1]).toMatchObject({ startTime: (124 + 12 - 7) / FPS, lane: 0, pictureIn: 7 / FPS });
    expect(clips[0].soundFadeOut).toBe(0);
  });

  it("puts a fade after a gap from an upper clip higher still, so the incoming one is on top", () => {
    const shots = [faded(0), faded(1, { gap_s: 0.25 }), shot(2)];
    const { clips, lanes } = planTimeline(shots, FPS, whole);
    expect(clips.map((c) => c.lane)).toEqual([0, 1, 2]);
    expect(lanes).toBe(3);
    expect(clips[1].pictureOut).toBe(0);
  });

  it("never fades over more than a clip has", () => {
    const short = shot(1, { end_frame: 5 });
    const { clips } = planTimeline([faded(0), short], FPS, whole);
    expect(clips[1]).toMatchObject({ startTime: (124 - 5) / FPS, soundFadeIn: 5 / FPS });
  });

  it("does not fade into a continuation", () => {
    const b = shot(1, { start_frame: 22, continues: true });
    const { clips, lanes } = planTimeline([faded(0, { end_frame: 107 }), b], FPS, whole);
    expect(lanes).toBe(1);
    expect(clips[1]).toMatchObject({ startTime: 107 / FPS, lane: 0, soundFadeIn: 0 });
  });

  it("fades across a shot with no take to the next one that has one", () => {
    const { clips } = planTimeline([faded(0), shot(1, { video: null }), shot(2)], FPS, whole);
    expect(clips[1]).toMatchObject({ shot: 2, startTime: 117 / FPS, lane: 1 });
  });
});

describe("planTimeline: narration, as the Film stitch mixes it", () => {
  const narr = { url: "/n", asset: "n.mp3", duration_s: 3, bytes: 1, text: "Hello", stale: false };
  const timing = { narrationDelayMs: 250, narrationDuck: 0.45 };

  it("starts it narration_delay_ms into its shot and ducks the take's sound under it", () => {
    const { clips, narrations } = planTimeline([shot(0), shot(1, { narration: narr })], FPS, whole, timing);
    expect(narrations).toEqual([{ shot: 1, startTime: 124 / FPS + 0.25 }]);
    expect(clips.map((c) => c.volume)).toEqual([1, 0.45]);
  });

  it("starts it from where a crossfaded clip starts, the start of its part", () => {
    const { clips, narrations } = planTimeline(
      [shot(0, { crossfade_s: 0.3 }), shot(1, { narration: narr })],
      FPS,
      whole,
      timing,
    );
    expect(narrations[0].startTime).toBe(clips[1].startTime + 0.25);
  });

  it("lays none for a shot whose narration is off, and ducks nothing there", () => {
    const { clips, narrations } = planTimeline(
      [shot(0, { narration: narr, include_vo: false })],
      FPS,
      whole,
      timing,
    );
    expect(narrations).toEqual([]);
    expect(clips[0].volume).toBe(1);
  });

  it("ducks a lead-in with the sound it goes under", () => {
    const a = shot(0, { end_frame: 115 });
    const b = shot(1, { start_frame: 1, continues: true, lead_in_ms: 60, narration: narr });
    expect(planTimeline([a, b], FPS, whole, timing).leadIns[0].volume).toBe(0.45);
  });

  it("from a studio that sends no numbers, lays it at the shot's start over full sound", () => {
    const { clips, narrations } = planTimeline([shot(0, { narration: narr })], FPS, whole);
    expect(narrations).toEqual([{ shot: 0, startTime: 0 }]);
    expect(clips[0].volume).toBe(1);
  });

  it("asks the caller which shots really have a narration laid", () => {
    const { narrations, clips } = planTimeline([shot(0, { narration: narr })], FPS, whole, {
      ...timing,
      narrated: () => false,
    });
    expect(narrations).toEqual([]);
    expect(clips[0].volume).toBe(1);
  });
});
