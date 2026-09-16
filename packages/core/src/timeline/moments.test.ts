import { describe, expect, it } from "vitest";
import type { Project, Track } from "../types";
import type { Action } from "../types/actions";
import {
  createMoment,
  getMoment,
  isMomentClip,
  MOMENT_MEDIA_PREFIX,
  momentTrackRole,
} from "../types/moments";
import { ActionExecutor } from "../actions/action-executor";
import { ActionHistory } from "../actions/action-history";
import { calculateProjectDuration } from "./project-duration";
import { resolveTimelinePlacement } from "./timeline-placement";
import { trackHasAudioItems, trackHasVisualItems } from "./timeline-items";

function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: "track-moments",
    type: "moments",
    name: "Moments",
    clips: [],
    transitions: [],
    locked: false,
    hidden: false,
    muted: false,
    solo: false,
    ...overrides,
  };
}

function makeProject(tracks: Track[] = [makeTrack()]): Project {
  return {
    id: "p1",
    name: "Test",
    createdAt: 0,
    modifiedAt: 0,
    settings: {
      width: 1920,
      height: 1080,
      frameRate: 30,
      sampleRate: 48000,
      channels: 2,
    },
    timeline: { duration: 0, tracks, subtitles: [], markers: [] },
    mediaLibrary: { items: [] },
  } as unknown as Project;
}

function addMomentAction(
  clipId: string,
  startTime = 2,
  overrides: Record<string, unknown> = {},
): Action {
  return {
    type: "clip/add",
    id: `action-${clipId}`,
    timestamp: 0,
    params: {
      trackId: "track-moments",
      mediaId: `${MOMENT_MEDIA_PREFIX}${clipId}`,
      startTime,
      clipId,
      duration: 5,
      inPoint: 0,
      outPoint: 5,
      metadata: { moment: createMoment("quiz", { key: `k-${clipId}` }) },
      ...overrides,
    } as Action["params"],
  } as Action;
}

describe("createMoment", () => {
  it("builds a quiz with two empty options and a slug key", () => {
    const quiz = createMoment("quiz");
    expect(quiz.kind).toBe("quiz");
    expect(quiz.label).toBe("Quiz");
    expect(quiz.key).toMatch(/^quiz-[a-z0-9]{4}$/);
    if (quiz.kind !== "quiz") throw new Error("expected quiz");
    expect(quiz.options).toHaveLength(2);
    expect(quiz.options[0].id).not.toBe(quiz.options[1].id);
    expect(quiz.options.every((o) => o.text === "" && !o.correct)).toBe(true);
  });

  it("defaults product currency to ZAR and preserves label/key overrides", () => {
    const product = createMoment("product", { label: "Red Shoes", key: "shoes" });
    expect(product.kind).toBe("product");
    expect(product.label).toBe("Red Shoes");
    expect(product.key).toBe("shoes");
    if (product.kind !== "product") throw new Error("expected product");
    expect(product.currency).toBe("ZAR");
    expect(product.price).toBe(0);
  });

  it("slugifies the label into the key", () => {
    const promo = createMoment("promotion", { label: "Summer Sale!" });
    expect(promo.key).toMatch(/^summer-sale-[a-z0-9]{4}$/);
    expect(promo.kind).toBe("promotion");
  });
});

