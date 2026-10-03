/**
 * The project's songs (the manifest's `music`) in the media library: which are already
 * there, which are not, and which the reader took out. Pure, so the rule is tested on its
 * own; studio-session does the fetching and importing.
 *
 * A song is published to the media library only - it is never laid on the timeline. Its
 * identity is its studio asset path, recorded in the saved doc's `studio.media` like every
 * other studio file (with `song: true`), so a reopened edit recognises a song it already has
 * and does not import it twice. When the reader deletes a song's media item, its entry stays
 * in `studio.media` as a tombstone (`deleted: true`): opening the edit again does not bring
 * it back, and Import Audio Creations does.
 */
import type { StudioMediaMap, StudioSong } from "./studio-client";

/** The extension of a studio asset's path ("flac" for a song), or `fallback`. */
export function assetExt(asset: string, fallback: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(asset);
  return m ? m[1].toLowerCase() : fallback;
}

/** The song's name as the media library shows it: the studio's name with the file's
 *  extension, which the importer reads the type from. */
export function songFileName(song: Pick<StudioSong, "name" | "asset">): string {
  const ext = assetExt(song.asset, "flac");
  const name =
    (song.name || "").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "Song";
  return name.toLowerCase().endsWith(`.${ext}`) ? name : `${name}.${ext}`;
}

/**
 * Sort the manifest's songs by what the media library holds:
 * - `present`: some media id mapped to the song's asset is still in the library (`liveIds`);
 * - `deleted`: not present, but a song entry for its asset is left over - the reader
 *   deleted it (a saved tombstone, or an item deleted since the edit was opened);
 * - `missing`: never in this edit.
 * A song listed twice is reported once; an entry with no asset or url is ignored.
 */
export function partitionSongs(
  songs: readonly StudioSong[] | undefined,
  media: StudioMediaMap,
  liveIds: ReadonlySet<string>,
): {
  present: { song: StudioSong; mediaId: string }[];
  missing: StudioSong[];
  deleted: StudioSong[];
} {
  const live = new Map<string, string>();
  const gone = new Set<string>();
  for (const [id, m] of Object.entries(media)) {
    if (!m?.asset) continue;
    if (liveIds.has(id) && !m.deleted) {
      if (!live.has(m.asset)) live.set(m.asset, id);
    } else if (m.song || m.deleted) {
      gone.add(m.asset);
    }
  }
  const present: { song: StudioSong; mediaId: string }[] = [];
  const missing: StudioSong[] = [];
  const deleted: StudioSong[] = [];
  const seen = new Set<string>();
  for (const song of songs ?? []) {
    if (!song?.asset || !song.url || seen.has(song.asset)) continue;
    seen.add(song.asset);
    const id = live.get(song.asset);
    if (id) present.push({ song, mediaId: id });
    else if (gone.has(song.asset)) deleted.push(song);
    else missing.push(song);
  }
  return { present, missing, deleted };
}

/**
 * `studio.media` as it is saved: every entry whose item is in the library, and a tombstone
 * (`deleted: true`) for every SONG whose item the reader deleted - unless the same song is
 * in the library again under another id. Other studio files whose items are gone drop out,
 * as they always did.
 */
export function savedMediaMap(media: StudioMediaMap, liveIds: ReadonlySet<string>): StudioMediaMap {
  const out: StudioMediaMap = {};
  const liveAssets = new Set<string>();
  for (const [id, m] of Object.entries(media)) {
    if (liveIds.has(id) && !m.deleted) {
      out[id] = m;
      liveAssets.add(m.asset);
    }
  }
  for (const [id, m] of Object.entries(media)) {
    if (out[id] || !(m.song || m.deleted) || liveAssets.has(m.asset)) continue;
    out[id] = { ...m, deleted: true };
  }
  return out;
}

/** "2 songs imported.", "1 song fetched again.", "All songs are already here."... - what the
 *  reader is told when songs have been brought in. `notKept` adds one sentence when this
 *  browser could not store a copy (the songs are in the edit all the same). */
export function songImportMessage(r: {
  total: number;
  imported: number;
  refetched: number;
  failed: number;
  notKept?: number;
}): string {
  if (r.total === 0) return "This project has no songs yet.";
  const n = (k: number) => `${k} song${k === 1 ? "" : "s"}`;
  const parts: string[] = [];
  if (r.imported) parts.push(`${n(r.imported)} imported`);
  if (r.refetched) parts.push(`${r.imported ? r.refetched : n(r.refetched)} fetched again`);
  if (r.failed) {
    parts.push(`${r.imported || r.refetched ? r.failed : n(r.failed)} could not be brought in`);
  }
  let s = parts.length ? parts.join(", ") : "All songs are already here";
  s = `${s[0].toUpperCase()}${s.slice(1)}.`;
  if (r.notKept) s += " This browser could not keep a copy, so it will be fetched again next time.";
  return s;
}
