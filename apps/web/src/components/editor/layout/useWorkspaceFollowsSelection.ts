import { useEffect } from "react";
import { useUIStore, type SelectionItem } from "../../../stores/ui-store";
import { useProjectStore } from "../../../stores/project-store";

/**
 * Selecting a clip on the timeline opens Properties; selecting nothing leaves the tab
 * where it is (docs/PROPOSAL_EDITOR_REDESIGN.md R4.3).
 *
 * Whether a `clip` selection is on the timeline is asked of the project, not read off
 * its type: the Media tab selects a library item with the same `clip` type a timeline
 * clip uses, and that must not take the reader away from Media. Text and shape clips,
 * transitions and subtitles are only ever selected on the timeline (or just placed on
 * it), and Properties is where each is edited.
 */
export function selectionOpensProperties(
  items: ReadonlyArray<SelectionItem>,
  timelineClipIds: ReadonlySet<string>,
): boolean {
  return items.some((item) => {
    switch (item.type) {
      case "text-clip":
      case "shape-clip":
      case "transition":
      case "subtitle":
        return true;
      case "clip":
        return timelineClipIds.has(item.id);
      default:
        return false;
    }
  });
}

function timelineClipIds(): Set<string> {
  const ids = new Set<string>();
  for (const track of useProjectStore.getState().project.timeline.tracks) {
    for (const clip of track.clips) ids.add(clip.id);
  }
  return ids;
}

export function useWorkspaceFollowsSelection(): void {
  useEffect(
    () =>
      useUIStore.subscribe(
        (state) => state.selectedItems,
        (items) => {
          if (items.length === 0) return;
          if (selectionOpensProperties(items, timelineClipIds())) {
            useUIStore.getState().setWorkspaceTab("properties");
          }
        },
      ),
    [],
  );
}
