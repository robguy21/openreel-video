import { useEffect } from "react";
import type { MediaItem } from "@openreel/core";
import { useUIStore } from "../../../stores/ui-store";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useStudioStore } from "../../../services/studio/studio-session";
import {
  clipMarks,
  sourceTimeAt,
  useReferenceStore,
  type ReferenceSource,
} from "../../../stores/reference-store";

/**
 * What the Reference monitor holds, and when it changes (docs/PROPOSAL_EDITOR_REDESIGN.md
 * R5.1; Robert, 2026-09-28, for the film):
 * - the part as the studio's Stitch cut it, while nothing else has been picked;
 * - the take behind a clip selected on the timeline, at the clip's current frame, with
 *   the clip's in and out as its marks;
 * - a media item clicked once in the Media tab (`referenceFromMedia`).
 * Selecting nothing leaves it where it is, as Premiere's source monitor does.
 */

export function kindOf(item: Pick<MediaItem, "type">): ReferenceSource["kind"] | null {
  return item.type === "video" || item.type === "audio" || item.type === "image" ? item.type : null;
}

export function referenceFromMedia(item: MediaItem, fallbackFps: number): ReferenceSource | null {
  const kind = kindOf(item);
  if (!kind) return null;
  return {
    key: `media:${item.id}`,
    origin: "media",
    name: item.name,
    kind,
    mediaId: item.id,
    duration: item.metadata?.duration || undefined,
    fps: item.metadata?.frameRate || fallbackFps,
  };
}

export function referenceFromFilm(
  film: { url: string; duration: number; fps: number },
  name: string,
): ReferenceSource {
  return { key: "film", origin: "film", name, kind: "video", url: film.url, duration: film.duration, fps: film.fps };
}

export function useReferenceSource(): void {
  // The clip selected on the timeline, when it is exactly one clip with a source.
  useEffect(
    () =>
      useUIStore.subscribe(
        (state) => state.selectedItems,
        (items) => {
          if (items.length !== 1 || items[0].type !== "clip") return;
          const { project } = useProjectStore.getState();
          for (const track of project.timeline.tracks) {
            const clip = track.clips.find((c) => c.id === items[0].id);
            if (!clip) continue;
            const item = project.mediaLibrary.items.find((m) => m.id === clip.mediaId);
            const base = item ? referenceFromMedia(item, project.settings.frameRate || 24) : null;
            if (!base) return;
            useReferenceStore.getState().load(
              {
                ...base,
                key: `clip:${clip.id}`,
                origin: "clip",
                clipId: clip.id,
                startAt: sourceTimeAt(clip, useTimelineStore.getState().playheadPosition),
              },
              clipMarks(clip),
            );
            return;
          }
        },
      ),
    [],
  );

  // The film, while nothing else is held; a new studio film starts over.
  const pid = useStudioStore((s) => s.pid);
  const stitchFilm = useStudioStore((s) => s.stitchFilm);
  const name = useStudioStore((s) => s.name);
  const partLabel = useStudioStore((s) => s.partLabel);
  useEffect(() => {
    useReferenceStore.getState().clear();
  }, [pid]);
  useEffect(() => {
    const { source, load } = useReferenceStore.getState();
    if (source || !stitchFilm) return;
    load(referenceFromFilm(stitchFilm, partLabel ? `${name} · ${partLabel}` : name));
  }, [stitchFilm, name, partLabel]);
}
