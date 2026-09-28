import type { MediaItem } from "@openreel/core";

/**
 * The address a plain `<video>`, `<audio>` or `<img>` plays a media item from
 * (docs/PROPOSAL_EDITOR_REDESIGN.md R5.2): its blob, as an object URL, when the library
 * holds one, else the URL it came from - a Clip Studio asset, for a studio film. The
 * pattern Preview.tsx writes inline; this is the one shared helper.
 *
 * An object URL holds its blob in memory until it is revoked, so the caller calls
 * `revoke` when it stops showing the item. Revoking a plain URL does nothing.
 */
export interface MediaPlaybackUrl {
  url: string | null;
  revoke: () => void;
}

export function mediaPlaybackUrl(
  item: Pick<MediaItem, "blob" | "originalUrl"> | null | undefined,
  createObjectURL: (blob: Blob) => string = (blob) => URL.createObjectURL(blob),
  revokeObjectURL: (url: string) => void = (url) => URL.revokeObjectURL(url),
): MediaPlaybackUrl {
  if (item?.blob) {
    const url = createObjectURL(item.blob);
    return { url, revoke: () => revokeObjectURL(url) };
  }
  return { url: item?.originalUrl ?? null, revoke: () => undefined };
}
