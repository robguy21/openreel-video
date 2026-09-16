import React, { useCallback, useMemo } from "react";
import { HelpCircle, LayoutGrid, Megaphone, ShoppingBag, X } from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import type { Clip, Moment, MomentKind } from "@openreel/core";
import { getMoment, MOMENT_KIND_LABELS } from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { serializeMomentDropPayload } from "../timeline/moment-drop";

export const MOMENT_KIND_BADGES: Record<MomentKind, string> = {
  quiz: "QUIZ",
  promotion: "PROMO",
  product: "PRODUCT",
  catalogue: "CATALOGUE",
};

const MOMENT_BADGE_CLASS: Record<MomentKind, string> = {
  quiz: "bg-violet-500/20 text-violet-300",
  promotion: "bg-fuchsia-500/20 text-fuchsia-300",
  product: "bg-orange-500/20 text-orange-300",
  catalogue: "bg-teal-500/20 text-teal-300",
};

const ADD_BUTTONS: ReadonlyArray<{
  kind: MomentKind;
  label: string;
  icon: React.ReactNode;
}> = [
  { kind: "quiz", label: "Add Quiz", icon: <HelpCircle size={16} aria-hidden /> },
  {
    kind: "promotion",
    label: "Add Promotion",
    icon: <Megaphone size={16} aria-hidden />,
  },
  {
    kind: "product",
    label: "Add Product",
    icon: <ShoppingBag size={16} aria-hidden />,
  },
  {
    kind: "catalogue",
    label: "Add Catalogue",
    icon: <LayoutGrid size={16} aria-hidden />,
  },
];

/** mm:ss.s */
export function formatMomentTime(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(safe / 60);
  const rest = safe - minutes * 60;
  return `${minutes.toString().padStart(2, "0")}:${rest
    .toFixed(1)
    .padStart(4, "0")}`;
}

interface MomentRow {
  clip: Clip;
  moment: Moment;
}

export const MomentsPanel: React.FC = () => {
  const tracks = useProjectStore((state) => state.project.timeline.tracks);
  const addMoment = useProjectStore((state) => state.addMoment);
  const removeClip = useProjectStore((state) => state.removeClip);
  const select = useUIStore((state) => state.select);
  const selectedItems = useUIStore((state) => state.selectedItems);
  const startDrag = useUIStore((state) => state.startDrag);
  const endDrag = useUIStore((state) => state.endDrag);
  const seekTo = useTimelineStore((state) => state.seekTo);

  // Same channel as media cards: a JSON dataTransfer payload the timeline
  // lanes already parse, plus the ui-store drag state for drop feedback.
  const handleButtonDragStart = useCallback(
    (event: React.DragEvent<HTMLButtonElement>, kind: MomentKind) => {
      event.dataTransfer.setData(
        "application/json",
        serializeMomentDropPayload(kind),
      );
      event.dataTransfer.effectAllowed = "copy";
      startDrag("moment", { kind });
    },
    [startDrag],
  );

  const rows = useMemo<MomentRow[]>(() => {
    const list: MomentRow[] = [];
    for (const track of tracks) {
      if (track.type !== "moments") continue;
      for (const clip of track.clips) {
        const moment = getMoment(clip);
        if (moment) list.push({ clip, moment });
      }
    }
    return list.sort((a, b) => a.clip.startTime - b.clip.startTime);
  }, [tracks]);

  const selectedClipId = selectedItems.find((item) => item.type === "clip")?.id;

  const handleSelectRow = useCallback(
    (row: MomentRow) => {
      select({ type: "clip", id: row.clip.id, trackId: row.clip.trackId });
      seekTo(row.clip.startTime);
    },
    [select, seekTo],
  );

  const handleRemove = useCallback(
    (event: React.MouseEvent, clipId: string) => {
      event.stopPropagation();
      void removeClip(clipId);
    },
    [removeClip],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-3 border-b border-border/70 px-3 py-3">
        <Text type="supporting" color="secondary" className="block text-[11px]">
          OneLink Moments: timed events exported with the render. They never
          change playback or the rendered video. Click to add at the playhead
          or drag a button onto the timeline.
        </Text>
        <div className="grid grid-cols-1 gap-2">
          {ADD_BUTTONS.map((entry) => (
            <Button
              key={entry.kind}
              label={entry.label}
              icon={entry.icon}
              size="md"
              variant="secondary"
              className="w-full justify-start cursor-grab active:cursor-grabbing"
              title={`Click to add at the playhead, or drag onto the timeline`}
              draggable
              onDragStart={(event: React.DragEvent<HTMLButtonElement>) =>
                handleButtonDragStart(event, entry.kind)
              }
              onDragEnd={endDrag}
              onClick={() => void addMoment(entry.kind)}
            />
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar px-2 py-2">
        {rows.length === 0 ? (
          <Text
            type="supporting"
            color="muted"
            className="block px-1 py-4 text-center text-[11px]"
          >
            No moments yet. Add one above; it lands at the playhead on a
            Moments track.
          </Text>
        ) : (
          <ul className="space-y-1" aria-label="Moments in this project">
            {rows.map(({ clip, moment }) => {
              const isSelected = clip.id === selectedClipId;
              return (
                <li key={clip.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    onClick={() => handleSelectRow({ clip, moment })}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        handleSelectRow({ clip, moment });
                      }
                    }}
                    className={`group flex w-full cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors ${
                      isSelected
                        ? "border-accent/60 bg-accent-soft"
                        : "border-transparent hover:border-border hover:bg-bg-2"
                    }`}
                  >
                    <span
                      className={`shrink-0 rounded-sm px-1 py-px text-[9px] font-bold uppercase tracking-wide ${MOMENT_BADGE_CLASS[moment.kind]}`}
                      title={MOMENT_KIND_LABELS[moment.kind]}
                    >
                      {MOMENT_KIND_BADGES[moment.kind]}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] font-medium text-fg">
                        {moment.label || MOMENT_KIND_LABELS[moment.kind]}
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-fg-3">
                        <span className="truncate font-mono">{moment.key}</span>
                        <span className="shrink-0 tabular-nums">
                          {formatMomentTime(clip.startTime)}
                          {" → "}
                          {formatMomentTime(clip.startTime + clip.duration)}
                        </span>
                      </div>
                    </div>
                    <IconButton
                      label={`Delete ${moment.label || "moment"}`}
                      icon={<X size={12} aria-hidden />}
                      variant="ghost"
                      size="sm"
                      className="shrink-0 opacity-60 group-hover:opacity-100"
                      onClick={(event: React.MouseEvent) =>
                        handleRemove(event, clip.id)
                      }
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};

export default MomentsPanel;
