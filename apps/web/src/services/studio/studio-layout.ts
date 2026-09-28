/**
 * Where each shot of a studio manifest goes on the editor's FIRST timeline, worked out
 * without touching the editor so it can be tested on its own.
 *
 * The manifest says where the Film stitch cuts every take (`start_frame` / `end_frame`,
 * from `stitch.overlap_spans` on the studio's side): a take that continues the one before
 * it opens on a repeat of that take's last moments, and the take before it runs past the
 * frame the next one began from. Laid whole, a chained film shows 7-16 frames twice (0.9 s
 * at an overlap seam). So each clip is placed with those frames as its in and out points -
 * a trim of the CLIP, not of the media: the whole take stays in the library and the trim
 * handles drag back over it. A seam that `continues` butts with no gap and no transition.
 *
 * Where the manifest sends `lead_in_ms`, the previous shot's own sound runs that long past
 * its out point, fading out, under the start of this one - the Film stitch's
 * `prepare_shot(lead_in=...)`, which fills the 20-30 ms of near silence every H3 take opens
 * on. It is taken from the previous shot's `audio` (the take's lossless master, sample-for-
 * sample the sound in its mp4) and laid as its own short clip, because a video clip on an
 * audio track would also be drawn.
 */
import type { StudioShot } from "./studio-client";

export interface PlannedClip {
  /** Index into the manifest's `shots`. */
  shot: number;
  startTime: number;
  inPoint: number;
  outPoint: number;
  /** The crossfade from the clip placed before this one; 0 for none. */
  crossfadeIn: number;
}

export interface PlannedLeadIn {
  /** The shot whose sound it is (its `audio`). */
  from: number;
  /** The shot it goes under. */
  to: number;
  startTime: number;
  inPoint: number;
  /** Seconds; the fade out runs the whole of it, as the stitch's `afade` does. */
  duration: number;
}

export interface TimelinePlan {
  clips: PlannedClip[];
  leadIns: PlannedLeadIn[];
}

/** Half a frame: less than that left of a clip after its trim is a span that cannot be
 *  right, and the clip is laid whole rather than as nothing. */
const MIN_FRAMES = 0.5;

/**
 * `durationOf(shot, index)` is the length in seconds of the imported video (its media
 * metadata; the manifest's `video.duration_s` when that is not known) - what an `end_frame`
 * of null runs to, and the ceiling any `end_frame` is held under.
 *
 * Positions are kept as a count of frames and divided by the frame rate once, so a clip
 * that starts on frame N starts at exactly N / fps - the instant the export renders frame N
 * at - rather than at a sum of rounded seconds.
 */
export function planTimeline(
  shots: readonly StudioShot[],
  fps: number,
  durationOf: (shot: StudioShot, index: number) => number,
): TimelinePlan {
  const rate = fps > 0 ? fps : 24;
  const clips: PlannedClip[] = [];
  const leadIns: PlannedLeadIn[] = [];
  let at = 0; // frames
  let pendingCrossfade = 0;
  let prevPlaced = -1;

  shots.forEach((s, i) => {
    if (!s.video) return;
    const whole = Math.max(0, durationOf(s, i) || s.video.duration_s || 0);
    const wholeFrames = whole * rate;
    // In frames, so a span of whole frames moves the next clip on by exactly that many.
    let inF = Math.max(0, s.start_frame ?? 0);
    let outF = s.end_frame == null ? wholeFrames : s.end_frame;
    if (wholeFrames > 0) outF = Math.min(outF, wholeFrames);
    if (outF - inF < MIN_FRAMES) {
      inF = 0;
      outF = wholeFrames;
    }
    const inPoint = inF / rate;
    const outPoint = outF / rate;
    // A continuation joins the shot before it with nothing between them, whatever the
    // shot before says; the studio sends 0 there already, so this is only a guard.
    const joined = Boolean(s.continues) && prevPlaced === i - 1;
    const clip: PlannedClip = {
      shot: i,
      startTime: at / rate,
      inPoint,
      outPoint,
      crossfadeIn: joined ? 0 : pendingCrossfade,
    };
    clips.push(clip);

    const ms = s.lead_in_ms ?? 0;
    const prev = i > 0 ? shots[i - 1] : undefined;
    if (ms > 0 && prev && prevPlaced === i - 1 && prev.audio && prev.end_frame != null) {
      const leadIn = prev.end_frame / rate;
      const length = prev.audio.duration_s || 0;
      if (!(length > 0) || leadIn < length) {
        leadIns.push({
          from: i - 1,
          to: i,
          startTime: clip.startTime,
          inPoint: leadIn,
          duration: length > 0 ? Math.min(ms / 1000, length - leadIn) : ms / 1000,
        });
      }
    }

    const next = shots[i + 1];
    const intoNext = Boolean(next?.continues && next.video);
    at += outF - inF + (intoNext ? 0 : (s.gap_s || 0) * rate);
    pendingCrossfade = intoNext ? 0 : s.crossfade_s || 0;
    prevPlaced = i;
  });

  return { clips, leadIns };
}
