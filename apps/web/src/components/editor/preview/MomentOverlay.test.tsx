import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { Clip, Track } from "@openreel/core";
import { createMoment } from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { getActiveMoments } from "./active-moments";
import { MomentOverlay } from "./MomentOverlay";

const momentClip = (
  id: string,
  startTime: number,
  duration: number,
  moment: ReturnType<typeof createMoment>,
): Clip => ({
  id,
  mediaId: `moment-${id}`,
  trackId: "track-moments",
  startTime,
  duration,
  inPoint: 0,
  outPoint: duration,
  effects: [],
  audioEffects: [],
  transform: {
    position: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
    anchor: { x: 0.5, y: 0.5 },
    opacity: 1,
  },
  volume: 1,
  keyframes: [],
  metadata: { moment },
});

const track = (overrides: Partial<Track>): Track => ({
  id: "track-moments",
  type: "moments",
  name: "Moments",
  clips: [],
  transitions: [],
  locked: false,
  hidden: false,
  muted: false,
  solo: false,
  ...overrides,
});

const promo = createMoment("promotion", {
  label: "Summer sale",
  key: "summer",
  title: "20% off everything",
  cta_label: "Shop now",
});

describe("getActiveMoments", () => {
  const tracks: Track[] = [
    track({ clips: [momentClip("m1", 10, 5, promo)] }),
    track({
      id: "track-video",
      type: "video",
      name: "V1",
      clips: [momentClip("not-a-moment", 0, 100, promo)],
    }),
  ];

  it("is inclusive at the start and exclusive at the end", () => {
    expect(getActiveMoments(tracks, 10).map((a) => a.clip.id)).toEqual(["m1"]);
    expect(getActiveMoments(tracks, 14.999).map((a) => a.clip.id)).toEqual(["m1"]);
    expect(getActiveMoments(tracks, 15)).toEqual([]);
  });

  it("returns nothing outside the window and ignores non-moment tracks", () => {
    expect(getActiveMoments(tracks, 9.99)).toEqual([]);
    expect(getActiveMoments(tracks, 50)).toEqual([]);
  });
});

describe("MomentOverlay", () => {
  beforeEach(() => {
    useProjectStore.getState().createNewProject("Overlay");
    useProjectStore.setState((state) => ({
      project: {
        ...state.project,
        timeline: {
          ...state.project.timeline,
          tracks: [track({ clips: [momentClip("m1", 10, 5, promo)] })],
        },
      },
    }));
    useUIStore.getState().setShowMomentOverlays(true);
  });

  const canvasRef = { current: null } as React.RefObject<HTMLCanvasElement | null>;

  it("renders the promotion bar with title and CTA while inside the moment", () => {
    render(
      <MomentOverlay
        canvasRef={canvasRef}
        projectWidth={1920}
        projectHeight={1080}
        currentTime={12}
      />,
    );
    expect(screen.getByTestId("moment-overlay-promotion")).toBeInTheDocument();
    expect(screen.getByText("20% off everything")).toBeInTheDocument();
    expect(screen.getByText("Shop now")).toBeInTheDocument();
    expect(screen.getByText("summer")).toBeInTheDocument();
  });

  it("renders nothing outside the moment or when the toggle is off", () => {
    const { rerender } = render(
      <MomentOverlay
        canvasRef={canvasRef}
        projectWidth={1920}
        projectHeight={1080}
        currentTime={3}
      />,
    );
    expect(screen.queryByTestId("moment-overlay-promotion")).toBeNull();

    useUIStore.getState().setShowMomentOverlays(false);
    rerender(
      <MomentOverlay
        canvasRef={canvasRef}
        projectWidth={1920}
        projectHeight={1080}
        currentTime={12}
      />,
    );
    expect(screen.queryByTestId("moment-overlay-promotion")).toBeNull();
  });
});
