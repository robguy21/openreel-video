import type { Clip, Project } from "@openreel/core";

/**
 * Linked clips (docs/PROPOSAL_EDITOR_REDESIGN.md R8.6): a picture and its sound on a row of
 * its own, each naming the other in `linkedClipId`. They move, trim, slip, split and are
 * deleted together; Unlink (or a selection made alone, Alt-click) lets one go by itself.
 *
 * These are the rules, kept apart from the store so they can be tested on plain projects.
 * The store's clip actions (`clip-slice.ts`) call them.
 */

/** A frame's worth of clip is the least a trim leaves (as the drag always allowed). */
export const MIN_CLIP_S = 0.1;

export function findClip(project: Project, clipId: string): Clip | undefined {
  for (const track of project.timeline.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return clip;
  }
  return undefined;
}

/** The clip linked to `clipId`, only when the link holds both ways. */
export function partnerOf(project: Project, clipId: string): Clip | undefined {
  const clip = findClip(project, clipId);
  if (!clip?.linkedClipId) return undefined;
  const partner = findClip(project, clip.linkedClipId);
  return partner && partner.linkedClipId === clip.id ? partner : undefined;
}

/**
 * `ids` with the second of each linked pair dropped, so an edit run over a selection that
 * holds both halves of a pair edits the pair once - the store's action carries the other.
 */
export function collapseLinked(project: Project, ids: readonly string[]): string[] {
  const kept: string[] = [];
  const covered = new Set<string>();
  for (const id of ids) {
    if (covered.has(id)) continue;
    kept.push(id);
    covered.add(id);
    const partner = partnerOf(project, id);
    if (partner) covered.add(partner.id);
  }
  return kept;
}

/** The length of a clip's source, in seconds; Infinity when the library does not know. */
export function sourceDuration(project: Project, clip: Pick<Clip, "mediaId">): number {
  const item = project.mediaLibrary.items.find((m) => m.id === clip.mediaId);
  const d = item?.metadata?.duration;
  return typeof d === "number" && d > 0 ? d : Infinity;
}

type Edge = Pick<Clip, "startTime" | "duration" | "inPoint" | "outPoint">;

/**
 * How far an edge of `clip` may move, as [least, most] seconds of timeline, with its start
 * fixed on the right edge and its end fixed on the left - a trim as Premiere makes it: the
 * frames stay where they are on the timeline and the head (or tail) comes off, or comes
 * back as far as the source has it.
 */
export function edgeRange(clip: Edge, edge: "left" | "right", source: number): [number, number] {
  if (edge === "left") {
    // Moving the left edge by d: start += d, in += d. In may not go below 0 nor the start
    // below 0; the clip keeps at least MIN_CLIP_S.
    const least = -Math.min(clip.inPoint, clip.startTime);
    const most = clip.duration - MIN_CLIP_S;
    return [least, most];
  }
  // Moving the right edge by d: out += d. Out may not pass the end of the source.
  const least = -(clip.duration - MIN_CLIP_S);
  const most = Number.isFinite(source) ? source - clip.outPoint : Infinity;
  return [least, most];
}

/** Where `clip` lands when its `edge` moves by `d` seconds (already inside `edgeRange`). */
export function edgeTrimmed(clip: Edge, edge: "left" | "right", d: number): Edge {
  if (edge === "left") {
    return {
      startTime: clip.startTime + d,
      inPoint: clip.inPoint + d,
      outPoint: clip.outPoint,
      duration: clip.duration - d,
    };
  }
  return {
    startTime: clip.startTime,
    inPoint: clip.inPoint,
    outPoint: clip.outPoint + d,
    duration: clip.duration + d,
  };
}

/** `d` held inside every range given, the tightest of them winning. */
export function clampInto(d: number, ranges: ReadonlyArray<[number, number]>): number {
  let lo = -Infinity;
  let hi = Infinity;
  for (const [a, b] of ranges) {
    lo = Math.max(lo, a);
    hi = Math.min(hi, b);
  }
  if (hi < lo) return 0;
  return Math.min(Math.max(d, lo), hi);
}

/**
 * The partner's new in and out for a trim of `clip` to `inPoint`/`outPoint` (the store's
 * `trimClip`, which the Reference monitor's marks use): moved by the same amounts, held to
 * the partner's own source and to a frame's length.
 */
export function partnerPoints(
  clip: Pick<Clip, "inPoint" | "outPoint">,
  partner: Pick<Clip, "inPoint" | "outPoint">,
  inPoint: number | undefined,
  outPoint: number | undefined,
  partnerSource: number,
): { inPoint?: number; outPoint?: number } {
  const out: { inPoint?: number; outPoint?: number } = {};
  if (inPoint !== undefined) {
    const next = partner.inPoint + (inPoint - clip.inPoint);
    out.inPoint = Math.min(Math.max(0, next), partner.outPoint - MIN_CLIP_S);
  }
  if (outPoint !== undefined) {
    const next = partner.outPoint + (outPoint - clip.outPoint);
    const lo = (out.inPoint ?? partner.inPoint) + MIN_CLIP_S;
    out.outPoint = Math.max(lo, Math.min(next, partnerSource));
  }
  return out;
}
