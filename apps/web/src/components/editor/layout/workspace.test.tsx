import "../../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Project } from "@openreel/core";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import {
  DEFAULT_WORKSPACE_TAB,
  WORKSPACE_TABS,
  migrateUIPreferences,
  useUIStore,
} from "../../../stores/ui-store";
import { useThemeStore } from "../../../stores/theme-store";
import { RAIL_HELPERS, RAIL_TOOLS, WorkspaceRail } from "./WorkspaceRail";
import { roomUrl } from "./EditorRoom";
import {
  selectionOpensProperties,
  useWorkspaceFollowsSelection,
} from "./useWorkspaceFollowsSelection";

/** docs/PROPOSAL_EDITOR_REDESIGN.md R1.2, R1.4, R4.1-R4.3. */

function projectWithClip(clipId: string, mediaId: string): Project {
  const project = createEmptyProject("Workspace");
  return {
    ...project,
    timeline: {
      ...project.timeline,
      duration: 5,
      tracks: [
        {
          id: "track-1",
          type: "video",
          name: "Shots",
          clips: [
            {
              id: clipId,
              mediaId,
              trackId: "track-1",
              startTime: 0,
              duration: 5,
              inPoint: 0,
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
              volume: 1,
              keyframes: [],
            },
          ],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
      ],
    },
  } as Project;
}

describe("the workspace tab", () => {
  beforeEach(() => {
    useUIStore.setState({ workspaceTab: DEFAULT_WORKSPACE_TAB });
    useUIStore.getState().clearSelection();
  });
  afterEach(() => cleanup());

  it("opens on Media and remembers the tab it is given", () => {
    expect(useUIStore.getState().workspaceTab).toBe("media");
    useUIStore.getState().setWorkspaceTab("history");
    expect(useUIStore.getState().workspaceTab).toBe("history");
  });

  it("is saved with the other preferences", () => {
    useUIStore.getState().setWorkspaceTab("audio");
    const saved = JSON.parse(window.localStorage.getItem("openreel-ui-preferences") ?? "{}");
    expect(saved.state.workspaceTab).toBe("audio");
    expect(saved.version).toBe(3);
  });

  it("migrates older preferences to Media and repairs an unknown tab", () => {
    const fromV2 = migrateUIPreferences({ panels: {}, theme: "dark" }, 2);
    expect(fromV2.workspaceTab).toBe("media");
    expect(fromV2.panels).toBeDefined();
    expect(migrateUIPreferences({ workspaceTab: "properties" }, 3).workspaceTab).toBe("properties");
    expect(migrateUIPreferences({ workspaceTab: "inspector" }, 3).workspaceTab).toBe("media");
    // what the older migrations did is kept
    const fromV0 = migrateUIPreferences({}, 0);
    expect(fromV0.snapSettings).toBeDefined();
    expect((fromV0.panels as Record<string, unknown>).agentChat).toBeDefined();
  });
});

describe("the rail", () => {
  afterEach(() => cleanup());

  it("holds the tabs in the proposal's order with History last", () => {
    expect([...RAIL_TOOLS, ...RAIL_HELPERS].map((i) => i.tab)).toEqual([...WORKSPACE_TABS]);
    expect(RAIL_TOOLS.map((i) => i.label)).toEqual([
      "Media", "Properties", "Text", "Graphics", "Effects", "Transitions", "Moments",
      "Audio", "Templates",
    ]);
    expect(RAIL_HELPERS.map((i) => i.label)).toEqual(["Assistant", "History"]);
  });

  it("lights the chosen tab and picks another on click", () => {
    useUIStore.setState({ workspaceTab: "media" });
    render(<WorkspaceRail />);
    expect(screen.getByRole("button", { name: "Media" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Transitions" }));
    expect(useUIStore.getState().workspaceTab).toBe("transitions");
    expect(screen.getByRole("button", { name: "Transitions" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Media" })).toHaveAttribute("aria-pressed", "false");
  });
});

describe("selecting opens Properties", () => {
  const onTimeline = new Set(["clip-a"]);

  it("for a clip on the timeline, a text or shape clip, a transition or a subtitle", () => {
    expect(selectionOpensProperties([{ type: "clip", id: "clip-a" }], onTimeline)).toBe(true);
    expect(selectionOpensProperties([{ type: "text-clip", id: "t" }], onTimeline)).toBe(true);
    expect(selectionOpensProperties([{ type: "shape-clip", id: "s" }], onTimeline)).toBe(true);
    expect(selectionOpensProperties([{ type: "transition", id: "x" }], onTimeline)).toBe(true);
    expect(selectionOpensProperties([{ type: "subtitle", id: "y" }], onTimeline)).toBe(true);
  });

  it("not for a library item, which shares the clip type", () => {
    expect(selectionOpensProperties([{ type: "clip", id: "media-1" }], onTimeline)).toBe(false);
    expect(selectionOpensProperties([{ type: "track", id: "track-1" }], onTimeline)).toBe(false);
  });

  it("switches the tab when a timeline clip is selected, and leaves it on a clear", () => {
    useProjectStore.setState({ project: projectWithClip("clip-a", "media-1") });
    useUIStore.setState({ workspaceTab: "media" });
    renderHook(() => useWorkspaceFollowsSelection());

    act(() => useUIStore.getState().select({ type: "clip", id: "media-1" }));
    expect(useUIStore.getState().workspaceTab).toBe("media");

    act(() => useUIStore.getState().select({ type: "clip", id: "clip-a", trackId: "track-1" }));
    expect(useUIStore.getState().workspaceTab).toBe("properties");

    act(() => useUIStore.getState().setWorkspaceTab("effects"));
    act(() => useUIStore.getState().clearSelection());
    expect(useUIStore.getState().workspaceTab).toBe("effects");
  });
});

describe("the look", () => {
  it("is dark whatever is asked for", () => {
    useThemeStore.getState().setMode("light");
    expect(useThemeStore.getState().mode).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    useThemeStore.getState().toggleTheme();
    expect(useThemeStore.getState().isDark).toBe(true);
  });

  it("asks the studio for the film's room, and has none outside a studio film", () => {
    expect(roomUrl("p0123456789")).toBe("/api/projects/p0123456789/look/room");
    expect(roomUrl(null)).toBeNull();
  });
});
