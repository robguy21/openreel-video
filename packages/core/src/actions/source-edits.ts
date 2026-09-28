import type { Clip, Track, Transition } from "../types/timeline";

/**
 * Insert and Overwrite, the two edits that place a marked span of a source at the
 * playhead (docs/PROPOSAL_EDITOR_REDESIGN.md R7). Pure: each takes the tracks and returns
 * new ones, and every id it makes comes from the params (filled in on the first run), so
 * a redo builds the same timeline and undo (`clip/restoreTracks`) puts back exactly what
 * was there.
 *
 * - **Insert** ripples: a clip crossing the playhead on ANY track is split there, and
 *   everything at or after it on every track moves right by the span's length, so
 *   narration and seam sounds stay with their shots.
 * - **Overwrite** moves nothing: on the target tracks, whatever lies between the playhead
 *   and the span's end is trimmed or removed, then the span is placed.
 *
 * The placed clips are the picture and, when it has one, its sound; two are linked.
 * Speed changes are not accounted for, as in `clip/split`.
 */

export interface EditPlacement {
  /** The id the new clip takes; the caller makes it, so a redo makes the same clip. */
  clipId: string;
  trackId: string;
  mediaId: string;
  inPoint: number;
  outPoint: number;
  volume?: number;
}

export interface SourceEditParams {
  /** The playhead, in timeline seconds. */
  at: number;
  /** The picture first, then its sound; one of either on its own is fine. */
  clips: EditPlacement[];
  /** The ids given to the right-hand pieces of clips cut in two, by the cut clip's id.
   *  Empty on the first run; the executor records what it made so a redo reuses them. */
  cutIds?: Record<string, string>;
}

type MutableClip = { -readonly [K in keyof Clip]: Clip[K] };
type MutableTrack = Omit<Track, "clips" | "transitions"> & { clips: Clip[]; transitions: Transition[] };

const EPS = 1e-6;

export function spanOf(params: SourceEditParams): number {
  return Math.max(0, ...params.clips.map((c) => c.outPoint - c.inPoint));
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `clip-${Math.random().toString(36).slice(2)}`;
}

/** The right-hand piece's id for `clipId`, made once and remembered in the params. */
function cutIdFor(params: SourceEditParams, clipId: string): string {
  params.cutIds = params.cutIds ?? {};
  params.cutIds[clipId] = params.cutIds[clipId] ?? newId();
  return params.cutIds[clipId];
}

function placedClip(p: EditPlacement, at: number): Clip {
  const duration = p.outPoint - p.inPoint;
  return {
    id: p.clipId,
    mediaId: p.mediaId,
    trackId: p.trackId,
    startTime: at,
    duration,
    inPoint: p.inPoint,
    outPoint: p.outPoint,
    effects: [],
    audioEffects: [],
    transform: {
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      anchor: { x: 0.5, y: 0.5 },
      opacity: 1,
      fitMode: "contain",
    },
    volume: p.volume ?? 1,
    keyframes: [],
  } as Clip;
}

/** Link the placed pair, then drop links whose partner is gone and re-link the right-hand
 *  pieces of a pair cut in two. */
function tidyLinks(tracks: MutableTrack[], params: SourceEditParams): MutableTrack[] {
  const all = new Map<string, Clip>();
  for (const t of tracks) for (const c of t.clips) all.set(c.id, c);
  const link = new Map<string, string | undefined>();
  const [a, b] = params.clips;
  if (a && b) {
    link.set(a.clipId, b.clipId);
    link.set(b.clipId, a.clipId);
  }
  for (const [cutFrom, right] of Object.entries(params.cutIds ?? {})) {
    const left = all.get(cutFrom);
    const partner = left?.linkedClipId;
    const partnerRight = partner ? params.cutIds?.[partner] : undefined;
    if (all.has(right)) link.set(right, partnerRight && all.has(partnerRight) ? partnerRight : undefined);
  }
  return tracks.map((t) => ({
    ...t,
    clips: t.clips.map((c) => {
      const want = link.has(c.id) ? link.get(c.id) : c.linkedClipId;
      const kept = want && all.has(want) ? want : undefined;
      return kept === c.linkedClipId ? c : ({ ...c, linkedClipId: kept } as Clip);
    }),
  }));
}

