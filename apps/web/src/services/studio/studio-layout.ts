/**
 * Where each shot of a studio manifest goes on the editor's FIRST timeline, worked out
 * without touching the editor so it can be tested on its own. The rule is the Film
 * stitch's (`stitch.assemble` on the studio's side), so the editor's first cut and the
 * stitched film put every frame and every sound at the same instant.
 *
 * **Cut points.** The manifest says where the stitch cuts every take (`start_frame` /
 * `end_frame`, from `stitch.overlap_spans`): a take that continues the one before it opens
 * on a repeat of that take's last moments, and the take before it runs past the frame the
 * next one began from. Laid whole, a chained film shows 7-16 frames twice (0.9 s at an
 * overlap seam). So each clip is placed with those frames as its in and out points - a trim
 * of the CLIP, not of the media: the whole take stays in the library and the trim handles
 * drag back over it. A seam that `continues` butts with no gap and no transition.
 *
 * **Frames, not seconds.** Everything is counted in whole frames and divided by the frame
 * rate once, so a clip that starts on frame N starts at exactly N / fps - the instant the
 * export renders frame N at. An open `end_frame` is the video's OWN frame count
 * (`video.frames`, the studio's probe record) - never the shot's `length_frames`, which a
 * shot re-lengthed after its take was rendered no longer matches, and never the container
 * duration, which is the longer of picture and sound (a 157-frame take in a 6.575 s
 * container put every later clip 0.2 of a frame off the grid).
 *
 * **A crossfade overlaps.** The stitch's `xfade` starts the next part `crossfade_s` BEFORE
 * the previous one ends - the film is shorter by the fade - and `acrossfade`s the two
 * sounds over the same span; the fade is a whole number of frames. The editor's own clip
 * transition is centred on a butted cut instead, and a track holds one clip at a time, so
 * the two clips of a fade go on two tracks, overlapping by the fade: `lane` 0 is the
 * "Shots" track and each lane above it a track above that. The picture is the fork's own
 * edge transition on whichever of the pair is on top - it fades out over the clip below
 * (`pictureOut`) or in over it (`pictureIn`) - so the frame is `A * (1 - p) + B * p`, which
 * is what `xfade=fade` makes; the sound is each clip's own linear fade (`soundFadeIn` /
 * `soundFadeOut`), which is what `acrossfade`'s default curves make. A run of fades
 * alternates between two tracks; only a fade across the author's gap climbs to a third.
 *
 * **A gap** is the stitch's `tpad`: black after the part, whole frames. A crossfade after a
 * gap overlaps the gap first - the next clip fades in over black - and only the part of
 * the fade longer than the gap reaches the previous clip.
 *
 * **Narration** starts `narration_delay_ms` into its shot, and the take's own sound (and a
 * lead-in under it) plays at `narration_duck` for the whole of that shot, as `prepare_shot`
 * mixes it. The stitch's narration stops where its part stops; here it is laid whole, as
 * it always was - whether a long voice-over is cut is not decided here.
 *
 * **The lead-in.** Where the manifest sends `lead_in_ms`, the previous shot's own sound
 * runs that long past its out point, fading out, under the start of this one - the
 * stitch's `prepare_shot(lead_in=...)`, which fills the 20-30 ms of near silence every H3
 * take opens on. It is taken from the previous shot's `audio` (the take's lossless master,
 * sample-for-sample the sound in its mp4) and laid as its own short clip, because a video
 * clip on an audio track would also be drawn.
 */
import type { StudioShot } from "./studio-client";

export interface PlannedClip {
  /** Index into the manifest's `shots`. */
  shot: number;
  startTime: number;
  inPoint: number;
  outPoint: number;
  /** 0 = the "Shots" track; n = the n-th track above it. */
  lane: number;
  /** Seconds of the picture's edge transition at the clip's start / end, 0 for none: the
   *  clip on top of a crossfade fading in over, or out over, the clip below it. */
  pictureIn: number;
  pictureOut: number;
  /** Seconds of the clip's own sound fading in / out: the two halves of a crossfade. */
  soundFadeIn: number;
  soundFadeOut: number;
  /** The level of the take's own sound: `narration_duck` under a narration, else 1. */
  volume: number;
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
  /** Ducked with the sound of the shot it goes under, as the stitch mixes it. */
  volume: number;
}

export interface PlannedNarration {
  shot: number;
  startTime: number;
}

export interface TimelinePlan {
  clips: PlannedClip[];
  leadIns: PlannedLeadIn[];
  narrations: PlannedNarration[];
  /** How many tracks the shots need: 1 + the highest lane. */
  lanes: number;
}

export interface PlanOptions {
  /** `manifest.narration_delay_ms`; absent, a narration starts with its shot. */
  narrationDelayMs?: number;
  /** `manifest.narration_duck`; absent, the take plays at full level under it. */
  narrationDuck?: number;
  /** Whether shot i has a narration laid; by default, whether the manifest has one to lay
   *  (a url, and the shot's narration switched on). */
  narrated?: (shot: StudioShot, index: number) => boolean;
}

/** Half a frame: less than that left of a clip after its trim is a span that cannot be
 *  right, and the clip is laid whole rather than as nothing. */
const MIN_FRAMES = 0.5;

