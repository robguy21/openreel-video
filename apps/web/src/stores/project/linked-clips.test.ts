import "../../test/install-local-storage-mock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Clip, MediaItem, Project } from "@openreel/core";
import { useProjectStore } from "../project-store";
import { useUIStore } from "../ui-store";
import { clampInto, collapseLinked, edgeRange, partnerOf, partnerPoints } from "./linked-clips";

/**
 * Linked clips (docs/PROPOSAL_EDITOR_REDESIGN.md R8.6): a picture and its sound move, trim,
 * slip, split, are deleted, duplicated and pasted together, in one undo step each; a
 * selection made alone (Alt-click) edits one; Unlink lets them go.
 */

function media(id: string, type: MediaItem["type"], duration = 10): MediaItem {
  return {
    id,
    name: `${id}.${type === "audio" ? "wav" : "mp4"}`,
    type,
    fileHandle: null,
    blob: null,
    metadata: {
      duration,
      width: type === "audio" ? 0 : 1080,
      height: type === "audio" ? 0 : 1920,
      frameRate: 24,
      codec: "h264",
      sampleRate: 48000,
      channels: 2,
      fileSize: 1,
    },
    thumbnailUrl: null,
    waveformData: null,
  } as MediaItem;
}

function clip(id: string, trackId: string, mediaId: string, linkedClipId: string): Clip {
  return {
    id,
    mediaId,
    trackId,
    startTime: 2,
    duration: 4,
    inPoint: 1,
    outPoint: 5,
    effects: [],
    audioEffects: [],
    transform: {
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      anchor: { x: 0.5, y: 0.5 },
      opacity: 1,
    },
    volume: id === "p" ? 0 : 1,
    keyframes: [],
    linkedClipId,
  } as Clip;
}

function track(id: string, type: "video" | "audio", name: string, clips: Clip[]) {
  return { id, type, name, clips, transitions: [], locked: false, hidden: false, muted: false, solo: false };
}

/** Shots: picture "p" (2..6 s, source 1..5); Shot sound: its sound "s", the same span. */
function film(): Project {
  return {
    id: "linked",
    name: "Linked",
    createdAt: 0,
    modifiedAt: 0,
    settings: { width: 1080, height: 1920, frameRate: 24, sampleRate: 48000, channels: 2 },
    mediaLibrary: { items: [media("take", "video"), media("master", "audio")] },
    timeline: {
      tracks: [
        track("shots", "video", "Shots", [clip("p", "shots", "take", "s")]),
        track("sound", "audio", "Shot sound", [clip("s", "sound", "master", "p")]),
      ],
      subtitles: [],
      duration: 10,
      markers: [],
    },
  } as unknown as Project;
}

const store = () => useProjectStore.getState();
const get = (id: string) => partnerOf(store().project, id) && store().getClip(id);
const span = (id: string) => {
  const c = store().getClip(id);
  return c ? [c.startTime, c.duration, c.inPoint, c.outPoint].map((n) => +n.toFixed(4)) : null;
};

describe("the rules", () => {
  it("find a partner only when the link holds both ways, and collapse a selected pair", () => {
    const p = film();
    expect(partnerOf(p, "p")?.id).toBe("s");
    expect(collapseLinked(p, ["p", "s"])).toEqual(["p"]);
    expect(collapseLinked(p, ["s", "p"])).toEqual(["s"]);
    const broken = structuredClone(p);
    (broken.timeline.tracks[1].clips[0] as { linkedClipId?: string }).linkedClipId = "nobody";
    expect(partnerOf(broken, "p")).toBeUndefined();
    expect(collapseLinked(broken, ["p", "s"])).toEqual(["p", "s"]);
  });

  it("hold a trim inside every clip's own source and the tightest wins", () => {
    const c = { startTime: 2, duration: 4, inPoint: 1, outPoint: 5 };
    expect(edgeRange(c, "left", 10)).toEqual([-1, 3.9]);
    expect(edgeRange(c, "right", 6)).toEqual([-3.9, 1]);
    expect(clampInto(-3, [edgeRange(c, "left", 10), [-0.5, 3]])).toBe(-0.5);
    expect(partnerPoints({ inPoint: 1, outPoint: 5 }, { inPoint: 1, outPoint: 5 }, 1.5, undefined, 10))
      .toEqual({ inPoint: 1.5 });
  });
});

