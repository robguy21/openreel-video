import "../../../test/install-local-storage-mock";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaItem, Project } from "@openreel/core";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useUIStore } from "../../../stores/ui-store";
import { useStudioStore } from "../../../services/studio/studio-session";
import {
  clampClipMark,
  clipMarks,
  sourceTimeAt,
  useReferenceStore,
} from "../../../stores/reference-store";
import { mediaPlaybackUrl } from "../../../services/media-playback-url";
import { cutEdges, nearestCut } from "./cuts";
import { formatTimecode, referenceSubtitle } from "./ReferenceMonitor";
import { clampSplit } from "./MonitorStage";
import { referenceFromMedia, useReferenceSource } from "./useReferenceSource";

/** The Reference monitor and the Edit monitor's transport (docs/PROPOSAL_EDITOR_REDESIGN.md
 *  R5, R6.2; the stitched film as the default source, Robert 2026-09-28). */

const frame = 1 / 24;

describe("a mark on a timeline clip", () => {
  const clip = { id: "b", startTime: 4, inPoint: 1, outPoint: 3 }; // on the timeline 4..6
  const track = [
    { id: "a", startTime: 0 },
    clip,
    { id: "c", startTime: 7 }, // one second of room after b
  ];

  it("trims within the source and leaves a frame between In and Out", () => {
    expect(clampClipMark("in", 1.5, clip, track, 10, frame)).toBe(1.5);
    expect(clampClipMark("in", 5, clip, track, 10, frame)).toBeCloseTo(3 - frame);
    expect(clampClipMark("out", 0.5, clip, track, 10, frame)).toBeCloseTo(1 + frame);
    expect(clampClipMark("out", 2.5, clip, track, 10, frame)).toBe(2.5);
  });

  it("never runs the clip into the next one, since its start does not move", () => {
    // Out later lengthens the end: at most one second more before c.
    expect(clampClipMark("out", 9, clip, track, 10, frame)).toBe(4);
    // In earlier lengthens the end too: at most one second earlier, and not before 0.
    expect(clampClipMark("in", -2, clip, track, 10, frame)).toBe(0);
    expect(clampClipMark("in", 0, { ...clip, inPoint: 2.5, outPoint: 4.5 }, track, 10, frame)).toBe(1.5);
  });

  it("stops at the end of the source", () => {
    expect(clampClipMark("out", 9, clip, [clip], 3.5, frame)).toBe(3.5);
  });

  it("reads a clip's marks and the source time under the playhead", () => {
    expect(clipMarks({ inPoint: 1, outPoint: 3 })).toEqual({ in: 1, out: 3 });
    const onTimeline = { startTime: 4, duration: 2, inPoint: 1 };
    expect(sourceTimeAt(onTimeline, 5)).toBe(2);
    expect(sourceTimeAt(onTimeline, 0)).toBe(1); // before the clip: its first frame
    expect(sourceTimeAt(onTimeline, 99)).toBe(3); // after it: its last
  });
});

describe("the Edit monitor's cuts", () => {
  const tracks = [
    { type: "video" as const, clips: [{ startTime: 0, duration: 4 }, { startTime: 4, duration: 3 }] },
    { type: "video" as const, clips: [{ startTime: 5.5, duration: 1 }] },
    { type: "audio" as const, clips: [{ startTime: 2, duration: 1 }] },
  ] as unknown as Parameters<typeof cutEdges>[0];

  it("are every video clip edge, and never an audio one", () => {
    expect(cutEdges(tracks)).toEqual([0, 4, 5.5, 6.5, 7]);
  });

  it("go to the nearest edge before or after the playhead, moving on from one it is on", () => {
    const edges = cutEdges(tracks);
    expect(nearestCut(edges, 4.5, 1)).toBe(5.5);
    expect(nearestCut(edges, 4.5, -1)).toBe(4);
    expect(nearestCut(edges, 4, -1)).toBe(0);
    expect(nearestCut(edges, 4, 1)).toBe(5.5);
    expect(nearestCut(edges, 7, 1)).toBeNull();
  });
});