describe("moment clips through the action executor", () => {
  it("clip/add accepts a moment- mediaId without a media item and lands metadata", async () => {
    const executor = new ActionExecutor(new ActionHistory());
    const project = makeProject();

    const result = await executor.execute(addMomentAction("m1"), project);
    expect(result.success).toBe(true);

    const clip = project.timeline.tracks[0].clips[0];
    expect(clip.id).toBe("m1");
    expect(clip.mediaId).toBe("moment-m1");
    expect(clip.duration).toBe(5);
    expect(clip.inPoint).toBe(0);
    expect(clip.outPoint).toBe(5);
    expect(isMomentClip(clip)).toBe(true);
    expect(getMoment(clip)?.kind).toBe("quiz");
    expect(getMoment(clip)?.key).toBe("k-m1");
  });

  it("clip/add still rejects unknown non-moment media ids", async () => {
    const executor = new ActionExecutor(new ActionHistory());
    const project = makeProject();
    const result = await executor.execute(
      addMomentAction("x1", 0, { mediaId: "missing-media" }),
      project,
    );
    expect(result.success).toBe(false);
    expect(
      (result.error?.details as { errors?: Array<{ code: string }> })?.errors?.[0]
        ?.code,
    ).toBe("MEDIA_NOT_FOUND");
  });

  it("clip/setMetadata shallow-merges and undo restores the previous payload", async () => {
    const executor = new ActionExecutor(new ActionHistory());
    const project = makeProject();
    await executor.execute(addMomentAction("m1"), project);

    const before = getMoment(project.timeline.tracks[0].clips[0]);
    const next = createMoment("promotion", { label: "Promo", key: "promo-1" });
    const result = await executor.execute(
      {
        type: "clip/setMetadata",
        id: "set-1",
        timestamp: 1,
        params: { clipId: "m1", metadata: { moment: next, extra: true } },
      },
      project,
    );
    expect(result.success).toBe(true);

    const clip = project.timeline.tracks[0].clips[0];
    expect(getMoment(clip)?.kind).toBe("promotion");
    expect(getMoment(clip)?.key).toBe("promo-1");
    expect(clip.metadata?.extra).toBe(true);

    const undo = await executor.undo(project);
    expect(undo.success).toBe(true);
    const restored = project.timeline.tracks[0].clips[0];
    expect(getMoment(restored)).toEqual(before);
    expect(restored.metadata?.extra).toBeUndefined();
  });

  it("clip/setMetadata fails for a missing clip", async () => {
    const executor = new ActionExecutor(new ActionHistory());
    const project = makeProject();
    const result = await executor.execute(
      {
        type: "clip/setMetadata",
        id: "set-2",
        timestamp: 1,
        params: { clipId: "nope", metadata: { moment: createMoment("quiz") } },
      },
      project,
    );
    expect(result.success).toBe(false);
    expect(
      (result.error?.details as { errors?: Array<{ code: string }> })?.errors?.[0]
        ?.code,
    ).toBe("CLIP_NOT_FOUND");
  });

  it("track/add accepts the moments type and names it Moments", async () => {
    const executor = new ActionExecutor(new ActionHistory());
    const project = makeProject([]);
    const result = await executor.execute(
      {
        type: "track/add",
        id: "t1",
        timestamp: 0,
        params: { trackType: "moments" },
      },
      project,
    );
    expect(result.success).toBe(true);
    expect(project.timeline.tracks[0].type).toBe("moments");
    expect(project.timeline.tracks[0].name).toBe("Moments 1");
  });
});

describe("moments never affect duration or audio/visual capability", () => {
  it("calculateProjectDuration ignores moments tracks", async () => {
    const executor = new ActionExecutor(new ActionHistory());
    const project = makeProject();
    await executor.execute(addMomentAction("m1", 40), project);
    expect(project.timeline.tracks[0].clips[0].startTime).toBe(40);
    expect(calculateProjectDuration(project)).toBe(0);
  });

  it("moment clips carry no audio or visual items", async () => {
    const executor = new ActionExecutor(new ActionHistory());
    const project = makeProject();
    await executor.execute(addMomentAction("m1"), project);
    expect(trackHasAudioItems(project, "track-moments")).toBe(false);
    expect(trackHasVisualItems(project, "track-moments")).toBe(false);
  });
});

