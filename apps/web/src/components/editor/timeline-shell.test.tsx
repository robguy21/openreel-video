import "../../test/install-local-storage-mock";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";
import { Timeline, TRACK_HEADER_WIDTH } from "./Timeline";
import { FIXED_SHORTCUTS, KeyboardShortcutsOverlay } from "./KeyboardShortcutsOverlay";

/** docs/PROPOSAL_EDITOR_REDESIGN.md R9.1-R9.3 and R10.1. */

describe("the timeline's shell", () => {
  beforeEach(() => {
    useProjectStore.setState({ project: createEmptyProject("Main cut") });
  });
  afterEach(cleanup);

  it("names what is being cut and groups Undo, Redo, Snap and Keyframes in one track", () => {
    render(<Timeline />);
    expect(screen.getByText("Main cut")).toBeTruthy();
    expect(screen.getByLabelText("Playhead").textContent).toBe("00:00:00:00");
    const group = screen.getByRole("group", { name: "History, snapping and keyframes" });
    const names = within(group).getAllByRole("button").map((b) => b.getAttribute("aria-label"));
    expect(names[0]).toMatch(/^Undo/);
    expect(names[1]).toMatch(/^Redo/);
    expect(names[2]).toMatch(/^Snap/);
    expect(names[3]).toBe("Keyframe editor");
  });

  it("shows Snap's state and changes it from the group", () => {
    render(<Timeline />);
    const group = screen.getByRole("group", { name: "History, snapping and keyframes" });
    const snap = within(group).getByRole("button", { name: /^Snap/ });
    const before = useUIStore.getState().snapSettings.enabled;
    expect(snap.getAttribute("aria-pressed")).toBe(String(before));
    fireEvent.click(snap);
    expect(useUIStore.getState().snapSettings.enabled).toBe(!before);
  });

  it("puts the editing tools in a vertical column, each named and none enabled with nothing selected", () => {
    render(<Timeline />);
    const column = screen.getByRole("toolbar", { name: "Timeline tools" });
    expect(column.getAttribute("aria-orientation")).toBe("vertical");
    const tools = within(column).getAllByRole("button");
    expect(tools.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Split at playhead (S)",
      "Trim start to playhead (Q)",
      "Trim end to playhead (W)",
      "Ripple delete (⇧Del)",
      "Duplicate (⌘D)",
      "Delete (Del)",
    ]);
    expect(tools.every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
  });

  it("gives the track headers one named width", () => {
    render(<Timeline />);
    const headers = screen.getByTestId("timeline-track-headers-scroll");
    expect(headers.style.width).toBe(`${TRACK_HEADER_WIDTH}px`);
  });
});

describe("the keyboard shortcuts list", () => {
  afterEach(cleanup);

  it("lists the monitors' keys and Alt-click, which are not rebound there", () => {
    render(<KeyboardShortcutsOverlay isOpen onClose={() => undefined} />);
    expect(screen.getByText("Monitors and linked clips")).toBeTruthy();
    for (const f of FIXED_SHORTCUTS) expect(screen.getByText(f.name)).toBeTruthy();
    expect(FIXED_SHORTCUTS.map((f) => f.keys)).toEqual(["Space", "←", "→", "I", "O", ",", ".", "Alt + click"]);
  });
});
