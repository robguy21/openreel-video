import type { Track } from "@openreel/core";

/**
 * Where the Edit monitor's "Previous cut" and "Next cut" go (docs/PROPOSAL_EDITOR_REDESIGN.md
 * R6.2): the nearest clip edge on any video track, before or after the playhead. Edges
 * closer than half a frame to the playhead count as the playhead itself, so pressing
 * again moves on rather than landing where it already is.
 */
export function cutEdges(tracks: ReadonlyArray<Pick<Track, "type" | "clips">>): number[] {
  const edges = new Set<number>();
  for (const track of tracks) {
    if (track.type !== "video") continue;
    for (const clip of track.clips) {
      edges.add(round(clip.startTime));
      edges.add(round(clip.startTime + clip.duration));
    }
  }
  return [...edges].sort((a, b) => a - b);
}

export function nearestCut(
  edges: ReadonlyArray<number>,
  playhead: number,
  direction: -1 | 1,
  halfFrame = 1 / 48,
): number | null {
  if (direction > 0) {
    const next = edges.find((e) => e > playhead + halfFrame);
    return next ?? null;
  }
  for (let i = edges.length - 1; i >= 0; i--) {
    if (edges[i] < playhead - halfFrame) return edges[i];
  }
  return null;
}

function round(t: number): number {
  return Math.round(t * 1e6) / 1e6;
}
