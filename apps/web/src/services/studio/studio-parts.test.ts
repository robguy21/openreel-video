import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MUTATING_HEADERS,
  STUDIO_API,
  fetchManifest,
  fetchSavedDoc,
  prepareNarration,
  projectUrl,
  putSavedDoc,
  putSavedDocRequest,
  uploadExport,
  type StudioManifest,
  type StudioSavedDoc,
} from "./studio-client";
import { editTitleOf, partLabelOf, shotFileName, shotPrefix } from "./studio-session";

type FetchInit = NonNullable<Parameters<typeof fetch>[1]>;

const doc = { version: "1", project: {}, studio: { pid: "p1", media: {}, savedAt: 0, app: "openreel" } } as StudioSavedDoc;

function manifest(part?: {
  id: string;
  name: string;
  number: number | null;
  label?: string | null;
}): StudioManifest {
  return {
    project: { id: "p1", name: "Film", ...(part ? { part } : {}) },
    fps: 24,
    shots: [],
    stitch_export: null,
    editor_export: null,
    editor_saved: false,
    editor_ts: null,
    generated: 0,
  };
}

describe("projectUrl", () => {
  it("says nothing about the part when there is none (Part 1 on the studio's side)", () => {
    expect(projectUrl({ pid: "p1", part: null }, "editor/manifest")).toBe(
      `${STUDIO_API}/projects/p1/editor/manifest`,
    );
  });

  it("adds ?part= when there is one, and & when the path has a query already", () => {
    expect(projectUrl({ pid: "p1", part: "pt2" }, "editor/doc")).toBe(
      `${STUDIO_API}/projects/p1/editor/doc?part=pt2`,
    );
    expect(projectUrl({ pid: "p1", part: "a b" }, "moments?x=1")).toBe(
      `${STUDIO_API}/projects/p1/moments?x=1&part=a%20b`,
    );
  });
});

describe("studio calls", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch() {
    const calls: { url: string; init: FetchInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: FetchInit = {}) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ ts: 1, queued: false, missing: 0, export: "e", url: "u", bytes: 1, project: {} }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
    return calls;
  }

  it("sends ?part= on every call and the app header on every change", async () => {
    const calls = stubFetch();
    const at = { pid: "p1", part: "pt2" };
    await fetchManifest(at);
    await prepareNarration(at);
    await fetchSavedDoc(at);
    await putSavedDoc(at, doc);
    await uploadExport(at, new Blob(["x"]), "edit", "mp4");
    expect(calls.map((c) => c.url)).toEqual([
      `${STUDIO_API}/projects/p1/editor/manifest?part=pt2`,
      `${STUDIO_API}/projects/p1/editor/prepare?part=pt2`,
      `${STUDIO_API}/projects/p1/editor/doc?part=pt2`,
      `${STUDIO_API}/projects/p1/editor/doc?part=pt2`,
      `${STUDIO_API}/projects/p1/editor/export?part=pt2`,
    ]);
    for (const c of calls) {
      expect(c.init.credentials).toBe("include");
      const method = (c.init.method || "GET").toUpperCase();
      const headers = (c.init.headers || {}) as Record<string, string>;
      if (method !== "GET") expect(headers["X-Clip-Studio-App"]).toBe("1");
    }
  });

  it("calls exactly today's urls when no part is named", async () => {
    const calls = stubFetch();
    const at = { pid: "p1", part: null };
    await fetchManifest(at);
    await putSavedDoc(at, doc);
    expect(calls.map((c) => c.url)).toEqual([
      `${STUDIO_API}/projects/p1/editor/manifest`,
      `${STUDIO_API}/projects/p1/editor/doc`,
    ]);
  });

  it("builds the unload save with the header and keepalive", () => {
    const [url, init] = putSavedDocRequest({ pid: "p1", part: "pt2" }, doc, true);
    expect(url).toBe(`${STUDIO_API}/projects/p1/editor/doc?part=pt2`);
    expect(init.keepalive).toBe(true);
    expect(init.method).toBe("PUT");
    expect(init.headers).toMatchObject({ ...MUTATING_HEADERS, "Content-Type": "application/json" });
  });
});

describe("shot file names", () => {
  it("number scene and shot within the part from the manifest's number", () => {
    expect(shotPrefix({ order: 13, number: [2, 1, 3] })).toBe("S01-03");
    expect(shotFileName({ order: 13, number: [2, 12, 4], summary: "The door!" }, " VO", "mp3")).toBe(
      "S12-04 VO The door.mp3",
    );
  });

  it("fall back to the film-wide position from a studio before parts", () => {
    expect(shotPrefix({ order: 0 })).toBe("01");
    expect(shotPrefix({ order: 4, number: null })).toBe("05");
    expect(shotFileName({ order: 8, summary: "" }, "", "mp4")).toBe("09 shot.mp4");
  });
});

describe("part label", () => {
  it("is empty when the studio names no part", () => {
    expect(partLabelOf(manifest())).toBe("");
    expect(editTitleOf(manifest())).toBe("Film");
  });

  it("draws Part N, with the typed name after it", () => {
    expect(partLabelOf(manifest({ id: "a", name: "", number: 2 }))).toBe("Part 2");
    expect(editTitleOf(manifest({ id: "a", name: " The chase ", number: 2 }))).toBe(
      "Film · Part 2 · The chase",
    );
  });

  it("takes the studio's own label when it sends one", () => {
    expect(partLabelOf(manifest({ id: "a", name: "x", number: 3, label: "Part 3 · x" }))).toBe("Part 3 · x");
    expect(partLabelOf(manifest({ id: "a", name: "", number: null, label: null }))).toBe("");
  });
});
