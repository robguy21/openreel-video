import { describe, expect, it } from "vitest";
import type { StudioManifest, StudioShot } from "./studio-client";
import { isStaleFinal, staleOf } from "./studio-session";

function shot(id: string, extra: Partial<StudioShot> = {}): StudioShot {
  return {
    id,
    order: 0,
    summary: "A shot",
    length_frames: null,
    line: {},
    take_id: null,
    video: { asset: `finals/${id}.mp4`, url: `/v/${id}`, duration_s: 4, bytes: 1 },
    narration: null,
    include_vo: false,
    gap_s: 0,
    crossfade_s: 0,
    location_ref: null,
    ...extra,
  };
}

function manifest(shots: StudioShot[], extra: Partial<StudioManifest> = {}): StudioManifest {
  return {
    project: { id: "p1", name: "Film" },
    fps: 24,
    shots,
    stitch_export: null,
    editor_export: null,
    editor_saved: false,
    editor_ts: null,
    generated: 0,
    ...extra,
  };
}

describe("staleOf", () => {
  it("is nothing for a manifest with no mark (and for a studio before it)", () => {
    expect(staleOf(manifest([shot("a"), shot("b")]))).toEqual({ staleAssets: [], staleNote: "" });
  });

  it("takes the marked clips' video assets and the studio's own sentence", () => {
    const m = manifest([shot("a"), shot("b", { stale_final: true })], {
      stale_finals: ["Part 1 · Scene 1 · Shot 2"],
      stale_note: "Final out of date (settings changed): Part 1 · Scene 1 · Shot 2.",
    });
    expect(staleOf(m)).toEqual({
      staleAssets: ["finals/b.mp4"],
      staleNote: "Final out of date (settings changed): Part 1 · Scene 1 · Shot 2.",
    });
  });

  it("never writes the mark into a shot's summary, which names the files", () => {
    const m = manifest([shot("b", { stale_final: true })], { stale_note: "x" });
    staleOf(m);
    expect(m.shots[0].summary).toBe("A shot");
  });
});

describe("isStaleFinal", () => {
  const media = {
    m1: { url: "/v/a", asset: "finals/a.mp4", name: "a", type: "video" as const },
    m2: { url: "/v/b", asset: "finals/b.mp4", name: "b", type: "video" as const },
  };
  it("marks the clip whose media item is a marked final's asset, and only that one", () => {
    const state = { media, staleAssets: ["finals/b.mp4"] };
    expect(isStaleFinal(state, "m2")).toBe(true);
    expect(isStaleFinal(state, "m1")).toBe(false);
    expect(isStaleFinal(state, "unknown")).toBe(false);
  });
});
