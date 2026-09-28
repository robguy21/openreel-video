import { v4 as uuidv4 } from "uuid";
import type { StoreApi } from "zustand";
import type {
  Action,
  ActionResult,
  Clip,
  ClipMetadata,
  MediaItem,
  MomentKind,
  Track,
} from "@openreel/core";
import {
  createMoment,
  findMomentOverlap,
  MOMENT_LANE_NAMES,
  MOMENT_MEDIA_PREFIX,
  MOMENT_RULE_MESSAGES,
  momentLaneRole,
  momentTrackRole,
} from "@openreel/core";
import { toast } from "../notification-store";
import type { ProjectState } from "../project-store";
import { calculateTimelineDuration } from "./index";
import { useTimelineStore } from "../timeline-store";
import { useUIStore } from "../ui-store";
import {
  clampInto,
  edgeRange,
  edgeTrimmed,
  findClip,
  partnerOf,
  partnerPoints,
  sourceDuration,
} from "./linked-clips";

/** Default length of a freshly added moment, in seconds. */
export const DEFAULT_MOMENT_DURATION = 5;

type Get = StoreApi<ProjectState>["getState"];
type Set = StoreApi<ProjectState>["setState"];

export type ClipSlice = Pick<
  ProjectState,
  | "addClip"
  | "addClipToNewTrack"
  | "separateAudio"
  | "removeClip"
  | "moveClip"
  | "closeGapBeforeClip"
  | "moveClips"
  | "trimClip"
  | "splitClip"
  | "rippleDeleteClip"
  | "slipClip"
  | "slideClip"
  | "rollEdit"
  | "trimToPlayhead"
  | "trimClipEdge"
  | "linkClips"
  | "unlinkClip"
  | "placeFromSource"
  | "getClip"
  | "setClipMetadata"
  | "addMoment"
>;

/**
 * A video's sound stream `index` as an audio media item of its own (R7.6): extracted to WAV
 * by core's `extractAudioWav` and imported, once - a second Separate Audio of the same
 * video reuses it. Returns the item's id, or null when the video's data is not here or
 * the extraction fails. Replaceable for tests (`setSoundFileMaker`).
 */
type SoundFileMaker = (
  video: MediaItem,
  index: number,
  importMedia: ProjectState["importMedia"],
  existing: readonly MediaItem[],
) => Promise<string | null>;

const defaultSoundFileMaker: SoundFileMaker = async (video, index, importMedia, existing) => {
  const name = `${video.name.replace(/\.[^.]+$/, "")} sound${index ? ` ${index + 1}` : ""}.wav`;
  const had = existing.find((m) => m.type === "audio" && m.name === name);
  if (had) return had.id;
  if (!video.blob) return null;
  try {
    const { extractAudioWav } = await import("@openreel/core/media");
    const wav = await extractAudioWav(video.blob, index);
    const result = await importMedia(new File([wav], name, { type: "audio/wav" }));
    return result.success && result.actionId ? result.actionId : null;
  } catch {
    return null;
  }
};

let soundFileMaker: SoundFileMaker = defaultSoundFileMaker;

export function setSoundFileMaker(maker: SoundFileMaker | null): void {
  soundFileMaker = maker ?? defaultSoundFileMaker;
}