describe("the Reference's words and numbers", () => {
  it("counts time in minutes, seconds and frames of the source's own rate", () => {
    expect(formatTimecode(0, 24)).toBe("00:00:00");
    expect(formatTimecode(1 + 10 / 24, 24)).toBe("00:01:10");
    expect(formatTimecode(125.5, 30)).toBe("02:05:15");
    expect(formatTimecode(Number.NaN, 24)).toBe("00:00:00");
  });

  it("says what it holds", () => {
    expect(referenceSubtitle(null)).toBe("nothing picked");
    expect(
      referenceSubtitle({ key: "film", origin: "film", name: "Recovery · Part 1", kind: "video", fps: 24 }),
    ).toBe("Recovery · Part 1, the part's cut");
    expect(
      referenceSubtitle({ key: "m", origin: "media", name: "Shot 04 · take 2", kind: "video", fps: 24 }),
    ).toBe("Shot 04 · take 2, whole");
  });

  it("plays a blob through an object url it revokes, and a studio asset by its url", () => {
    const create = vi.fn(() => "blob:one");
    const revoke = vi.fn();
    const made = mediaPlaybackUrl({ blob: new Blob(["x"]), originalUrl: "/api/x" }, create, revoke);
    expect(made.url).toBe("blob:one");
    made.revoke();
    expect(revoke).toHaveBeenCalledWith("blob:one");
    const plain = mediaPlaybackUrl({ blob: null, originalUrl: "/api/x" }, create, revoke);
    expect(plain.url).toBe("/api/x");
    plain.revoke();
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(mediaPlaybackUrl(null).url).toBeNull();
  });

  it("keeps each monitor at least 280 px when the split is dragged", () => {
    expect(clampSplit(0.5, 1012)).toBe(0.5);
    expect(clampSplit(0.05, 1012)).toBeCloseTo(280 / 1000);
    expect(clampSplit(0.99, 1012)).toBeCloseTo(1 - 280 / 1000);
    expect(clampSplit(0.2, 500)).toBe(0.5); // too narrow for both: half each
  });
});

function item(id: string, type: MediaItem["type"]): MediaItem {
  return {
    id,
    name: `${id}.mp4`,
    type,
    fileHandle: null,
    blob: null,
    originalUrl: `/api/projects/p/asset?path=${id}`,
    metadata: { duration: 6, width: 1080, height: 1920, frameRate: 24, codec: "h264", sampleRate: 48000, channels: 2, fileSize: 1 },
    thumbnailUrl: null,
    waveformData: null,
  } as MediaItem;
}

function film(): Project {
  const project = createEmptyProject("Reference");
  return {
    ...project,
    mediaLibrary: { items: [item("take-1", "video")] },
    timeline: {
      ...project.timeline,
      duration: 10,
      tracks: [
        {
          id: "shots",
          type: "video",
          name: "Shots",
          clips: [
            {
              id: "clip-1",
              mediaId: "take-1",
              trackId: "shots",
              startTime: 2,
              duration: 3,
              inPoint: 0.5,
              outPoint: 3.5,
              effects: [],
              audioEffects: [],
              transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1 },
              volume: 1,
              keyframes: [],
            },
          ],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
      ],
    },
  } as Project;
}

describe("what the Reference holds", () => {
  beforeEach(() => {
    useReferenceStore.setState({ source: null, marks: {} });
    useProjectStore.setState({ project: film() });
    useTimelineStore.setState({ playheadPosition: 3 });
    useUIStore.getState().clearSelection();
  });
  afterEach(() => {
    cleanup();
    useStudioStore.setState({ pid: null, stitchFilm: null, name: "", partLabel: "" });
  });

  it("is the part as Stitch cut it until something else is picked", () => {
    useStudioStore.setState({
      pid: "p0123456789",
      name: "Recovery",
      partLabel: "Part 1",
      stitchFilm: { url: "/api/stitched.mp4", asset: "exports/x.mp4", duration: 57, fps: 24 },
    });
    renderHook(() => useReferenceSource());
    const source = useReferenceStore.getState().source;
    expect(source).toMatchObject({ origin: "film", url: "/api/stitched.mp4", name: "Recovery · Part 1", fps: 24 });
  });

  it("is empty when the studio offers no Stitch cut", () => {
    useStudioStore.setState({ pid: "p0123456789", stitchFilm: null });
    renderHook(() => useReferenceSource());
    expect(useReferenceStore.getState().source).toBeNull();
  });

  it("takes the whole source behind a selected timeline clip, at its current frame, marked by it", () => {
    renderHook(() => useReferenceSource());
    act(() => useUIStore.getState().select({ type: "clip", id: "clip-1", trackId: "shots" }));
    const { source, marks } = useReferenceStore.getState();
    expect(source).toMatchObject({ origin: "clip", clipId: "clip-1", mediaId: "take-1", startAt: 1.5 });
    expect(marks["clip:clip-1"]).toEqual({ in: 0.5, out: 3.5 });
  });

  it("is left alone by a library item selection and by selecting nothing", () => {
    renderHook(() => useReferenceSource());
    act(() => useUIStore.getState().select({ type: "clip", id: "clip-1", trackId: "shots" }));
    act(() => useUIStore.getState().select({ type: "clip", id: "take-1" }));
    act(() => useUIStore.getState().clearSelection());
    expect(useReferenceStore.getState().source?.clipId).toBe("clip-1");
  });

  it("describes a clicked media item whole, at its own frame rate", () => {
    expect(referenceFromMedia(item("take-1", "video"), 30)).toMatchObject({
      key: "media:take-1",
      origin: "media",
      kind: "video",
      fps: 24,
      duration: 6,
    });
  });
});
