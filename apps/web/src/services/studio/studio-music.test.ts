import { describe, expect, it } from "vitest";
import type { StudioMediaMap, StudioSong } from "./studio-client";
import { partitionSongs, savedMediaMap, songFileName, songImportMessage } from "./studio-music";

const song = (n: number, extra: Partial<StudioSong> = {}): StudioSong => ({
  id: `s${n}`,
  name: `Song ${n}`,
  asset: `assets/music/s${n}.flac`,
  url: `/api/projects/p1/asset?path=assets%2Fmusic%2Fs${n}.flac`,
  duration_s: 30,
  bytes: 1000,
  ...extra,
});

const mapped = (asset: string) => ({ url: "/u", asset, name: "x.flac", type: "audio" as const });

describe("partitionSongs", () => {
  it("reports every song missing from an empty library", () => {
    const r = partitionSongs([song(1), song(2)], {}, new Set());
    expect(r.present).toEqual([]);
    expect(r.missing.map((s) => s.id)).toEqual(["s1", "s2"]);
  });

  it("recognises a song by its asset path through the saved media map", () => {
    const media: StudioMediaMap = { m1: mapped("assets/music/s1.flac") };
    const r = partitionSongs([song(1), song(2)], media, new Set(["m1"]));
    expect(r.present).toEqual([{ song: song(1), mediaId: "m1" }]);
    expect(r.missing.map((s) => s.id)).toEqual(["s2"]);
  });

  it("does not count a mapping whose item has left the library", () => {
    const media: StudioMediaMap = { gone: mapped("assets/music/s1.flac") };
    const r = partitionSongs([song(1)], media, new Set());
    expect(r.missing.map((s) => s.id)).toEqual(["s1"]);
  });

  it("calls a song the reader deleted deleted - a tombstone, or a song item gone since opening", () => {
    const media: StudioMediaMap = {
      t: { ...mapped("assets/music/s1.flac"), song: true, deleted: true },
      g: { ...mapped("assets/music/s2.flac"), song: true },
    };
    const r = partitionSongs([song(1), song(2), song(3)], media, new Set());
    expect(r.deleted.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(r.missing.map((s) => s.id)).toEqual(["s3"]);
  });

  it("a song back in the library beside its old tombstone is present", () => {
    const media: StudioMediaMap = {
      t: { ...mapped("assets/music/s1.flac"), song: true, deleted: true },
      m2: { ...mapped("assets/music/s1.flac"), song: true },
    };
    const r = partitionSongs([song(1)], media, new Set(["m2"]));
    expect(r.present).toEqual([{ song: song(1), mediaId: "m2" }]);
    expect(r.deleted).toEqual([]);
  });

  it("is about the asset, not the name or the url", () => {
    const media: StudioMediaMap = { m1: mapped("assets/music/s1.flac") };
    const renamed = song(1, { name: "Renamed", url: "/other" });
    expect(partitionSongs([renamed], media, new Set(["m1"])).missing).toEqual([]);
  });

  it("lists a song given twice once, and ignores entries with no asset or url", () => {
    const r = partitionSongs(
      [song(1), song(1), song(2, { asset: "" }), song(3, { url: "" })],
      {},
      new Set(),
    );
    expect(r.missing.map((s) => s.id)).toEqual(["s1"]);
  });

  it("takes a manifest from a studio before songs", () => {
    expect(partitionSongs(undefined, {}, new Set())).toEqual({ present: [], missing: [], deleted: [] });
  });

  it("never reports a non-song studio file as a song", () => {
    const media: StudioMediaMap = { v: { url: "/v", asset: "assets/takes/t1.mp4", name: "t.mp4", type: "video" } };
    const r = partitionSongs([song(1)], media, new Set(["v"]));
    expect(r.present).toEqual([]);
  });
});

describe("songFileName", () => {
  it("adds the file's extension to the studio's name", () => {
    expect(songFileName({ name: "Song 3", asset: "assets/music/x.flac" })).toBe("Song 3.flac");
  });
  it("does not add it twice", () => {
    expect(songFileName({ name: "Theme.FLAC", asset: "assets/music/x.flac" })).toBe("Theme.FLAC");
  });
  it("names an unnamed song and drops characters a file name cannot carry", () => {
    expect(songFileName({ name: "", asset: "a/b.flac" })).toBe("Song.flac");
    expect(songFileName({ name: "A/B: C?", asset: "a/b.wav" })).toBe("A B C.wav");
  });
});

describe("songImportMessage", () => {
  it("says what happened, in a sentence", () => {
    expect(songImportMessage({ total: 0, imported: 0, refetched: 0, failed: 0 })).toBe(
      "This project has no songs yet.",
    );
    expect(songImportMessage({ total: 3, imported: 0, refetched: 0, failed: 0 })).toBe(
      "All songs are already here.",
    );
    expect(songImportMessage({ total: 3, imported: 2, refetched: 0, failed: 0 })).toBe("2 songs imported.");
    expect(songImportMessage({ total: 3, imported: 0, refetched: 1, failed: 0 })).toBe(
      "1 song fetched again.",
    );
    expect(songImportMessage({ total: 3, imported: 1, refetched: 1, failed: 1 })).toBe(
      "1 song imported, 1 fetched again, 1 could not be brought in.",
    );
    expect(songImportMessage({ total: 3, imported: 0, refetched: 0, failed: 2 })).toBe(
      "2 songs could not be brought in.",
    );
  });
});

describe("savedMediaMap", () => {
  const take = { url: "/v", asset: "assets/v.mp4", name: "S01-01 X.mp4", type: "video" as const };
  const s1 = { url: "/s", asset: "assets/music/s1.flac", name: "Song 1.flac", type: "audio" as const, song: true };

  it("keeps what is in the library and drops a shot file that is not", () => {
    expect(savedMediaMap({ v: take, gone: take }, new Set(["v"]))).toEqual({ v: take });
  });
  it("keeps a deleted song as a tombstone", () => {
    expect(savedMediaMap({ a: s1 }, new Set())).toEqual({ a: { ...s1, deleted: true } });
  });
  it("drops the tombstone once the song is in the library again", () => {
    expect(savedMediaMap({ a: { ...s1, deleted: true }, b: s1 }, new Set(["b"]))).toEqual({ b: s1 });
  });
  it("adds one sentence when the browser could not keep a copy", () => {
    expect(songImportMessage({ total: 1, imported: 1, refetched: 0, failed: 0, notKept: 1 })).toBe(
      "1 song imported. This browser could not keep a copy, so it will be fetched again next time.",
    );
  });
});