export function createClipSlice(set: Set, get: Get): ClipSlice {
  /** One action through the executor, the project republished when it succeeds. */
  const run = async (type: string, params: Record<string, unknown>): Promise<ActionResult> => {
    const { project, actionExecutor } = get();
    const action = { type, id: uuidv4(), timestamp: Date.now(), params } as unknown as Action;
    const result = await actionExecutor.execute(action, project);
    if (result.success) set({ project: { ...project } });
    return result;
  };

  /** Several actions as one undo step. */
  const grouped = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
    const history = get().actionExecutor.getHistory();
    history.beginGroup(label);
    try {
      return await fn();
    } finally {
      history.endGroup();
    }
  };

  /**
   * The clip an edit of `clipId` carries along (R8.6): its linked partner, unless the
   * selection was made alone (Alt-click). Undefined when there is none to carry.
   */
  const soundFileFor = (video: MediaItem, index: number) =>
    soundFileMaker(video, index, get().importMedia, get().project.mediaLibrary.items);

  const follower = (clipId: string): Clip | undefined =>
    useUIStore.getState().linkAlone ? undefined : partnerOf(get().project, clipId);

  return {
    addClip: async (trackId: string, mediaId: string, startTime: number) => {
      const { project, actionExecutor } = get();
      const projectCopy = structuredClone(project);
      const action: Action = {
        type: "clip/add",
        id: uuidv4(),
        timestamp: Date.now(),
        params: { trackId, mediaId, startTime },
      };
      const result = await actionExecutor.execute(action, projectCopy);
      if (result.success) {
        set({ project: { ...projectCopy, modifiedAt: Date.now() } });
      }
      return result;
    },

    setClipMetadata: async (
      clipId: string,
      metadata: Partial<ClipMetadata>,
    ) => {
      const { project, actionExecutor } = get();
      const projectCopy = structuredClone(project);
      const action: Action = {
        type: "clip/setMetadata",
        id: uuidv4(),
        timestamp: Date.now(),
        params: { clipId, metadata },
      };
      const result = await actionExecutor.execute(action, projectCopy);
      if (result.success) {
        set({ project: { ...projectCopy, modifiedAt: Date.now() } });
      }
      return result;
    },

    addMoment: async (kind: MomentKind, startTime?: number, trackId?: string) => {
      const { project, addTrack } = get();
      // Catalogues live on their own lane so they may coincide with the rest.
      const lane = momentTrackRole(kind);
      const isLane = (t: Track) =>
        t.type === "moments" && momentLaneRole(t) === lane;
      let momentTrack = trackId
        ? project.timeline.tracks.find((t) => t.id === trackId)
        : project.timeline.tracks.find(isLane);

      if (!momentTrack) {
        const trackResult = await addTrack("moments", undefined, {
          name: MOMENT_LANE_NAMES[lane],
          role: lane,
        });
        if (!trackResult.success) return trackResult;
        momentTrack = get().project.timeline.tracks.find(isLane);
      }
      if (!momentTrack) {
        return {
          success: false,
          error: {
            code: "TRACK_NOT_FOUND" as const,
            message: "Could not find a moments track",
          },
        };
      }

      const clipId = uuidv4();
      const moment = createMoment(kind);
      const clipStartTime = Math.max(
        0,
        startTime ?? useTimelineStore.getState().playheadPosition,
      );
      const { project: currentProject, actionExecutor } = get();
      const liveTrack = currentProject.timeline.tracks.find(
        (t) => t.id === momentTrack.id,
      );
      if (
        liveTrack &&
        findMomentOverlap(liveTrack.clips, {
          startTime: clipStartTime,
          duration: DEFAULT_MOMENT_DURATION,
        })
      ) {
        toast.error(
          MOMENT_RULE_MESSAGES.NO_OVERLAP,
          "Move the playhead to a free spot",
        );
        return {
          success: false,
          error: {
            code: "OVERLAP_DETECTED" as const,
            message: MOMENT_RULE_MESSAGES.NO_OVERLAP,
          },
        };
      }
      const projectCopy = structuredClone(currentProject);
      const action: Action = {
        type: "clip/add",
        id: uuidv4(),
        timestamp: Date.now(),
        params: {
          trackId: momentTrack.id,
          mediaId: `${MOMENT_MEDIA_PREFIX}${clipId}`,
          startTime: clipStartTime,
          clipId,
          duration: DEFAULT_MOMENT_DURATION,
          inPoint: 0,
          outPoint: DEFAULT_MOMENT_DURATION,
          metadata: { moment },
        } as Action["params"],
      };
      const result = await actionExecutor.execute(action, projectCopy);
      if (result.success) {
        set({ project: { ...projectCopy, modifiedAt: Date.now() } });
        useUIStore
          .getState()
          .select({ type: "clip", id: clipId, trackId: momentTrack.id });
      }
      return { ...result, actionId: clipId };
    },

    addClipToNewTrack: async (mediaId: string, startTime?: number) => {
      const { project, addTrack, getMediaItem } = get();
      const mediaItem = getMediaItem(mediaId);
      if (!mediaItem) {
        return {
          success: false,
          error: {
            code: "MEDIA_NOT_FOUND" as const,
            message: "Media item not found",
          },
        };
      }

      let trackType: Track["type"];
      if (mediaItem.type === "video") trackType = "video";
      else if (mediaItem.type === "audio") trackType = "audio";
      else if (mediaItem.type === "image") trackType = "image";
      else trackType = "video";

      const clipStartTime =
        startTime !== undefined ? startTime : calculateTimelineDuration(project);

      const trackResult = await addTrack(trackType);
      if (!trackResult.success) return trackResult;

      const { project: updatedProject, actionExecutor: exec } = get();
      const newTrack = updatedProject.timeline.tracks.find(
        (t) => t.clips.length === 0 && t.type === trackType,
      );
      if (!newTrack) {
        return {
          success: false,
          error: {
            code: "TRACK_NOT_FOUND" as const,
            message: "Could not find newly created track",
          },
        };
      }

      const projectCopy = structuredClone(updatedProject);
      const action: Action = {
        type: "clip/add",
        id: uuidv4(),
        timestamp: Date.now(),
        params: { trackId: newTrack.id, mediaId, startTime: clipStartTime },
      };
      const result = await exec.execute(action, projectCopy);
      if (result.success) {
        set({ project: { ...projectCopy, modifiedAt: Date.now() } });
      }
      return result;
    },

    separateAudio: async (clipId: string) => {
      // R8.7: the sound goes to a row of its own directly under the picture's row - never
      // the first audio track, which in a studio film is Narration - as an AUDIO file of
      // its own (R7.6: a video on a sound row still draws its picture), carrying the
      // clip's volume and fade, linked to the picture, and the picture is muted by an
      // action. One undo step, the file import aside.
      const { project } = get();
      const videoClip = findClip(project, clipId);
      if (!videoClip) {
        return {
          success: false,
          error: { code: "CLIP_NOT_FOUND" as const, message: "Clip not found" },
        };
      }

      const mediaItem = project.mediaLibrary.items.find(
        (m) => m.id === videoClip.mediaId,
      );
      if (
        !mediaItem ||
        mediaItem.type !== "video" ||
        !mediaItem.metadata?.channels ||
        mediaItem.metadata.channels === 0
      ) {
        return {
          success: false,
          error: {
            code: "MEDIA_NOT_FOUND" as const,
            message: "Media has no audio to separate",
          },
        };
      }

      let audioTrackCount = mediaItem.metadata.audioTrackCount ?? 1;
      if (audioTrackCount <= 1 && mediaItem.blob) {
        try {
          const { getFFmpegFallback } = await import("@openreel/core/media");
          const ffmpeg = getFFmpegFallback();
          const probeResult = await ffmpeg.probeAudioStreams(mediaItem.blob);
          if (probeResult.audioStreamCount > 1) {
            audioTrackCount = probeResult.audioStreamCount;
          }
        } catch {
          // FFmpeg probe unavailable â€” proceed with count of 1
        }
      }

      // One audio file per sound stream, made once and kept in the library.
      const soundIds: string[] = [];
      for (let i = 0; i < audioTrackCount; i++) {
        const soundId = await soundFileFor(mediaItem, i);
        if (!soundId) {
          return {
            success: false,
            error: {
              code: "MEDIA_NOT_FOUND" as const,
              message: "The clip's sound could not be made into a file of its own",
            },
          };
        }
        soundIds.push(soundId);
      }

      const tracks = get().project.timeline.tracks;
      const pictureTrack = tracks.find((t) => t.id === videoClip.trackId);
      const below = tracks.findIndex((t) => t.id === videoClip.trackId) + 1;
      return grouped("Separate audio", async () => {
        let lastResult: ActionResult = { success: true };
        const soundClipIds: string[] = [];
        for (let i = 0; i < soundIds.length; i++) {
          const trackId = uuidv4();
          const name =
            (pictureTrack?.name ? `${pictureTrack.name} sound` : "Sound") +
            (soundIds.length > 1 ? ` ${i + 1}` : "");
          lastResult = await run("track/add", {
            trackType: "audio",
            trackId,
            position: below + i,
            name,
          });
          if (!lastResult.success) return lastResult;
          const soundClipId = uuidv4();
          lastResult = await run("clip/add", {
            clipId: soundClipId,
            trackId,
            mediaId: soundIds[i],
            startTime: videoClip.startTime,
            duration: videoClip.duration,
            inPoint: videoClip.inPoint,
            outPoint: videoClip.outPoint,
            speed: videoClip.speed,
            reversed: videoClip.reversed,
            volume: videoClip.volume,
            ...(videoClip.fade ? { fade: { ...videoClip.fade } } : {}),
          });
          if (!lastResult.success) return lastResult;
          soundClipIds.push(soundClipId);
        }
        await run("clip/link", { clipId, linkedClipId: soundClipIds[0] });
        await run("audio/setVolume", { clipId, volume: 0 });
        return lastResult;
      });
    },

    removeClip: async (clipId: string) => {
      const partner = follower(clipId);
      if (!partner) return run("clip/remove", { clipId });
      return grouped("Delete clips", async () => {
        const result = await run("clip/remove", { clipId });
        if (result.success) await run("clip/remove", { clipId: partner.id });
        return result;
      });
    },

    moveClip: async (clipId: string, startTime: number, trackId?: string) => {
      const clip = findClip(get().project, clipId);
      const partner = follower(clipId);
      if (!clip || !partner) return run("clip/move", { clipId, startTime, trackId });
      // The partner moves by the same amount and stays on its own row.
      const partnerStart = Math.max(0, partner.startTime + (startTime - clip.startTime));
      return grouped("Move clips", async () => {
        const result = await run("clip/move", { clipId, startTime, trackId });
        if (result.success) await run("clip/move", { clipId: partner.id, startTime: partnerStart });
        return result;
      });
    },

    closeGapBeforeClip: async (clipId: string) => {
      const { project, actionExecutor } = get();
      const action: Action = {
        type: "clip/closeGapBefore",
        id: uuidv4(),
        timestamp: Date.now(),
        params: { clipId },
      };
      const result = await actionExecutor.execute(action, project);
      if (result.success) set({ project: { ...project } });
      return result;
    },

    moveClips: async (moves) => {
      if (moves.length === 0) return { success: true };
      if (moves.length === 1) {
        return get().moveClip(
          moves[0].clipId,
          moves[0].startTime,
          moves[0].trackId,
        );
      }
      return grouped("Move clips", async () => {
        const listed = new Set(moves.map((m) => m.clipId));
        let lastResult: ActionResult = { success: true };
        for (const move of moves) {
          const clip = findClip(get().project, move.clipId);
          const partner = follower(move.clipId);
          lastResult = await run("clip/move", {
            clipId: move.clipId,
            startTime: move.startTime,
            trackId: move.trackId,
          });
          if (!lastResult.success) break;
          if (clip && partner && !listed.has(partner.id)) {
            await run("clip/move", {
              clipId: partner.id,
              startTime: Math.max(0, partner.startTime + (move.startTime - clip.startTime)),
            });
          }
        }
        return lastResult;
      });
    },

    trimClip: async (clipId: string, inPoint?: number, outPoint?: number) => {
      const clip = findClip(get().project, clipId);
      const partner = follower(clipId);
      if (!clip || !partner) return run("clip/trim", { clipId, inPoint, outPoint });
      const points = partnerPoints(
        clip,
        partner,
        inPoint,
        outPoint,
        sourceDuration(get().project, partner),
      );
      return grouped("Trim clips", async () => {
        const result = await run("clip/trim", { clipId, inPoint, outPoint });
        if (result.success) await run("clip/trim", { clipId: partner.id, ...points });
        return result;
      });
    },

    trimClipEdge: async (clipId: string, edge: "left" | "right", time: number) => {
      // A trim as Premiere makes it (Robert, 2026-09-28): the left edge takes the head off
      // (start and in move together, the frames stay put), the right edge the tail, and
      // neither goes past its source - for the clip and its partner alike, by one amount.
      const { project } = get();
      const clip = findClip(project, clipId);
      if (!clip) {
        return {
          success: false,
          error: { code: "INVALID_PARAMS" as const, message: "Clip not found" },
        };
      }
      const partner = follower(clipId);
      const want =
        edge === "left" ? time - clip.startTime : time - (clip.startTime + clip.duration);
      const ranges: Array<[number, number]> = [
        edgeRange(clip, edge, sourceDuration(project, clip)),
      ];
      if (partner) ranges.push(edgeRange(partner, edge, sourceDuration(project, partner)));
      const d = clampInto(want, ranges);
      if (Math.abs(d) < 1e-9) return { success: true };
      const apply = async (c: Clip) => {
        const next = edgeTrimmed(c, edge, d);
        if (edge === "left") {
          const r = await run("clip/trim", { clipId: c.id, inPoint: next.inPoint });
          if (r.success) await run("clip/move", { clipId: c.id, startTime: next.startTime });
          return r;
        }
        return run("clip/trim", { clipId: c.id, outPoint: next.outPoint });
      };
      return grouped("Trim clip", async () => {
        const result = await apply(clip);
        if (result.success && partner) await apply(partner);
        return result;
      });
    },

    splitClip: async (clipId: string, time: number) => {
      const partner = follower(clipId);
      const rightId = uuidv4();
      const splitsPartner =
        partner && time > partner.startTime && time < partner.startTime + partner.duration;
      if (!partner || !splitsPartner) {
        return run("clip/split", { clipId, time, newClipId: rightId });
      }
      // Both halves split at one time, and the two right-hand halves are a pair of their own.
      return grouped("Split clips", async () => {
        const result = await run("clip/split", { clipId, time, newClipId: rightId });
        if (!result.success) return result;
        const partnerRight = uuidv4();
        const other = await run("clip/split", { clipId: partner.id, time, newClipId: partnerRight });
        if (other.success) {
          await run("clip/link", { clipId: rightId, linkedClipId: partnerRight });
        }
        return result;
      });
    },

    rippleDeleteClip: async (clipId: string) => {
      const partner = follower(clipId);
      if (!partner) return run("clip/rippleDelete", { clipId });
      return grouped("Ripple delete", async () => {
        const result = await run("clip/rippleDelete", { clipId });
        if (result.success) await run("clip/rippleDelete", { clipId: partner.id });
        return result;
      });
    },

    slipClip: async (clipId: string, delta: number) => {
      const partner = follower(clipId);
      if (!partner) return run("clip/slip", { clipId, delta });
      return grouped("Slip clips", async () => {
        const result = await run("clip/slip", { clipId, delta });
        if (result.success) await run("clip/slip", { clipId: partner.id, delta });
        return result;
      });
    },

    slideClip: async (clipId: string, delta: number) => {
      const { project, actionExecutor, getClip } = get();
      const clip = getClip(clipId);
      if (!clip) {
        return {
          success: false,
          error: { code: "INVALID_PARAMS" as const, message: "Clip not found" },
        };
      }
      const track = project.timeline.tracks.find((t) =>
        t.clips.some((c) => c.id === clipId),
      );
      if (!track) {
        return {
          success: false,
          error: { code: "INVALID_PARAMS" as const, message: "Track not found" },
        };
      }
      const sortedClips = [...track.clips].sort(
        (a, b) => a.startTime - b.startTime,
      );
      const clipIndex = sortedClips.findIndex((c) => c.id === clipId);
      const prevClip = clipIndex > 0 ? sortedClips[clipIndex - 1] : undefined;
      const nextClip =
        clipIndex < sortedClips.length - 1
          ? sortedClips[clipIndex + 1]
          : undefined;

      const action: Action = {
        type: "clip/slide",
        id: uuidv4(),
        timestamp: Date.now(),
        params: {
          clipId,
          delta,
          prevClipId: prevClip?.id,
          nextClipId: nextClip?.id,
        },
      };
      const result = await actionExecutor.execute(action, project);
      if (result.success) set({ project: { ...project } });
      return result;
    },

    rollEdit: async (leftClipId: string, rightClipId: string, delta: number) => {
      const { project, actionExecutor } = get();
      const action: Action = {
        type: "clip/roll",
        id: uuidv4(),
        timestamp: Date.now(),
        params: { leftClipId, rightClipId, delta },
      };
      const result = await actionExecutor.execute(action, project);
      if (result.success) set({ project: { ...project } });
      return result;
    },

    trimToPlayhead: async (
      clipId: string,
      playheadTime: number,
      trimStart: boolean,
    ) => {
      const partner = follower(clipId);
      const spans =
        partner &&
        playheadTime > partner.startTime &&
        playheadTime < partner.startTime + partner.duration;
      if (!partner || !spans) {
        return run("clip/trimToPlayhead", { clipId, playheadTime, trimStart });
      }
      return grouped("Trim clips", async () => {
        const result = await run("clip/trimToPlayhead", { clipId, playheadTime, trimStart });
        if (result.success) {
          await run("clip/trimToPlayhead", { clipId: partner.id, playheadTime, trimStart });
        }
        return result;
      });
    },

    linkClips: async (clipId: string, otherId: string) =>
      run("clip/link", { clipId, linkedClipId: otherId }),

    unlinkClip: async (clipId: string) => run("clip/link", { clipId, linkedClipId: null }),

    placeFromSource: async (mode, source) => {
      const fail = (message: string): ActionResult => ({
        success: false,
        error: { code: "INVALID_PARAMS" as const, message },
      });
      const { project } = get();
      const media = project.mediaLibrary.items.find((m) => m.id === source.mediaId);
      if (!media) return fail("The Reference holds nothing that can be placed");
      const length = media.metadata?.duration && media.metadata.duration > 0 ? media.metadata.duration : 5;
      const inPoint = Math.max(0, source.inPoint ?? 0);
      const outPoint = Math.min(length, source.outPoint ?? length);
      if (!(outPoint - inPoint > 0.01)) return fail("Mark an In before the Out first");
      const plan = await sourceEditPlan(get, media, soundFileFor);
      if (typeof plan === "string") return fail(plan);
      const at = Math.max(0, useTimelineStore.getState().playheadPosition);
      return grouped(mode === "insert" ? "Insert" : "Overwrite", async () => {
        let soundTrackId = plan.soundTrackId;
        if (plan.soundMediaId && !soundTrackId && plan.newSoundTrack) {
          soundTrackId = uuidv4();
          const made = await run("track/add", {
            trackType: "audio",
            trackId: soundTrackId,
            position: plan.newSoundTrack.position,
            name: plan.newSoundTrack.name,
          });
          if (!made.success) return made;
        }
        const clips: Array<Record<string, unknown>> = [];
        if (plan.pictureTrackId) {
          clips.push({
            clipId: uuidv4(),
            trackId: plan.pictureTrackId,
            mediaId: media.id,
            inPoint,
            outPoint,
            // its sound is on the row below, as every studio shot's is
            volume: plan.soundMediaId ? 0 : 1,
          });
        }
        if (plan.soundMediaId && soundTrackId) {
          clips.push({ clipId: uuidv4(), trackId: soundTrackId, mediaId: plan.soundMediaId, inPoint, outPoint });
        }
        if (!clips.length) return fail("There is no row to place it on");
        const result = await run(mode === "insert" ? "clip/insertEdit" : "clip/overwriteEdit", { at, clips });
        if (result.success) {
          set({ project: { ...get().project, modifiedAt: Date.now() } });
          useTimelineStore.getState().seekTo(at + (outPoint - inPoint));
        }
        return result;
      });
    },

    getClip: (clipId: string) => {
      const { project } = get();
      for (const track of project.timeline.tracks) {
        const clip = track.clips.find((c) => c.id === clipId);
        if (clip) return clip;
      }
      return undefined;
    },
  };
}

