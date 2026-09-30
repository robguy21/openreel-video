import "../../../test/install-local-storage-mock";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useStudioStore } from "../../../services/studio/studio-session";
import { useTimelineStore } from "../../../stores/timeline-store";
import { pauseAllPlayback, StudioBackItem, StudioSaveItem } from "./StudioRailItems";
import { EditMonitorHeader, monitorSubtitle } from "./EditMonitorHeader";
import { EditorMoreMenu } from "./EditorMoreMenu";

/** The editor without a top bar (Robert, 2026-09-28): the rail's head and foot, and the
 *  Edit monitor's header naming the film. */

const inStudio = (patch: Partial<ReturnType<typeof useStudioStore.getState>> = {}) =>
  useStudioStore.setState({
    pid: "p0123456789",
    part: null,
    name: "Recovery",
    partLabel: "Part 1",
    status: "ready",
    dirty: false,
    error: null,
    ...patch,
  });

describe("the rail's studio items", () => {
  afterEach(() => {
    cleanup();
    useStudioStore.setState({ pid: null, name: "", partLabel: "", dirty: false, error: null, status: "idle" });
  });

  it("are not drawn outside a studio film", () => {
    const { container } = render(
      <>
        <StudioBackItem />
        <StudioSaveItem />
      </>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("go back to the studio, and say Saved until there is something to save", () => {
    inStudio();
    const { rerender } = render(
      <>
        <StudioBackItem />
        <StudioSaveItem />
      </>,
    );
    expect(screen.getByRole("link", { name: "Back to Clip Studio" })).toBeInTheDocument();
    const saved = screen.getByRole("button", { name: /is saved/ });
    expect(saved).toBeDisabled();
    expect(saved).toHaveTextContent("Saved");

    inStudio({ dirty: true });
    rerender(
      <>
        <StudioBackItem />
        <StudioSaveItem />
      </>,
    );
    const save = screen.getByRole("button", { name: /Save the edit/ });
    expect(save).toBeEnabled();
    expect(save).toHaveTextContent("Save");
  });
});

describe("pausing when the studio hides the frame", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    useTimelineStore.setState({ playbackState: "stopped" });
  });

  it("stops the timeline and every media element", () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    document.body.append(document.createElement("video"), document.createElement("audio"));
    useTimelineStore.setState({ playbackState: "playing" });
    pauseAllPlayback();
    expect(useTimelineStore.getState().playbackState).toBe("paused");
    expect(pause).toHaveBeenCalledTimes(2);
  });
});

describe("the Edit monitor's header", () => {
  afterEach(() => {
    cleanup();
    useStudioStore.setState({ pid: null, name: "", partLabel: "" });
  });

  it("names the film and part as cut", () => {
    expect(monitorSubtitle("Recovery", "Part 1")).toBe("Recovery · Part 1, as cut");
    expect(monitorSubtitle("Recovery", "")).toBe("Recovery, as cut");
    inStudio();
    render(<EditMonitorHeader />);
    expect(screen.getByRole("heading", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByText("Recovery · Part 1, as cut")).toBeInTheDocument();
  });
});

describe("Motion Design is hidden", () => {
  afterEach(() => cleanup());

  it("from the ... menu", () => {
    render(<EditorMoreMenu onShowShortcuts={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByRole("menuitem", { name: /Keyboard shortcuts/ })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /motion scene/i })).toBeNull();
  });
});
