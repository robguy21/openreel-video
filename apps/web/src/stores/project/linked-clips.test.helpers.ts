import type { Clip, MediaItem, Project } from "@openreel/core";

/** A picture "p" on Shots and its sound "s" on Shot sound, linked: 2..6 s, source 1..5. */

function media(id: string, type: MediaItem["type"], duration = 10): MediaItem {
  return {
    id,
    name: `${id}.${type === "audio" ? "wav" : "mp4"}`,
    type,
    fileHandle: null,
    blob: null,
    metadata: {
      duration,
      width: type === "audio" ? 0 : 1080,
      height: type === "audio" ? 0 : 1920,
      frameRate: 24,
      codec: "h264",
      sampleRate: 48000,
      channels: 2,
      fileSize: 1,
    },
    thumbnailUrl: null,
    waveformData: null,
  } as MediaItem;
}

function clip(id: string, trackId: string, mediaId: string, linkedClipId: string): Clip {
  return {
    id,
    mediaId,
    trackId,
    startTime: 2,
    duration: 4,
    inPoint: 1,
    outPoint: 5,
    effects: [],
    audioEffects: [],
    transform: {
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      anchor: { x: 0.5, y: 0.5 },
      opacity: 1,
    },
    volume: id === "p" ? 0 : 1,
    keyframes: [],
    linkedClipId,
  } as Clip;
}

function track(id: string, type: "video" | "audio", name: string, clips: Clip[]) {
  return { id, type, name, clips, transitions: [], locked: false, hidden: false, muted: false, solo: false };
}

export function film(): Project {
  return {
    id: "linked",
    name: "Linked",
    createdAt: 0,
    modifiedAt: 0,
    settings: { width: 1080, height: 1920, frameRate: 24, sampleRate: 48000, channels: 2 },
    mediaLibrary: { items: [media("take", "video"), media("master", "audio")] },
    timeline: {
      tracks: [
        track("shots", "video", "Shots", [clip("p", "shots", "take", "s")]),
        track("sound", "audio", "Shot sound", [clip("s", "sound", "master", "p")]),
      ],
      subtitles: [],
      duration: 10,
      markers: [],
    },
  } as unknown as Project;
}
