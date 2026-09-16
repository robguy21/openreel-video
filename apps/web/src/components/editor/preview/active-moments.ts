import type { Clip, Moment, Track } from "@openreel/core";
import { getMoment } from "@openreel/core";

export interface ActiveMoment {
  clip: Clip;
  moment: Moment;
}

/**
 * Moments whose window contains `time` (inclusive start, exclusive end).
 * Only clips on "moments" tracks count; the no-overlap rule means at most one
 * per time in practice, but callers get a list so they never have to assume.
 */
export function getActiveMoments(
  tracks: readonly Track[],
  time: number,
): ActiveMoment[] {
  const active: ActiveMoment[] = [];
  for (const track of tracks) {
    if (track.type !== "moments") continue;
    for (const clip of track.clips) {
      if (time < clip.startTime || time >= clip.startTime + clip.duration) {
        continue;
      }
      const moment = getMoment(clip);
      if (moment) active.push({ clip, moment });
    }
  }
  return active.sort((a, b) => a.clip.startTime - b.clip.startTime);
}
