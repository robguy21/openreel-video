import { create } from "zustand";
import type { Clip } from "@openreel/core";

/**
 * The Reference monitor's state (docs/PROPOSAL_EDITOR_REDESIGN.md R5): what it holds,
 * the marks on it, which monitor the keyboard drives, and whether it is shown.
 *
 * It holds the WHOLE of one source, never a trimmed clip:
 * - the film as the studio's Stitch cut it, when nothing else is picked (Robert,
 *   2026-09-28: "the output of the old stitch feature, passed as the source");
 * - a media item clicked in the Media tab;
 * - the media item behind a clip selected on the timeline, whose in and out are then
 *   the marks - and moving a mark trims that clip.
 *
 * Marks on anything but a timeline clip are source marks for Insert and Overwrite, kept
 * per source in memory and never saved.
 */

export type ReferenceKind = "video" | "audio" | "image";

export interface ReferenceSource {
  /** One per source: the marks are kept under it. */
  key: string;
  origin: "film" | "media" | "clip";
  name: string;
  kind: ReferenceKind;
  /** The media item, for "media" and "clip"; its url is made when it is shown. */
  mediaId?: string;
  /** A plain url, for the film. */
  url?: string;
  /** The timeline clip whose marks these are, for "clip". */
  clipId?: string;
  /** Seconds, when known before the player loads it. */
  duration?: number;
  fps: number;
  /** Where to start, in the source's own seconds. */
  startAt?: number;
}

export interface Marks {
  in: number | null;
  out: number | null;
}

export type MonitorFocus = "reference" | "edit";

export interface ReferenceState {
  source: ReferenceSource | null;
  marks: Record<string, Marks>;
  focus: MonitorFocus;
  hidden: boolean;
  /** Bumped to ask the player to seek to `source.startAt` again (a clip re-selected). */
  seekNonce: number;
  load: (source: ReferenceSource, marks?: Marks) => void;
  clear: () => void;
  setMarks: (key: string, marks: Marks) => void;
  setFocus: (focus: MonitorFocus) => void;
  setHidden: (hidden: boolean) => void;
}

export const REFERENCE_HIDDEN_KEY = "openreel-layout-reference-hidden";

function readHidden(): boolean {
  try {
    return window.localStorage.getItem(REFERENCE_HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}

export const useReferenceStore = create<ReferenceState>()((set) => ({
  source: null,
  marks: {},
  focus: "edit",
  hidden: typeof window === "undefined" ? false : readHidden(),
  seekNonce: 0,
  load: (source, marks) =>
    set((state) => ({
      source,
      seekNonce: state.seekNonce + 1,
      marks: marks ? { ...state.marks, [source.key]: marks } : state.marks,
    })),
  clear: () => set({ source: null }),
  setMarks: (key, marks) => set((state) => ({ marks: { ...state.marks, [key]: marks } })),
  setFocus: (focus) => set({ focus }),
  setHidden: (hidden) => {
    try {
      window.localStorage.setItem(REFERENCE_HIDDEN_KEY, hidden ? "1" : "0");
    } catch {
      /* a per-browser convenience; nothing is lost without it */
    }
    set({ hidden });
  },
}));

/** A timeline clip's source span as marks: where it starts and ends in its media. */
export function clipMarks(clip: Pick<Clip, "inPoint" | "outPoint">): Marks {
  return { in: clip.inPoint, out: clip.outPoint };
}

/** Where the clip's current frame falls in its source, for a playhead on the timeline. */
export function sourceTimeAt(
  clip: Pick<Clip, "startTime" | "duration" | "inPoint">,
  playhead: number,
): number {
  const into = Math.min(Math.max(playhead - clip.startTime, 0), clip.duration);
  return clip.inPoint + into;
}

/**
 * Where a mark on a timeline clip may go (R5.5: the clip is trimmed, `startTime` does
 * not move and nothing ripples). Moving In earlier or Out later lengthens the clip at its
 * end, so the end may not pass the next clip on the same track; In stays at least a
 * frame before Out and Out a frame after In; neither leaves the source. Returns the
 * value to trim to, or null when there is no room at all.
 */
export function clampClipMark(
  which: "in" | "out",
  value: number,
  clip: Pick<Clip, "id" | "startTime" | "inPoint" | "outPoint">,
  trackClips: ReadonlyArray<Pick<Clip, "id" | "startTime">>,
  sourceDuration: number,
  frame: number,
): number | null {
  const clipEnd = clip.startTime + (clip.outPoint - clip.inPoint);
  const next = trackClips
    .filter((c) => c.id !== clip.id && c.startTime >= clipEnd - 1e-6)
    .reduce((min, c) => Math.min(min, c.startTime), Infinity);
  const room = next - clip.startTime; // the longest the clip may be
  if (which === "in") {
    const lo = Math.max(0, clip.outPoint - room);
    const hi = clip.outPoint - frame;
    if (hi < lo) return null;
    return Math.min(Math.max(value, lo), hi);
  }
  const lo = clip.inPoint + frame;
  const hi = Math.min(sourceDuration, clip.inPoint + room);
  if (hi < lo) return null;
  return Math.min(Math.max(value, lo), hi);
}