/**
 * The video's own length in frames: `video.frames` from the manifest, or - from a studio
 * that does not send it - the imported media's duration (`durationOf`, falling back to
 * `video.duration_s`), whole frames rounded DOWN, because a container runs to the end of
 * its longer stream and it is the sound that runs past the picture.
 */
function framesOf(s: StudioShot, i: number, rate: number, durationOf: PlanDuration): number {
  const counted = s.video?.frames;
  if (counted && counted > 0) return counted;
  const seconds = Math.max(0, durationOf(s, i) || s.video?.duration_s || 0);
  return Math.floor(seconds * rate + 0.01);
}

type PlanDuration = (shot: StudioShot, index: number) => number;

const defaultNarrated = (s: StudioShot) => Boolean(s.narration?.url && s.include_vo);

/**
 * `durationOf(shot, index)` is the length in seconds of the imported video, asked only
 * when the manifest has no `video.frames` for it.
 */
export function planTimeline(
  shots: readonly StudioShot[],
  fps: number,
  durationOf: PlanDuration,
  options: PlanOptions = {},
): TimelinePlan {
  const rate = fps > 0 ? fps : 24;
  const delay = Math.max(0, options.narrationDelayMs ?? 0) / 1000;
  const duck = options.narrationDuck ?? 1;
  const narrated = options.narrated ?? defaultNarrated;
  const clips: PlannedClip[] = [];
  const leadIns: PlannedLeadIn[] = [];
  const narrations: PlannedNarration[] = [];
  // In frames. `at` is where the next clip starts when nothing overlaps it: the end of the
  // clip before it plus that clip's gap.
  let at = 0;
  let prev: { clip: PlannedClip; frames: number; gap: number; fade: number } | null = null;
  let lanes = 1;

  shots.forEach((s, i) => {
    if (!s.video) return;
    const whole = framesOf(s, i, rate, durationOf);
    let inF = Math.max(0, s.start_frame ?? 0);
    let outF = s.end_frame == null ? whole : s.end_frame;
    if (whole > 0) outF = Math.min(outF, whole);
    if (outF - inF < MIN_FRAMES) {
      inF = 0;
      outF = whole;
    }
    const length = outF - inF;
    // The clip laid before this one, which is the shot before it unless that shot has no
    // take (the stitch joins the shots it has, with their own gaps and fades).
    const after = prev;
    const adjacent = after !== null && after.clip.shot === i - 1;
    // A continuation joins the shot before it with nothing between them, whatever the
    // shot before says; the studio sends 0 there already, so this is only a guard.
    const joined = Boolean(s.continues) && adjacent;
    // Never longer than either side of it: xfade cannot fade over more than it has.
    const fade = after && !joined ? Math.min(after.fade, after.frames + after.gap, length) : 0;
    const level = narrated(s, i) ? duck : 1;
    const clip: PlannedClip = {
      shot: i,
      startTime: (at - fade) / rate,
      inPoint: inF / rate,
      outPoint: outF / rate,
      lane: 0,
      pictureIn: 0,
      pictureOut: 0,
      soundFadeIn: 0,
      soundFadeOut: 0,
      volume: level,
    };
    if (after && fade > 0) {
      const seconds = fade / rate;
      // How much of the fade reaches the previous clip rather than its gap's black.
      const overlap = fade - after.gap;
      clip.soundFadeIn = seconds;
      after.clip.soundFadeOut = Math.max(0, overlap) / rate;
      if (overlap <= 0) {
        // Entirely over the black of the gap: the two never meet, so the same track, and
        // this clip fades in from the background.
        clip.lane = after.clip.lane;
        clip.pictureIn = seconds;
      } else if (after.gap === 0 && after.clip.lane > 0) {
        // The previous clip is on top: it fades out over this one, laid under it.
        clip.lane = after.clip.lane - 1;
        after.clip.pictureOut = seconds;
      } else {
        // This one goes on top and fades in over the previous clip (and, after a gap
        // shorter than the fade, over the black that follows it).
        clip.lane = after.clip.lane + 1;
        clip.pictureIn = seconds;
      }
      lanes = Math.max(lanes, clip.lane + 1);
    }
    clips.push(clip);

    if (narrated(s, i)) {
      narrations.push({ shot: i, startTime: clip.startTime + delay });
    }

    const ms = s.lead_in_ms ?? 0;
    const prevShot = i > 0 ? shots[i - 1] : undefined;
    if (ms > 0 && prevShot && adjacent && prevShot.audio && prevShot.end_frame != null) {
      const leadIn = prevShot.end_frame / rate;
      const soundLength = prevShot.audio.duration_s || 0;
      if (!(soundLength > 0) || leadIn < soundLength) {
        leadIns.push({
          from: i - 1,
          to: i,
          startTime: clip.startTime,
          inPoint: leadIn,
          duration: soundLength > 0 ? Math.min(ms / 1000, soundLength - leadIn) : ms / 1000,
          volume: level,
        });
      }
    }

    const next = shots[i + 1];
    const intoNext = Boolean(next?.continues && next.video);
    const gap = intoNext ? 0 : Math.round((s.gap_s || 0) * rate);
    at = at - fade + length + gap;
    prev = {
      clip,
      frames: length,
      gap,
      fade: intoNext ? 0 : Math.round((s.crossfade_s || 0) * rate),
    };
  });

  return { clips, leadIns, narrations, lanes };
}
