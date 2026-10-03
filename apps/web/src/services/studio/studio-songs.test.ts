/**
 * The project's songs in a studio session, end to end inside the session: the open paths
 * (a first build and a saved edit), Import Audio Creations, tombstones, and the song run's
 * exclusion against a part switch and Rebuild from the film. The network, the media
 * importer and this browser's media store are stood in for; the project store is real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaItem, Project } from "@openreel/core";
import { createProjectSerializer, createStorageEngine } from "@openreel/core";

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
import {
  importAudioCreations,
  openStudioProject,
  rebuildFromFilm,
  saveToStudio,
  songsSettled,
  useStudioStore,
} from "./studio-session";
import type { StudioManifest, StudioMediaMap, StudioSavedDoc, StudioSong } from "./studio-client";

// ─── The stand-ins ──────────────────────────────────────────────────────────

const song = (n: number, name = `Song ${n}`): StudioSong => ({
  id: `s${n}`,
  name,
  asset: `assets/song_${n}.flac`,
  url: `/api/projects/p1/asset?path=song_${n}`,
  duration_s: 30,
  bytes: 4,
});

function audioItem(id: string, name: string, blob: Blob | null, type: MediaItem["type"] = "audio"): MediaItem {
  return {
    id,
    name,
    type,
    fileHandle: null,
    blob,
    metadata: {
      duration: 3, width: type === "video" ? 832 : 0, height: type === "video" ? 480 : 0,
      frameRate: type === "video" ? 24 : 0, codec: "x", sampleRate: 44100, channels: 2, fileSize: 4,
      hasVideo: type === "video", hasAudio: true,
    },
    thumbnailUrl: null,
    waveformData: null,
  } as MediaItem;
}

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((r) => (release = r));
  return { promise, release };
}

/** What the studio serves, per part. */
let manifests: Record<string, Partial<StudioManifest>> = {};
let docs: Record<string, StudioSavedDoc | null> = {};
let puts: { part: string; doc: StudioSavedDoc }[] = [];
let fetched: string[] = [];
/** Held song fetches / imports, by file name. */
let holdFetch: Partial<Record<string, Promise<void>>> = {};
let holdImport: Partial<Record<string, Promise<void>>> = {};
let failWrites = false;
let nextId = 0;