describe("a linked pair in the store", () => {
  beforeEach(() => {
    store().loadProject(film());
    useUIStore.getState().clearSelection();
  });
  afterEach(() => useUIStore.getState().clearSelection());

  it("is selected together, and one half alone with Alt", () => {
    useUIStore.getState().select({ type: "clip", id: "p", trackId: "shots" });
    expect(useUIStore.getState().getSelectedClipIds()).toEqual(["p", "s"]);
    useUIStore.getState().select({ type: "clip", id: "s", trackId: "sound" }, false, { alone: true });
    expect(useUIStore.getState().getSelectedClipIds()).toEqual(["s"]);
    expect(useUIStore.getState().linkAlone).toBe(true);
    useUIStore.getState().selectMultiple([{ type: "clip", id: "s", trackId: "sound" }]);
    expect(useUIStore.getState().getSelectedClipIds()).toEqual(["s", "p"]);
  });

  it("moves together, each on its own row, in one undo step", async () => {
    await store().moveClip("p", 5);
    expect(span("p")?.[0]).toBe(5);
    expect(span("s")?.[0]).toBe(5);
    expect(store().getClip("s")?.trackId).toBe("sound");
    await store().undo();
    expect([span("p")?.[0], span("s")?.[0]]).toEqual([2, 2]);
  });

  it("trims an edge as Premiere does: the head comes off, the frames stay put", async () => {
    await store().trimClipEdge("p", "left", 3);
    expect(span("p")).toEqual([3, 3, 2, 5]);
    expect(span("s")).toEqual([3, 3, 2, 5]);
    await store().trimClipEdge("s", "right", 5.5);
    expect(span("p")).toEqual([3, 2.5, 2, 4.5]);
    expect(span("s")).toEqual([3, 2.5, 2, 4.5]);
    // Never past the source: in may not go below 0, out not past 10.
    await store().trimClipEdge("p", "left", -5);
    expect(span("p")).toEqual([1, 4.5, 0, 4.5]);
    await store().trimClipEdge("p", "right", 50);
    expect(span("p")).toEqual([1, 10, 0, 10]);
    expect(span("s")).toEqual([1, 10, 0, 10]);
    await store().undo();
    expect(span("s")).toEqual([1, 4.5, 0, 4.5]);
  });

  it("trims both by the Reference monitor's marks", async () => {
    await store().trimClip("p", 1.5);
    expect(span("p")).toEqual([2, 3.5, 1.5, 5]);
    expect(span("s")).toEqual([2, 3.5, 1.5, 5]);
  });

  it("splits both, and the two right halves are a pair of their own", async () => {
    await store().splitClip("p", 4);
    const right = store().project.timeline.tracks.map((t) => t.clips.find((c) => c.startTime === 4));
    expect(right[0]?.linkedClipId).toBe(right[1]?.id);
    expect(right[1]?.linkedClipId).toBe(right[0]?.id);
    expect(store().getClip("p")?.linkedClipId).toBe("s");
    await store().undo();
    expect(store().project.timeline.tracks.map((t) => t.clips.length)).toEqual([1, 1]);
  });

  it("deletes and ripple-deletes both, and slips both", async () => {
    await store().slipClip("p", 0.5);
    expect(span("s")?.[2]).toBe(1.5);
    await store().removeClip("p");
    expect(store().project.timeline.tracks.map((t) => t.clips.length)).toEqual([0, 0]);
    await store().undo();
    expect(get("p")).toBeTruthy();
    await store().rippleDeleteClip("s");
    expect(store().project.timeline.tracks.map((t) => t.clips.length)).toEqual([0, 0]);
  });

  it("duplicates and pastes as a linked pair", async () => {
    await store().duplicateClip("p");
    const copies = store().project.timeline.tracks.map((t) => t.clips.find((c) => c.id !== "p" && c.id !== "s"));
    expect(copies[0]?.startTime).toBe(6);
    expect(copies[1]?.startTime).toBe(6);
    expect(copies[0]?.linkedClipId).toBe(copies[1]?.id);

    store().copyClips(["p", "s"]);
    await store().pasteClips("shots", 20);
    const pasted = store().lastPastedClipIds.map((id) => store().getClip(id)!);
    expect(pasted).toHaveLength(2);
    expect(pasted[0].linkedClipId).toBe(pasted[1].id);
    expect(pasted[1].linkedClipId).toBe(pasted[0].id);
  });

  it("edits one half alone when the selection says so, and unlinks and relinks", async () => {
    useUIStore.getState().select({ type: "clip", id: "s", trackId: "sound" }, false, { alone: true });
    await store().moveClip("s", 7);
    expect([span("p")?.[0], span("s")?.[0]]).toEqual([2, 7]);
    useUIStore.getState().clearSelection();

    await store().unlinkClip("p");
    expect(store().getClip("p")?.linkedClipId).toBeUndefined();
    expect(store().getClip("s")?.linkedClipId).toBeUndefined();
    await store().moveClip("p", 3);
    expect(span("s")?.[0]).toBe(7);
    await store().linkClips("p", "s");
    expect(partnerOf(store().project, "p")?.id).toBe("s");
  });
});
