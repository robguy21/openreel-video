/**
 * importMedia and replaceMediaAsset read the file (the media bridge's decode) and only then
 * add the item to the project - the project as it is AFTER the decode, so an edit made
 * meanwhile survives, and nothing lands in a different project opened meanwhile.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({ hold: null as Promise<void> | null }));

vi.mock("../../bridges/media-bridge", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../bridges/media-bridge")>();
  const fake = {
    isInitialized: () => true,
    importFile: async (file: File) => {
      if (bridge.hold) await bridge.hold;
      return {
        success: true,
        media: {
          blob: file,
          thumbnails: [],
          waveformData: null,
          metadata: {
            duration: 3, width: 0, height: 0, frameRate: 0, codec: "flac", sampleRate: 44100,
            channels: 2, hasVideo: false, hasAudio: true,
          },
        },
      };
    },
    generateThumbnailsForMedia: async () => [],
  };
  return { ...real, getMediaBridge: () => fake, initializeMediaBridge: async () => fake };
});
vi.mock("../../services/media-storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/media-storage")>()),
  saveMediaBlob: vi.fn(async () => {}),
  deleteMediaBlob: vi.fn(async () => {}),
}));

import { useProjectStore } from "../project-store";

function held() {
  let release!: () => void;
  bridge.hold = new Promise<void>((r) => (release = r));
  return () => {
    bridge.hold = null;
    release();
  };
}

const file = (name: string) => new File(["fLaC"], name, { type: "audio/flac" });
const store = () => useProjectStore.getState();

beforeEach(() => {
  bridge.hold = null;
  store().createNewProject("Media slice", { width: 832, height: 480, frameRate: 24 });
});

describe("importMedia", () => {
  it("keeps an edit made while the file was being read, and adds the item", async () => {
    const release = held();
    const importing = store().importMedia(file("Song.flac"));
    const tracksBefore = store().project.timeline.tracks.length;
    await store().addTrack("audio", undefined, { name: "Made during the decode" });
    release();
    const r = await importing;
    expect(r.success).toBe(true);
    expect(store().project.timeline.tracks.length).toBe(tracksBefore + 1);
    expect(store().project.timeline.tracks.some((t) => t.name === "Made during the decode")).toBe(true);
    expect(store().project.mediaLibrary.items.map((m) => m.name)).toEqual(["Song.flac"]);
  });

  it("refuses to land in another project opened while the file was being read", async () => {
    const release = held();
    const importing = store().importMedia(file("Song.flac"));
    store().createNewProject("Another", { width: 832, height: 480, frameRate: 24 });
    const other = store().project.id;
    release();
    const r = await importing;
    expect(r.success).toBe(false);
    expect(r.error?.message).toBe("The project changed while this was being imported.");
    expect(store().project.id).toBe(other);
    expect(store().project.mediaLibrary.items).toEqual([]);
  });
});

describe("replaceMediaAsset", () => {
  it("keeps an edit made while the file was being read", async () => {
    await store().importMedia(file("Old.flac"));
    const id = store().project.mediaLibrary.items[0].id;
    const release = held();
    const replacing = store().replaceMediaAsset(id, file("New.flac"));
    await store().addTrack("audio", undefined, { name: "Made during the decode" });
    release();
    expect((await replacing).success).toBe(true);
    expect(store().project.timeline.tracks.some((t) => t.name === "Made during the decode")).toBe(true);
    expect(store().project.mediaLibrary.items.map((m) => m.name)).toEqual(["New.flac"]);
  });

  it("refuses to touch another project opened while the file was being read", async () => {
    await store().importMedia(file("Old.flac"));
    const id = store().project.mediaLibrary.items[0].id;
    const release = held();
    const replacing = store().replaceMediaAsset(id, file("New.flac"));
    store().createNewProject("Another", { width: 832, height: 480, frameRate: 24 });
    release();
    expect((await replacing).success).toBe(false);
    expect(store().project.mediaLibrary.items).toEqual([]);
  });
});