describe("moments track rules", () => {
  const firstRuleError = (result: { error?: { details?: unknown } }) =>
    (result.error?.details as { errors?: Array<{ code: string; message: string }> })
      ?.errors?.[0];

  const withMoments = async () => {
    const executor = new ActionExecutor(new ActionHistory());
    const videoTrack = makeTrack({ id: "track-video", type: "video", name: "V1" });
    const project = makeProject([makeTrack(), videoTrack]);
    (project.mediaLibrary as { items: unknown[] }).items = [
      { id: "media-1", type: "video", name: "a.mp4", metadata: { duration: 4 } },
    ];
    await executor.execute(addMomentAction("m1", 0), project); // 0..5
    await executor.execute(addMomentAction("m2", 10), project); // 10..15
    return { executor, project };
  };

  it("rejects a second moments track (add and duplicate)", async () => {
    const executor = new ActionExecutor(new ActionHistory());
    const project = makeProject();
    const add = await executor.execute(
      { type: "track/add", id: "t2", timestamp: 0, params: { trackType: "moments" } },
      project,
    );
    expect(add.success).toBe(false);
    expect(firstRuleError(add)?.message).toBe("Only one Moments track per project");

    const dup = await executor.execute(
      {
        type: "track/duplicate",
        id: "t3",
        timestamp: 0,
        params: { sourceTrackId: "track-moments" },
      },
      project,
    );
    expect(dup.success).toBe(false);
    expect(project.timeline.tracks.filter((t) => t.type === "moments")).toHaveLength(1);
  });

  it("rejects an overlapping add, move and trim", async () => {
    const { executor, project } = await withMoments();

    const add = await executor.execute(addMomentAction("m3", 3), project); // 3..8 hits m1
    expect(add.success).toBe(false);
    expect(firstRuleError(add)).toMatchObject({
      code: "OVERLAP_DETECTED",
      message: "Moments can't overlap",
    });

    const move = await executor.execute(
      { type: "clip/move", id: "mv", timestamp: 0, params: { clipId: "m1", startTime: 7 } },
      project,
    );
    expect(move.success).toBe(false);
    expect(firstRuleError(move)?.code).toBe("OVERLAP_DETECTED");

    const trim = await executor.execute(
      { type: "clip/trim", id: "tr", timestamp: 0, params: { clipId: "m1", outPoint: 11 } },
      project,
    );
    expect(trim.success).toBe(false);
    expect(firstRuleError(trim)?.code).toBe("OVERLAP_DETECTED");

    // Touching end-to-start is fine.
    const okMove = await executor.execute(
      { type: "clip/move", id: "mv2", timestamp: 0, params: { clipId: "m1", startTime: 5 } },
      project,
    );
    expect(okMove.success).toBe(true);
    const okTrim = await executor.execute(
      { type: "clip/trim", id: "tr2", timestamp: 0, params: { clipId: "m2", outPoint: 20 } },
      project,
    );
    expect(okTrim.success).toBe(true);
  });

  it("keeps moments on their track and media off it", async () => {
    const { executor, project } = await withMoments();

    const cross = await executor.execute(
      {
        type: "clip/move",
        id: "x",
        timestamp: 0,
        params: { clipId: "m1", startTime: 0, trackId: "track-video" },
      },
      project,
    );
    expect(cross.success).toBe(false);
    expect(firstRuleError(cross)?.message).toBe("Moments stay on the Moments track");

    const media = await executor.execute(
      {
        type: "clip/add",
        id: "md",
        timestamp: 0,
        params: { trackId: "track-moments", mediaId: "media-1", startTime: 20 },
      },
      project,
    );
    expect(media.success).toBe(false);
    expect(firstRuleError(media)?.message).toBe("Only moments can go on the Moments track");

    const mediaOnVideo = await executor.execute(
      {
        type: "clip/add",
        id: "md2",
        timestamp: 0,
        params: { trackId: "track-video", mediaId: "media-1", startTime: 0, clipId: "v1" },
      },
      project,
    );
    expect(mediaOnVideo.success).toBe(true);
    const mediaMove = await executor.execute(
      {
        type: "clip/move",
        id: "md3",
        timestamp: 0,
        params: { clipId: "v1", startTime: 30, trackId: "track-moments" },
      },
      project,
    );
    expect(mediaMove.success).toBe(false);
    expect(firstRuleError(mediaMove)?.message).toBe("Only moments can go on the Moments track");
  });

  it("stack-above placement never lands media on a moments track", async () => {
    const { project } = await withMoments();
    // Moments track sits directly above a video track whose slot is busy.
    const [moments, video] = project.timeline.tracks;
    const busyVideo = {
      ...video,
      clips: [
        {
          ...moments.clips[0],
          id: "v-busy",
          mediaId: "media-1",
          trackId: "track-video",
        },
      ],
    };
    const placement = resolveTimelinePlacement(
      { ...project, timeline: { ...project.timeline, tracks: [moments, busyVideo] } },
      { targetTrackId: "track-video", startTime: 0, duration: 4, policy: "stack-above" },
    );
    expect(placement.ok).toBe(true);
    if (placement.ok) {
      expect(placement.trackId).not.toBe("track-moments");
      expect(placement.createdTrack).toBeDefined();
    }
  });
});

