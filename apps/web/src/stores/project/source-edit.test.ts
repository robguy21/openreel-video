import "../../test/install-local-storage-mock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MediaItem, Project } from "@openreel/core";
import { useProjectStore } from "../project-store";
import { useTimelineStore } from "../timeline-store";
import { useUIStore } from "../ui-store";
import { setSoundFileMaker } from "./clip-slice";
import { film } from "./linked-clips.test.helpers";

/**
 * Insert and Overwrite from the Reference (docs/PROPOSAL_EDITOR_REDESIGN.md R7): the take
 * "take" is on Shots 2..6 with its sound "master" linked under it on Shot sound.
 */

const store = () => useProjectStore.getState();

function rows(): Record<string, string[]> {
  return Object.fromEntries(
    store().project.timeline.tracks.map((t) => [
      t.name,
      [...t.clips]
        .sort((a, b) => a.startTime - b.startTime)
        .map((c) => `${c.mediaId}@${c.startTime}+${c.duration}${c.linkedClipId ? " linked" : ""} v${c.volume}`),
    ]),
  );
}

function withOwnVideo(): Project {
  const p = film();
  const own = { ...p.mediaLibrary.items[0], id: "own", name: "own.mp4" } as MediaItem;
  return { ...p, mediaLibrary: { items: [...p.mediaLibrary.items, own] } } as Project;
}

describe("placing the Reference's span", () => {
  beforeEach(() => {
    store().loadProject(film());
    useUIStore.getState().clearSelection();
    useTimelineStore.getState().seekTo(2);
  });
  afterEach(() => {
    setSoundFileMaker(null);
    useUIStore.getState().clearSelection();
  });

  it("inserts a studio take's span with its own sound, linked, and moves the rest on", async () => {
    const result = await store().placeFromSource("insert", { mediaId: "take", inPoint: 1, outPoint: 3 });
    expect(result.success).toBe(true);
    expect(rows()).toEqual({
      Shots: ["take@2+2 linked v0", "take@4+4 linked v0"],
      "Shot sound": ["master@2+2 linked v1", "master@4+4 linked v1"],
    });
    // the playhead goes to the end of what was placed, as Premiere's does
    expect(useTimelineStore.getState().playheadPosition).toBe(4);
  });

  it("overwrites with no marks as the whole source, and undo puts both rows back in one step", async () => {
    useTimelineStore.getState().seekTo(0);
    await store().placeFromSource("overwrite", { mediaId: "take", inPoint: null, outPoint: null });
    expect(rows().Shots).toEqual(["take@0+10 linked v0"]);
    expect(rows()["Shot sound"]).toEqual(["master@0+10 linked v1"]);
    await store().undo();
    expect(rows()).toEqual({
      Shots: ["take@2+4 linked v0"],
      "Shot sound": ["master@2+4 linked v1"],
    });
  });

  it("gives a video of the user's own its sound as a file of its own, under the picture", async () => {
    store().loadProject(withOwnVideo());
    setSoundFileMaker(async () => "master");
    useTimelineStore.getState().seekTo(8);
    await store().placeFromSource("overwrite", { mediaId: "own", inPoint: 0, outPoint: 1 });
    expect(rows().Shots).toContain("own@8+1 linked v0");
    expect(rows()["Shot sound"]).toContain("master@8+1 linked v1");
  });

  it("places a sound file on the sound row only", async () => {
    useTimelineStore.getState().seekTo(8);
    await store().placeFromSource("overwrite", { mediaId: "master", inPoint: 0, outPoint: 1 });
    expect(rows().Shots).toEqual(["take@2+4 linked v0"]);
    expect(rows()["Shot sound"]).toContain("master@8+1 v1");
  });

  it("says why when there is nothing to place", async () => {
    const empty = await store().placeFromSource("insert", { mediaId: "take", inPoint: 3, outPoint: 3 });
    expect(empty.success).toBe(false);
    expect(empty.error?.message).toMatch(/In before the Out/);
    const missing = await store().placeFromSource("insert", { mediaId: "gone", inPoint: 0, outPoint: 1 });
    expect(missing.success).toBe(false);
  });
});
