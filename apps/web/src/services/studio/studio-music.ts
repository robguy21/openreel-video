/**
 * The project's songs (the manifest's `music`) in the media library: which are already
 * there and which are not. Pure, so the rule is tested on its own; studio-session does
 * the fetching and importing.
 *
 * A song is published to the media library only - it is never laid on the timeline. Its
 * identity is its studio asset path, recorded in the saved doc's `studio.media` like every
 * other studio file, so a reopened edit recognises a song it already has and does not
 * import it twice.
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
  const name = (song.name || "").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "Song";
  return name.toLowerCase().endsWith(`.${ext}`) ? name : `${name}.${ext}`;
}

/**
 * Split the manifest's songs into those the media library already has - with the media id
 * that holds each - and those it does not. A song is "had" when some media id mapped to its
 * asset path is still in the library (`liveIds`); a mapping left behind by an item the
 * reader deleted does not count. A song listed twice is reported once.
 */
export function partitionSongs(
  songs: readonly StudioSong[] | undefined,
  media: StudioMediaMap,
  liveIds: ReadonlySet<string>,
): { present: { song: StudioSong; mediaId: string }[]; missing: StudioSong[] } {
  const byAsset = new Map<string, string>();
  for (const [id, m] of Object.entries(media)) {
    if (m?.asset && liveIds.has(id) && !byAsset.has(m.asset)) byAsset.set(m.asset, id);
  }
  const present: { song: StudioSong; mediaId: string }[] = [];
  const missing: StudioSong[] = [];
  const seen = new Set<string>();
  for (const song of songs ?? []) {
    if (!song?.asset || !song.url || seen.has(song.asset)) continue;
    seen.add(song.asset);
    const id = byAsset.get(song.asset);
    if (id) present.push({ song, mediaId: id });
    else missing.push(song);
  }
  return { present, missing };
}

/** "2 songs imported", "1 song fetched again", "All songs are already here"... - what
 *  Import Audio Creations tells the reader. */
export function songImportMessage(r: {
  total: number;
  imported: number;
  refetched: number;
  failed: number;
}): string {
  if (r.total === 0) return "This project has no songs yet.";
  const n = (k: number) => `${k} song${k === 1 ? "" : "s"}`;
  const parts: string[] = [];
  if (r.imported) parts.push(`${n(r.imported)} imported`);
  if (r.refetched) parts.push(`${r.imported ? r.refetched : n(r.refetched)} fetched again`);
  if (r.failed) parts.push(`${r.imported || r.refetched ? r.failed : n(r.failed)} could not be fetched`);
  if (!parts.length) return "All songs are already here.";
  const s = parts.join(", ");
  return `${s[0].toUpperCase()}${s.slice(1)}.`;
}
