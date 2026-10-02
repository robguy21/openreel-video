import React from "react";
import type { TextStyle } from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { ToolcraftText as Text } from "@openreel/ui";
import { insertTimelineOverlay } from "../../../stores/project/insert-timeline-overlay";
import { PanelButton } from "./shared";

export const DEFAULT_TITLE_STYLE: Partial<TextStyle> = {
  fontSize: 96,
  fontWeight: 800,
  letterSpacing: -1,
};

export const TEXT_STYLE_PRESETS: ReadonlyArray<{
  name: string;
  text: string;
  style: Partial<TextStyle>;
}> = [
  { name: "Heading", text: "Heading", style: { fontSize: 72, fontWeight: 700 } },
  { name: "Subtitle", text: "Subtitle text", style: { fontSize: 36, fontWeight: 400 } },
  {
    name: "Lower Third",
    text: "Name Here",
    style: {
      fontSize: 32,
      fontWeight: 600,
      textAlign: "left",
      verticalAlign: "bottom",
      backgroundColor: "rgba(0, 0, 0, 0.7)",
    },
  },
  {
    name: "Caption",
    text: "Caption text here",
    style: {
      fontSize: 24,
      fontWeight: 400,
      verticalAlign: "bottom",
      shadowColor: "rgba(0, 0, 0, 0.8)",
      shadowBlur: 4,
      shadowOffsetX: 1,
      shadowOffsetY: 1,
    },
  },
  {
    name: "Hero",
    text: "MAKE IT MOVE",
    style: {
      fontSize: 112,
      fontWeight: 900,
      letterSpacing: -2,
      lineHeight: 0.95,
      strokeWidth: 3,
    },
  },
  {
    name: "Quote",
    text: "“Tell a better story.”",
    style: {
      fontSize: 54,
      fontWeight: 600,
      fontStyle: "italic",
      lineHeight: 1.25,
      shadowColor: "rgba(0, 0, 0, 0.65)",
      shadowBlur: 10,
      shadowOffsetY: 4,
    },
  },
  {
    name: "Outline",
    text: "OUTLINE",
    style: {
      fontSize: 80,
      fontWeight: 900,
      letterSpacing: 2,
      strokeColor: "#111827",
      strokeWidth: 5,
    },
  },
  {
    name: "Badge",
    text: "NEW RELEASE",
    style: {
      fontSize: 28,
      fontWeight: 800,
      letterSpacing: 3,
      backgroundColor: "rgba(17, 24, 39, 0.88)",
    },
  },
];

/**
 * The Text section: a title and the style presets, each placed at the playhead on an
 * overlay track. Moved out of AssetsPanel.tsx unchanged (docs/PROPOSAL_EDITOR_REDESIGN.md
 * R4.5); the editor's sidebar shows it as the Text tab.
 */
export const TextSection: React.FC = () => {
  const { select } = useUIStore();

  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-border/70">
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="min-w-0 px-4 py-4 space-y-3">
          <PanelButton
            label="Add Title"
            onClick={async () => {
              const created = await insertTimelineOverlay(
                useTimelineStore.getState().playheadPosition,
                5,
                (trackId) =>
                  useProjectStore
                    .getState()
                    .createTextClip(
                      trackId,
                      useTimelineStore.getState().playheadPosition,
                      "New Title",
                      5,
                      DEFAULT_TITLE_STYLE,
                    ),
              );
              if (created) {
                select({
                  type: "text-clip",
                  id: created.id,
                  trackId: created.trackId,
                });
              }
            }}
            className="flex min-h-[72px] w-full min-w-0 flex-col items-center justify-center rounded-lg border border-border bg-background-tertiary px-3 py-3 text-center transition-all hover:border-primary/50 hover:bg-primary/5"
          >
            <span className="block max-w-full truncate text-base font-bold leading-tight text-text-primary">
              Add Title
            </span>
            <Text
              type="supporting"
              color="secondary"
              display="block"
              maxLines={1}
              className="mt-1 max-w-full text-[11px] leading-tight"
            >
              Click to add text to timeline
            </Text>
          </PanelButton>
          <div className="grid min-w-0 grid-cols-2 gap-2">
            {TEXT_STYLE_PRESETS.map((preset) => (
              <PanelButton
                key={preset.name}
                label={preset.name}
                onClick={async () => {
                  const created = await insertTimelineOverlay(
                    useTimelineStore.getState().playheadPosition,
                    5,
                    (trackId) =>
                      useProjectStore
                        .getState()
                        .createTextClip(
                          trackId,
                          useTimelineStore.getState().playheadPosition,
                          preset.text,
                          5,
                          preset.style,
                        ),
                  );
                  if (created) {
                    select({
                      type: "text-clip",
                      id: created.id,
                      trackId: created.trackId,
                    });
                  }
                }}
                className="flex min-h-[44px] min-w-0 items-center justify-center rounded-lg border border-border bg-background-tertiary px-2 py-2 text-center text-xs font-medium leading-tight text-text-secondary transition-all hover:border-primary/50 hover:bg-primary/5 hover:text-text-primary"
              >
                <span className="block max-w-full truncate">
                  {preset.name}
                </span>
              </PanelButton>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