describe("catalogue lane", () => {
  const firstRuleError = (result: { error?: { details?: unknown } }) =>
    (result.error?.details as { errors?: Array<{ code: string; message: string }> })
      ?.errors?.[0];
  const catalogueTrack = () =>
    makeTrack({ id: "track-catalogue", role: "catalogue", name: "Catalogue" });
  const catalogueAction = (clipId: string, startTime: number, trackId = "track-catalogue") =>
    addMomentAction(clipId, startTime, {
      trackId,
      metadata: { moment: createMoment("catalogue", { key: `c-${clipId}` }) },
    });

  it("createMoment('catalogue') defaults to two ZAR products and role catalogue", () => {
    const moment = createMoment("catalogue");
    expect(moment.kind).toBe("catalogue");
    expect(moment.label).toBe("Catalogue");
    if (moment.kind !== "catalogue") throw new Error("expected catalogue");
    expect(moment.title).toBe("");
    expect(moment.products).toHaveLength(2);
    expect(moment.products.every((p) => p.currency === "ZAR")).toBe(true);
    expect(momentTrackRole("catalogue")).toBe("catalogue");
    expect(momentTrackRole("quiz")).toBe("general");
  });

  it("lands on its own lane and may overlap a promotion on the general lane", async () => {
    const executor = new ActionExecutor(new ActionHistory());
    const project = makeProject([makeTrack(), catalogueTrack()]);
    const promo = await executor.execute(
      addMomentAction("p1", 0, {
        metadata: { moment: createMoment("promotion", { key: "p" }) },
      }),
      project,
    );
    expect(promo.success).toBe(true);
    const cat = await executor.execute(catalogueAction("c1", 2), project); // 2..7 overlaps 0..5
    expect(cat.success).toBe(true);
    expect(project.timeline.tracks[1].clips.map((c) => c.id)).toEqual(["c1"]);
  });

  it("refuses two catalogues overlapping on the catalogue lane", async () => {
    const executor = new ActionExecutor(new ActionHistory());
    const project = makeProject([catalogueTrack()]);
    await executor.execute(catalogueAction("c1", 0), project);
    const clash = await executor.execute(catalogueAction("c2", 3), project);
    expect(clash.success).toBe(false);
    expect(firstRuleError(clash)?.code).toBe("OVERLAP_DETECTED");
  });

  it("refuses a catalogue on the general lane and a quiz on the catalogue lane", async () => {
    const executor = new ActionExecutor(new ActionHistory());
    const project = makeProject([makeTrack(), catalogueTrack()]);
    const wrongLane = await executor.execute(catalogueAction("c1", 0, "track-moments"), project);
    expect(wrongLane.success).toBe(false);
    expect(firstRuleError(wrongLane)?.message).toBe("Catalogues have their own track");

    const quizOnCatalogue = await executor.execute(
      addMomentAction("q1", 0, { trackId: "track-catalogue" }),
      project,
    );
    expect(quizOnCatalogue.success).toBe(false);
    expect(firstRuleError(quizOnCatalogue)?.message).toBe("Catalogues have their own track");
  });

  it("allows one catalogue track next to the general lane, but not a second", async () => {
    const executor = new ActionExecutor(new ActionHistory());
    const project = makeProject([makeTrack()]);
    const first = await executor.execute(
      {
        type: "track/add",
        id: "t-cat",
        timestamp: 0,
        params: { trackType: "moments", role: "catalogue" },
      },
      project,
    );
    expect(first.success).toBe(true);
    expect(project.timeline.tracks[1]).toMatchObject({ type: "moments", role: "catalogue", name: "Catalogue" });
    const second = await executor.execute(
      {
        type: "track/add",
        id: "t-cat-2",
        timestamp: 0,
        params: { trackType: "moments", role: "catalogue" },
      },
      project,
    );
    expect(second.success).toBe(false);
    expect(firstRuleError(second)?.message).toBe("Only one Catalogue track per project");
  });
});