const importMedia = vi.fn(async (file: File) => {
  if (holdImport[file.name]) await holdImport[file.name];
  if (file.name.startsWith("Broken")) return { success: false, error: { code: "DECODE_ERROR", message: "bad file" } };
  const id = `m${++nextId}`;
  // As the real slice does since the fix: added to the project as it is NOW.
  const { project } = useProjectStore.getState();
  const type = file.type.startsWith("video/") ? "video" : "audio";
  useProjectStore.setState({
    project: {
      ...project,
      mediaLibrary: { ...project.mediaLibrary, items: [...project.mediaLibrary.items, audioItem(id, file.name, file, type)] },
      modifiedAt: Date.now(),
    },
  });
  if (!failWrites) stored.set(id, file);
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

const partOf = (url: string) => /[?&]part=([^&]+)/.exec(url)?.[1] ?? "A";

function manifestFor(part: string): StudioManifest {
  return {
    project: { id: "p1", name: "Film", part: { id: part, name: "", number: part === "A" ? 1 : 2 } },
    fps: 24,
    shots: [],
    stitch_export: null,
    editor_export: null,
    editor_saved: Boolean(docs[part]),
    editor_ts: null,
    generated: 0,
    ...manifests[part],
  } as StudioManifest;
}

/** A saved edit the real serializer reads back: `items` in its library, `media` as its map. */
function savedDoc(part: string, items: MediaItem[] = [], media: StudioMediaMap = {}): StudioSavedDoc {
  const project = createEmptyProject("Film");
  const full: Project = { ...project, mediaLibrary: { ...project.mediaLibrary, items } };
  const doc = JSON.parse(
    createProjectSerializer(createStorageEngine()).exportToJsonWithMetadata(full, "test"),
  ) as StudioSavedDoc;
  doc.studio = { pid: "p1", part, media, savedAt: 0, app: "openreel" };
  return doc;
}

/** The shot of a first build: one take, its picture and its sound. */
const shot = {
  id: "x", order: 0, number: [1, 1, 1], summary: "Card", length_frames: 72, line: {},
  take_id: "t1", narration: null, include_vo: true, gap_s: 0, crossfade_s: 0,
  start_frame: 0, end_frame: null, continues: false, lead_in_ms: 0, location_ref: null,
  video: { asset: "assets/v.mp4", url: "/api/projects/p1/asset?path=v.mp4", duration_s: 3, bytes: 4, frames: 72 },
  audio: { asset: "assets/v.flac", url: "/api/projects/p1/asset?path=v.flac", duration_s: 3, bytes: 4, source: "master" },
};

beforeEach(() => {
  manifests = {};
  docs = {};
  puts = [];
  fetched = [];
  holdFetch = {};
  holdImport = {};
  failWrites = false;
  nextId = 0;
  stored.clear();
  importMedia.mockClear();
  replaceMediaAsset.mockClear();
  useNotificationStore.setState({ notifications: [] });
  useProjectStore.setState({ importMedia, replaceMediaAsset } as never);
  // probeVideo: jsdom loads no media, so every <video> "fails" at once (1920x1080 assumed).
  Object.defineProperty(HTMLMediaElement.prototype, "src", {
    configurable: true,
    get: () => "",
    set(this: HTMLMediaElement) {
      setTimeout(() => this.onerror?.(new Event("error")));
    },
  });
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      const method = init?.method ?? "GET";
      if (url.includes("editor/prepare")) return new Response(JSON.stringify({ queued: false, missing: 0 }));
      if (url.includes("editor/refresh_sources")) {
        docs[partOf(url)] = null;
        return new Response("{}");
      }
      if (url.includes("editor/manifest")) return new Response(JSON.stringify(manifestFor(partOf(url))));
      if (url.includes("editor/doc") && method === "PUT") {
        puts.push({ part: partOf(url), doc: JSON.parse(init!.body!) });
        return new Response(JSON.stringify({ ts: 1 }));
      }
      if (url.includes("editor/doc")) {
        const d = docs[partOf(url)];
        return d ? new Response(JSON.stringify(d)) : new Response("{}", { status: 404 });
      }
      const all = Object.values(manifests).flatMap((m) => m.music ?? []);
      const s = all.find((x) => x.url === url);
      if (s) {
        fetched.push(s.asset);
        if (holdFetch[s.name]) await holdFetch[s.name];
        if (s.name === "Gone") return new Response("no", { status: 500 });
        return new Response(new Blob(["fLaC"], { type: "audio/flac" }));
      }
      if (url.includes("v.mp4")) return new Response(new Blob(["mp4"], { type: "video/mp4" }));
      if (url.includes("v.flac")) return new Response(new Blob(["fLaC"], { type: "audio/flac" }));
      return new Response("not found", { status: 404 });
    }),
  );
});

afterEach(async () => {
  await songsSettled();
  vi.unstubAllGlobals();
  useStudioStore.setState({ pid: null, part: null, status: "idle", media: {} });
});

const toasts = () => useNotificationStore.getState().notifications;
const lastToast = () => toasts().at(-1);
const library = () => useProjectStore.getState().project.mediaLibrary.items;
const clipMediaIds = () =>
  useProjectStore.getState().project.timeline.tracks.flatMap((t) => t.clips.map((c) => c.mediaId));
const songsIn = (media: StudioMediaMap) =>
  Object.values(media).filter((m) => m.song && !m.deleted).map((m) => m.asset).sort();

