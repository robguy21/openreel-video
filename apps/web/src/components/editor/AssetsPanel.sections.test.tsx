import "../../test/install-local-storage-mock";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MediaItem, Project } from "@openreel/core";
import { useEngineStore } from "../../stores/engine-store";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useUIStore } from "../../stores/ui-store";
import { AssetsPanel, TEXT_STYLE_PRESETS } from "./AssetsPanel";

/**
 * What the Assets panel's Media, Text and Graphics sections show and do. Written against
 * the panel before those sections were split into components of their own
 * (docs/PROPOSAL_EDITOR_REDESIGN.md R4.5), and run unchanged after, so the split is
 * proved to change nothing.
 */

function mediaItem(id: string, type: MediaItem["type"], duration: number): MediaItem {
  return {
    id,
    name: `${id}.${type === "audio" ? "wav" : type === "image" ? "png" : "mp4"}`,
    type,
    fileHandle: null,
    blob: null,
    metadata: {
      duration,
      width: type === "audio" ? 0 : 1920,
      height: type === "audio" ? 0 : 1080,
      frameRate: type === "video" ? 24 : 0,
      codec: "h264",
      sampleRate: 48_000,
      channels: 2,
      fileSize: 2048,
    },
    thumbnailUrl: null,
    waveformData: null,
  } as MediaItem;
}

function withMedia(items: MediaItem[]): Project {
  const project = createEmptyProject("Sections");
  return { ...project, mediaLibrary: { items } };
}

describe("AssetsPanel sections", () => {
  beforeEach(() => {
    useEngineStore.getState().getGraphicsEngine()?.clearCache();
    useProjectStore.setState({ hasOpenProject: true, project: createEmptyProject("Sections") });
    useTimelineStore.setState({ playheadPosition: 1.5 });
    useUIStore.getState().clearSelection();
  });

  afterEach(() => {
    cleanup();
    useUIStore.getState().clearSelection();
    useProjectStore.setState({ hasOpenProject: false, project: createEmptyProject("Reset") });
  });

  it("opens on Media, and an empty library asks for an import", () => {
    render(<AssetsPanel />);
    expect(screen.getByText("No media imported")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import media" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sort media" })).toBeInTheDocument();
  });

  it("lists the library with each item's length, and one click selects it", () => {
    useProjectStore.setState({
      project: withMedia([mediaItem("take-a", "video", 9), mediaItem("still-b", "image", 0)]),
    });
    render(<AssetsPanel />);
    expect(screen.getByText("Project Media")).toBeInTheDocument();
    expect(screen.getByText("take-a.mp4")).toBeInTheDocument();
    expect(screen.getByText("still-b.png")).toBeInTheDocument();
    expect(screen.getByText("00:09")).toBeInTheDocument();

    const tile = screen.getByText("take-a.mp4").previousElementSibling;
    expect(tile).not.toBeNull();
    fireEvent.click(tile!);
    expect(useUIStore.getState().isSelected("take-a")).toBe(true);
  });

  it("sorts the library by name when asked", () => {
    useProjectStore.setState({
      project: withMedia([mediaItem("zed", "video", 3), mediaItem("alpha", "video", 3)]),
    });
    render(<AssetsPanel />);
    const names = () =>
      screen.getAllByText(/^(zed|alpha)\.mp4$/).map((el) => el.textContent);
    expect(names()).toEqual(["zed.mp4", "alpha.mp4"]);
    fireEvent.click(screen.getByRole("button", { name: "Sort media" }));
    expect(names()).toEqual(["alpha.mp4", "zed.mp4"]);
  });

  it("offers every text preset and places a title at the playhead", async () => {
    render(<AssetsPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Text" }));
    for (const preset of TEXT_STYLE_PRESETS) {
      expect(screen.getByRole("button", { name: preset.name })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: "Add Title" }));
    await waitFor(() => {
      const [selected] = useUIStore.getState().selectedItems;
      expect(selected?.type).toBe("text-clip");
    });
  });

  it("offers backgrounds, shapes, 3D objects, SVG import and stickers", () => {
    render(<AssetsPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Graphics" }));
    expect(screen.getByText("Backgrounds")).toBeInTheDocument();
    for (const name of ["Rectangle", "Circle", "Triangle", "Star", "Arrow", "Polygon"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    for (const name of ["Cube", "Sphere", "Torus", "Cone", "Cylinder", "Icosahedron"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Import SVG File" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import & Add Sticker" })).toBeInTheDocument();
  });
});