interface SourceEditPlan {
  /** The picture's row; absent for a sound-only source. */
  pictureTrackId?: string;
  /** The sound to lay beside it: the take's own sound file, or one made from the video. */
  soundMediaId?: string;
  soundTrackId?: string;
  /** Where to make a sound row when the picture's row has none under it. */
  newSoundTrack?: { position: number; name: string };
}

const isVisualRow = (t: Track) => t.type === "video" || t.type === "image";

/**
 * The target rows of Insert and Overwrite (R7.1): the selected clip's row, else the first
 * picture row (`Shots` in a studio film, which is under its Crossfades rows); for the
 * sound, the audio row directly under the picture's (`Shot sound`), made when there is
 * none. A studio take's sound is the lossless file its clips are already linked to; any
 * other video's is extracted to a file of its own (R7.6), and a video never goes on a
 * sound row.
 */
async function sourceEditPlan(
  get: Get,
  media: MediaItem,
  soundFileFor: (video: MediaItem, index: number) => Promise<string | null>,
): Promise<SourceEditPlan | string> {
  const { project } = get();
  const tracks = project.timeline.tracks;
  const usable = (t: Track | undefined): t is Track => !!t && !t.locked;
  const selected = useUIStore
    .getState()
    .selectedItems.map((i) => (i.type === "clip" ? findClip(project, i.id) : undefined))
    .find(Boolean);
  const selectedTrack = usable(tracks.find((t) => t.id === selected?.trackId))
    ? tracks.find((t) => t.id === selected?.trackId)
    : undefined;

  if (media.type === "audio") {
    const row =
      (selectedTrack?.type === "audio" ? selectedTrack : undefined) ??
      tracks.find((t) => usable(t) && t.type === "audio");
    return row ? { soundMediaId: media.id, soundTrackId: row.id } : "Add a sound row first";
  }

  const pictureRow =
    (selectedTrack && isVisualRow(selectedTrack) ? selectedTrack : undefined) ??
    tracks.find((t) => usable(t) && isVisualRow(t) && t.name === "Shots") ??
    tracks.find((t) => usable(t) && isVisualRow(t));
  if (!pictureRow) return "Add a picture row first";
  if (media.type !== "video") return { pictureTrackId: pictureRow.id };

  // The take's own sound: what its clips are linked to already.
  let soundMediaId: string | undefined;
  for (const t of tracks) {
    for (const c of t.clips) {
      if (c.mediaId !== media.id) continue;
      const partner = partnerOf(project, c.id);
      const partnerMedia = partner && project.mediaLibrary.items.find((m) => m.id === partner.mediaId);
      if (partnerMedia?.type === "audio") soundMediaId = partnerMedia.id;
    }
  }
  if (!soundMediaId && (media.metadata?.channels ?? 0) > 0) {
    soundMediaId = (await soundFileFor(media, 0)) ?? undefined;
    if (!soundMediaId) return "The source's sound could not be made into a file of its own";
  }
  if (!soundMediaId) return { pictureTrackId: pictureRow.id };

  const tracksNow = get().project.timeline.tracks;
  const index = tracksNow.findIndex((t) => t.id === pictureRow.id);
  const below = tracksNow[index + 1];
  if (usable(below) && below.type === "audio") {
    return { pictureTrackId: pictureRow.id, soundMediaId, soundTrackId: below.id };
  }
  return {
    pictureTrackId: pictureRow.id,
    soundMediaId,
    newSoundTrack: { position: index + 1, name: `${pictureRow.name} sound` },
  };
}