/** Transitions whose clip has gone are dropped; one leaving a clip that was cut in two
 *  now leaves its right-hand piece, which is the one next to what follows. */
function tidyTransitions(tracks: MutableTrack[], params: SourceEditParams): MutableTrack[] {
  return tracks.map((t) => {
    const ids = new Set(t.clips.map((c) => c.id));
    const transitions = (t.transitions ?? [])
      .map((tr) => {
        const right = params.cutIds?.[tr.clipAId];
        return right && ids.has(right) && tr.clipBId && tr.clipBId !== right
          ? { ...tr, clipAId: right }
          : tr;
      })
      .filter((tr) => ids.has(tr.clipAId) && (!tr.clipBId || ids.has(tr.clipBId)));
    return { ...t, transitions };
  });
}

function mutable(tracks: readonly Track[]): MutableTrack[] {
  return tracks.map((t) => ({ ...t, clips: [...t.clips], transitions: [...(t.transitions ?? [])] }));
}

export function insertEdit(tracks: readonly Track[], params: SourceEditParams): Track[] {
  const { at } = params;
  const span = spanOf(params);
  let next = mutable(tracks).map((t) => {
    const clips: Clip[] = [];
    for (const c of t.clips) {
      const end = c.startTime + c.duration;
      if (c.startTime < at - EPS && end > at + EPS) {
        const offset = at - c.startTime;
        clips.push({ ...c, duration: offset, outPoint: c.inPoint + offset } as Clip);
        clips.push({
          ...c,
          id: cutIdFor(params, c.id),
          startTime: at + span,
          duration: c.duration - offset,
          inPoint: c.inPoint + offset,
        } as Clip);
      } else if (c.startTime >= at - EPS) {
        clips.push({ ...c, startTime: c.startTime + span } as Clip);
      } else {
        clips.push(c);
      }
    }
    return { ...t, clips };
  });
  next = next.map((t) => ({
    ...t,
    clips: [...t.clips, ...params.clips.filter((p) => p.trackId === t.id).map((p) => placedClip(p, at))],
  }));
  return tidyTransitions(tidyLinks(next, params), params) as unknown as Track[];
}

export function overwriteEdit(tracks: readonly Track[], params: SourceEditParams): Track[] {
  const { at } = params;
  const end = at + spanOf(params);
  const targets = new Set(params.clips.map((p) => p.trackId));
  let next = mutable(tracks).map((t) => {
    if (!targets.has(t.id)) return t;
    const clips: Clip[] = [];
    for (const c of t.clips) {
      const cEnd = c.startTime + c.duration;
      if (cEnd <= at + EPS || c.startTime >= end - EPS) {
        clips.push(c); // clear of the span
        continue;
      }
      const head = c.startTime < at - EPS ? at - c.startTime : 0;
      const tail = cEnd > end + EPS ? cEnd - end : 0;
      if (head > 0) {
        clips.push({ ...c, duration: head, outPoint: c.inPoint + head } as MutableClip as Clip);
      }
      if (tail > 0) {
        const cut = c.duration - tail;
        clips.push({
          ...c,
          // the clip keeps its id when only its head is covered; a clip cut in two
          // gives its right-hand piece a new one
          id: head > 0 ? cutIdFor(params, c.id) : c.id,
          startTime: end,
          duration: tail,
          inPoint: c.inPoint + cut,
        } as Clip);
      }
    }
    clips.push(...params.clips.filter((p) => p.trackId === t.id).map((p) => placedClip(p, at)));
    return { ...t, clips };
  });
  next = tidyLinks(next, params);
  return tidyTransitions(next, params) as unknown as Track[];
}