/** Open part `part`, then wait for its songs. */
async function open(part = "A") {
  await openStudioProject("p1", part);
  await songsSettled();
}

// ─── Opening ────────────────────────────────────────────────────────────────

describe("opening", () => {
  it("a first build lays the take out and brings every song into the library, never the timeline", async () => {
    manifests.A = { shots: [shot] as never, music: [song(1), song(2)] };
    await open();
    expect(library().map((m) => m.name)).toEqual([
      "S01-01 Card.mp4", "S01-01 sound Card.flac", "Song 1.flac", "Song 2.flac",
    ]);
    const songIds = library().filter((m) => m.name.startsWith("Song")).map((m) => m.id);
    expect(clipMediaIds().filter((id) => songIds.includes(id))).toEqual([]);
    expect(clipMediaIds().length).toBeGreaterThan(0);
    expect(songsIn(useStudioStore.getState().media)).toEqual([song(1).asset, song(2).asset]);
    // the build's own first save, then one after the songs; the last one maps the songs
    expect(puts.length).toBe(2);
    expect(songsIn(puts[1].doc.studio.media)).toEqual([song(1).asset, song(2).asset]);
  });

  it("the editor is ready before the songs are in", async () => {
    manifests.A = { music: [song(1)] };
    docs.A = savedDoc("A");
    const gate = deferred();
    holdFetch["Song 1"] = gate.promise;
    await openStudioProject("p1", "A");
    expect(useStudioStore.getState().status).toBe("ready");
    expect(useStudioStore.getState().songsBusy).toBe(true);
    expect(library()).toEqual([]);
    expect(lastToast()?.message).toBe("Bringing in 1 song…");
    gate.release();
    await songsSettled();
    expect(library().map((m) => m.name)).toEqual(["Song 1.flac"]);
    expect(useStudioStore.getState().songsBusy).toBe(false);
  });

  it("a saved edit imports only the songs it never had, and saves exactly once", async () => {
    const have = new Blob(["fLaC"]);
    stored.set("old1", have);
    manifests.A = { music: [song(1), song(2)] };
    docs.A = savedDoc("A", [audioItem("old1", "Song 1.flac", null)], {
      old1: { url: song(1).url, asset: song(1).asset, name: "Song 1.flac", type: "audio", song: true },
    });
    await open();
    expect(fetched).toEqual([song(2).asset]);
    expect(library().map((m) => m.name)).toEqual(["Song 1.flac", "Song 2.flac"]);
    expect(puts.length).toBe(1);
    expect(songsIn(puts[0].doc.studio.media)).toEqual([song(1).asset, song(2).asset]);
    expect(lastToast()?.message).toBe("1 song imported.");
  });

  it("a saved edit with every song says nothing and saves nothing", async () => {
    stored.set("old1", new Blob(["fLaC"]));
    manifests.A = { music: [song(1)] };
    docs.A = savedDoc("A", [audioItem("old1", "Song 1.flac", null)], {
      old1: { url: song(1).url, asset: song(1).asset, name: "Song 1.flac", type: "audio", song: true },
    });
    await open();
    expect(fetched).toEqual([]);
    expect(puts.length).toBe(0);
    expect(toasts()).toEqual([]);
  });

  it("takes a manifest from a studio before songs", async () => {
    docs.A = savedDoc("A");
    await open();
    expect(importMedia).not.toHaveBeenCalled();
    expect(toasts()).toEqual([]);
  });

  it("a song that cannot be fetched or imported never stops the editor opening", async () => {
    manifests.A = { music: [song(1, "Gone"), song(2, "Broken"), song(3)] };
    docs.A = savedDoc("A");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await open();
    warn.mockRestore();
    expect(useStudioStore.getState().status).toBe("ready");
    expect(library().map((m) => m.name)).toEqual(["Song 3.flac"]);
    expect(lastToast()?.type).toBe("warning");
    expect(lastToast()?.message).toBe("1 song imported, 2 could not be brought in.");
  });
});

