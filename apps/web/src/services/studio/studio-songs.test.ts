/**
 * Import Audio Creations end to end inside the session, with the network, the media
 * importer and this browser's media store stood in for: what it fetches, what it adds to
 * the library, what it records, and that the timeline is never touched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaItem } from "@openreel/core";

const stored = vi.hoisted(() => new Map<string, Blob>());
vi.mock("../media-storage", () => ({
  loadMediaBlob: vi.fn(async (id: string) => stored.get(id) ?? null),
  saveMediaBlob: vi.fn(async (_p: string, id: string, blob: Blob) => {
    stored.set(id, blob);
  }),
}));

import { useProjectStore } from "../../stores/project-store";
import { useNotificationStore } from "../../stores/notification-store";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { importAudioCreations, useStudioStore } from "./studio-session";
import type { StudioMediaMap, StudioSong } from "./studio-client";

const song = (n: number): StudioSong => ({
  id: `s${n}`,
  name: `Song ${n}`,
  asset: `assets/music/s${n}.flac`,
  url: `/api/projects/p1/asset?path=s${n}`,
  duration_s: 30,
  bytes: 4,
});

function audioItem(id: string, name: string, blob: Blob | null): MediaItem {
  return {
    id,
    name,
    type: "audio",
    fileHandle: null,
    blob,
    metadata: {
      duration: 30, width: 0, height: 0, frameRate: 0, codec: "flac", sampleRate: 44100,
      channels: 2, fileSize: 4, hasVideo: false, hasAudio: true,
    },
    thumbnailUrl: null,
    waveformData: null,
  } as MediaItem;
}

let songs: StudioSong[] = [];
let fetched: string[] = [];
let saves = 0;
let nextId = 0;
const importMedia = vi.fn(async (file: File) => {
  const id = `new-${++nextId}`;
  const { project } = useProjectStore.getState();
  useProjectStore.setState({
    project: {
      ...project,
      mediaLibrary: { ...project.mediaLibrary, items: [...project.mediaLibrary.items, audioItem(id, file.name, file)] },
    },
  });
  return { success: true, actionId: id };
});
const replaceMediaAsset = vi.fn(async (mediaId: string, file: File) => {
  const { project } = useProjectStore.getState();
  useProjectStore.setState({
    project: {
      ...project,
      mediaLibrary: {
        items: project.mediaLibrary.items.map((m) => (m.id === mediaId ? audioItem(mediaId, file.name, file) : m)),
      },
    },
  });
  return { success: true, actionId: "x" };
});

function open(items: MediaItem[], media: StudioMediaMap) {
  const project = createEmptyProject("Film");
  useProjectStore.setState({
    project: { ...project, mediaLibrary: { ...project.mediaLibrary, items } },
    importMedia,
    replaceMediaAsset,
  } as never);
  useStudioStore.setState({ pid: "p1", part: null, status: "ready", media });
}

beforeEach(() => {
  songs = [];
  fetched = [];
  saves = 0;
  nextId = 0;
  stored.clear();
  importMedia.mockClear();
  replaceMediaAsset.mockClear();
  useNotificationStore.setState({ notifications: [] });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { method?: string }) => {
      if (url.includes("editor/manifest")) {
        return new Response(JSON.stringify({ project: { id: "p1", name: "Film" }, shots: [], music: songs }));
      }
      if (url.includes("editor/doc") && init?.method === "PUT") {
        saves++;
        return new Response(JSON.stringify({ ts: 1 }));
      }
      const s = songs.find((x) => x.url === url);
      if (s) {
        fetched.push(s.asset);
        if (s.name === "Broken") return new Response("no", { status: 500 });
        return new Response(new Blob(["fLaC"]));
      }
      return new Response("not found", { status: 404 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  useStudioStore.setState({ pid: null, status: "idle", media: {} });
});

const lastToast = () => useNotificationStore.getState().notifications.at(-1);
const tracksBefore = () => JSON.stringify(useProjectStore.getState().project.timeline);

describe("importAudioCreations", () => {
  it("imports only the songs the library does not have, as audio, and records them", async () => {
    const have = new Blob(["fLaC"]);
    stored.set("m1", have);
    open([audioItem("m1", "Song 1.flac", have)], {
      m1: { url: song(1).url, asset: song(1).asset, name: "Song 1.flac", type: "audio" },
    });
    songs = [song(1), song(2)];
    const timeline = tracksBefore();

    await importAudioCreations();

    expect(fetched).toEqual([song(2).asset]);
    expect(importMedia).toHaveBeenCalledTimes(1);
    const file = importMedia.mock.calls[0][0];
    expect(file.name).toBe("Song 2.flac");
    expect(file.type).toBe("audio/flac");
    const media = useStudioStore.getState().media;
    expect(Object.values(media).map((m) => m.asset).sort()).toEqual([song(1).asset, song(2).asset]);
    expect(media["new-1"].type).toBe("audio");
    expect(tracksBefore()).toBe(timeline);
    expect(saves).toBe(1);
    expect(lastToast()?.message).toBe("1 song imported.");
  });

  it("says so when every song is already here, and fetches nothing", async () => {
    const have = new Blob(["fLaC"]);
    stored.set("m1", have);
    open([audioItem("m1", "Song 1.flac", have)], {
      m1: { url: song(1).url, asset: song(1).asset, name: "Song 1.flac", type: "audio" },
    });
    songs = [song(1)];
    await importAudioCreations();
    expect(fetched).toEqual([]);
    expect(saves).toBe(0);
    expect(lastToast()?.message).toBe("All songs are already here.");
  });

  it("fetches again a song whose file is gone from this browser, under the same media id", async () => {
    open([audioItem("m1", "Song 1.flac", new Blob(["fLaC"]))], {
      m1: { url: song(1).url, asset: song(1).asset, name: "Song 1.flac", type: "audio" },
    });
    songs = [song(1)];
    await importAudioCreations();
    expect(fetched).toEqual([song(1).asset]);
    expect(replaceMediaAsset).toHaveBeenCalledWith("m1", expect.any(File));
    expect(importMedia).not.toHaveBeenCalled();
    expect(stored.has("m1")).toBe(true);
    expect(lastToast()?.message).toBe("1 song fetched again.");
  });

  it("skips a song that cannot be fetched, counts it, and still imports the rest", async () => {
    open([], {});
    songs = [{ ...song(1), name: "Broken" }, song(2)];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await importAudioCreations();
    warn.mockRestore();
    expect(importMedia).toHaveBeenCalledTimes(1);
    expect(lastToast()?.type).toBe("warning");
    expect(lastToast()?.message).toBe("1 song imported, 1 could not be fetched.");
  });

  it("never removes a song the studio no longer has", async () => {
    const have = new Blob(["fLaC"]);
    stored.set("m1", have);
    open([audioItem("m1", "Song 1.flac", have)], {
      m1: { url: song(1).url, asset: song(1).asset, name: "Song 1.flac", type: "audio" },
    });
    songs = [];
    await importAudioCreations();
    expect(useProjectStore.getState().project.mediaLibrary.items.map((m) => m.id)).toEqual(["m1"]);
    expect(useStudioStore.getState().media.m1).toBeDefined();
    expect(lastToast()?.message).toBe("This project has no songs yet.");
  });
});
