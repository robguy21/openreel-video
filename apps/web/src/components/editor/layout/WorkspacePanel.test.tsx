import "../../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MediaItem, Project } from "@openreel/core";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { WorkspacePanel } from "./WorkspacePanel";

/** The workspace panel and its Media tab (docs/PROPOSAL_EDITOR_REDESIGN.md R4.2, R4.4). */

function item(id: string, type: MediaItem["type"]): MediaItem {
  return {
    id,
    name: id,
    type,
    fileHandle: null,
    blob: null,
    metadata: {
      duration: type === "image" ? 0 : 4,
      width: 1920,
      height: 1080,
      frameRate: 24,
      codec: "h264",
      sampleRate: 48_000,
      channels: 2,
      fileSize: 1,
    },
    thumbnailUrl: null,
    waveformData: null,
  } as MediaItem;
}

function library(settings?: Partial<Project["settings"]>): Project {
  const project = createEmptyProject("Panel");
  return {
    ...project,
    settings: { ...project.settings, ...settings },
    mediaLibrary: {
      items: [
        item("Shot 01 take 2", "video"),
        item("Shot 02 take 1", "video"),
        item("Ice field still", "image"),
        item("Narration 01", "audio"),
      ],
    },
  };
}

const names = () =>
  ["Shot 01 take 2", "Shot 02 take 1", "Ice field still", "Narration 01"].filter(
    (n) => screen.queryByText(n) !== null,
  );

describe("WorkspacePanel", () => {
  beforeEach(() => {
    useProjectStore.setState({ hasOpenProject: true, project: library() });
    useUIStore.setState({ workspaceTab: "media" });
  });
  afterEach(() => {
    cleanup();
    useProjectStore.setState({ hasOpenProject: false, project: createEmptyProject("Reset") });
  });

  it("heads the panel with the tab's name and shows that tab alone", () => {
    render(<WorkspacePanel />);
    expect(screen.getByRole("heading", { name: "Media" })).toBeInTheDocument();
    act(() => useUIStore.getState().setWorkspaceTab("text"));
    expect(screen.getByRole("heading", { name: "Text" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Title" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Import media" })).toBeNull();
  });

  it("filters the library by kind and by name", () => {
    render(<WorkspacePanel />);
    expect(names()).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "Takes" }));
    expect(names()).toEqual(["Shot 01 take 2", "Shot 02 take 1"]);
    fireEvent.click(screen.getByRole("button", { name: "Stills" }));
    expect(names()).toEqual(["Ice field still"]);
    fireEvent.click(screen.getByRole("button", { name: "Audio" }));
    expect(names()).toEqual(["Narration 01"]);
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search media" }), {
      target: { value: "shot 02" },
    });
    expect(names()).toEqual(["Shot 02 take 1"]);
    fireEvent.change(screen.getByRole("textbox", { name: "Search media" }), {
      target: { value: "nothing like it" },
    });
    expect(screen.getByText("Nothing here matches.")).toBeInTheDocument();
  });

  it("lays two tiles across for a landscape film and three for portrait", () => {
    const { container, unmount } = render(<WorkspacePanel />);
    const grid = () =>
      container.querySelector<HTMLElement>("[style*='grid-template-columns']");
    expect(grid()?.style.gridTemplateColumns).toBe("repeat(2, minmax(0, 1fr))");
    unmount();
    useProjectStore.setState({ project: library({ width: 1080, height: 1920 }) });
    const again = render(<WorkspacePanel />);
    expect(
      again.container.querySelector<HTMLElement>("[style*='grid-template-columns']")?.style
        .gridTemplateColumns,
    ).toBe("repeat(3, minmax(0, 1fr))");
  });

  it("opens Generate inside the panel with a way back to Media", async () => {
    render(<WorkspacePanel />);
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    expect(screen.getByRole("heading", { name: "Generate" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to Media" }));
    expect(screen.getByRole("heading", { name: "Media" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import media" })).toBeInTheDocument();
  });
});