// ─── Import Audio Creations ─────────────────────────────────────────────────

describe("Import Audio Creations", () => {
  async function openWith(have: number[], music: StudioSong[]) {
    const items = have.map((n) => audioItem(`old${n}`, `Song ${n}.flac`, null));
    const media: StudioMediaMap = {};
    for (const n of have) {
      stored.set(`old${n}`, new Blob(["fLaC"]));
      media[`old${n}`] = { url: song(n).url, asset: song(n).asset, name: `Song ${n}.flac`, type: "audio", song: true };
    }
    manifests.A = { music: have.map((n) => song(n)) };
    docs.A = savedDoc("A", items, media);
    await open();
    manifests.A = { music };
    fetched = [];
    puts = [];
    useNotificationStore.setState({ notifications: [] });
  }

  it("says it has started, imports only the missing songs and records each one", async () => {
    await openWith([1], [song(1), song(2)]);
    await importAudioCreations();
    expect(toasts()[0].message).toBe("Looking for songs in the studio…");
    expect(fetched).toEqual([song(2).asset]);
    expect(songsIn(useStudioStore.getState().media)).toEqual([song(1).asset, song(2).asset]);
    expect(clipMediaIds()).toEqual([]);
    expect(puts.length).toBe(1);
    expect(lastToast()?.message).toBe("1 song imported.");
  });

  it("says so when every song is already here", async () => {
    await openWith([1], [song(1)]);
    await importAudioCreations();
    expect(fetched).toEqual([]);
    expect(puts.length).toBe(0);
    expect(lastToast()?.message).toBe("All songs are already here.");
  });

  it("a second click while songs are coming in says so instead of starting again", async () => {
    await openWith([], [song(1)]);
    const gate = deferred();
    holdFetch["Song 1"] = gate.promise;
    const first = importAudioCreations();
    await Promise.resolve();
    void importAudioCreations();
    expect(toasts().map((t) => t.message)).toContain("Songs are already being brought in.");
    gate.release();
    await first;
    expect(importMedia).toHaveBeenCalledTimes(1);
  });

  it("fetches again a song whose file this browser lost, into the same media id", async () => {
    await openWith([1], [song(1)]);
    stored.delete("old1");
    await importAudioCreations();
    expect(replaceMediaAsset).toHaveBeenCalledWith("old1", expect.any(File));
    expect(stored.has("old1")).toBe(true);
    expect(importMedia).not.toHaveBeenCalled();
    expect(lastToast()?.message).toBe("1 song fetched again.");
  });

  it("counts a song imported when this browser could not keep a copy, and says so once", async () => {
    await openWith([], [song(1), song(2)]);
    failWrites = true;
    await importAudioCreations();
    expect(library().length).toBe(2);
    expect(lastToast()?.type).toBe("warning");
    expect(lastToast()?.message).toBe(
      "2 songs imported. This browser could not keep a copy, so it will be fetched again next time.",
    );
  });

  it("reports an import that the editor refused", async () => {
    await openWith([], [song(1, "Broken")]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await importAudioCreations();
    warn.mockRestore();
    expect(library()).toEqual([]);
    expect(lastToast()?.message).toBe("1 song could not be brought in.");
  });

  it("never removes a song the studio no longer has", async () => {
    await openWith([1], []);
    await importAudioCreations();
    expect(library().map((m) => m.id)).toEqual(["old1"]);
    expect(lastToast()?.message).toBe("This project has no songs yet.");
  });
});

// ─── A song the reader deleted ──────────────────────────────────────────────

describe("a deleted song", () => {
  it("is saved as a tombstone, stays out on the next open, and comes back from the menu", async () => {
    manifests.A = { music: [song(1), song(2)] };
    docs.A = savedDoc("A");
    await open();
    const s1 = library().find((m) => m.name === "Song 1.flac")!.id;
    // the reader deletes Song 1 from the library
    const { project } = useProjectStore.getState();
    useProjectStore.setState({
      project: { ...project, mediaLibrary: { ...project.mediaLibrary, items: library().filter((m) => m.id !== s1) } },
    });
    puts = [];
    await saveToStudio();
    const saved = puts[0].doc;
    expect(saved.studio.media[s1]).toMatchObject({ asset: song(1).asset, deleted: true });

    // reopen: Song 1 is not brought back
    docs.A = savedDoc("A", library().map((m) => ({ ...m, blob: null })), saved.studio.media);
    fetched = [];
    await open();
    expect(fetched).toEqual([]);
    expect(library().map((m) => m.name)).toEqual(["Song 2.flac"]);

    // the menu brings it back and clears the tombstone
    puts = [];
    await importAudioCreations();
    expect(library().map((m) => m.name).sort()).toEqual(["Song 1.flac", "Song 2.flac"]);
    const media = puts.at(-1)!.doc.studio.media;
    expect(Object.values(media).filter((m) => m.deleted)).toEqual([]);
    expect(songsIn(media)).toEqual([song(1).asset, song(2).asset]);
  });
});

// ─── The song run against what replaces the project ─────────────────────────

describe("exclusion", () => {
  it("a part switch mid-import waits for the import to let go, and nothing of it lands in the new part", async () => {
    manifests.A = { music: [song(1), song(2)] };
    manifests.B = {};
    docs.A = savedDoc("A");
    docs.B = savedDoc("B");
    const gate = deferred();
    holdImport["Song 1.flac"] = gate.promise;
    await openStudioProject("p1", "A");
    // Song 1 is inside importMedia (held) when the project is replaced under it.
    await vi.waitFor(() => expect(importMedia.mock.calls.some(([f]) => f.name === "Song 1.flac")).toBe(true));
    const toB = openStudioProject("p1", "B");
    // Long enough for B to have opened if nothing made it wait for the held import.
    await new Promise((r) => setTimeout(r, 30));
    gate.release();
    await toB;
    await songsSettled();
    expect(useStudioStore.getState().part).toBe("B");
    expect(library()).toEqual([]);
    expect(useStudioStore.getState().media).toEqual({});
    expect(importMedia.mock.calls.map(([f]) => f.name)).toEqual(["Song 1.flac"]); // Song 2 was never started
    expect(puts.filter((p) => p.part === "B").every((p) => songsIn(p.doc.studio.media).length === 0)).toBe(true);
  });

  it("Rebuild from the film mid-import starts clean and brings each song in once", async () => {
    manifests.A = { shots: [shot] as never, music: [song(1), song(2)] };
    const gate = deferred();
    holdImport["Song 1.flac"] = gate.promise;
    await openStudioProject("p1", "A");
    // Song 1 is inside importMedia (held) when the project is replaced under it.
    await vi.waitFor(() => expect(importMedia.mock.calls.some(([f]) => f.name === "Song 1.flac")).toBe(true));
    delete holdImport["Song 1.flac"];
    const rebuilt = rebuildFromFilm();
    await new Promise((r) => setTimeout(r, 30));
    gate.release();
    await rebuilt;
    await songsSettled();
    const lib = library();
    expect(lib.filter((m) => m.name.startsWith("Song")).map((m) => m.name)).toEqual(["Song 1.flac", "Song 2.flac"]);
    // every mapping names an item in the library, and every item has its mapping
    const media = useStudioStore.getState().media;
    const ids = new Set(lib.map((m) => m.id));
    expect(Object.keys(media).every((id) => ids.has(id))).toBe(true);
    expect(lib.every((m) => media[m.id])).toBe(true);
    expect(clipMediaIds().every((id) => !media[id].song)).toBe(true);
    expect(importMedia.mock.calls.filter(([f]) => f.name === "Song 2.flac").length).toBe(1);
  });
});
