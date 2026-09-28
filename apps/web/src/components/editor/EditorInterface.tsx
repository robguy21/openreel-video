import React, { useEffect, useState } from "react";
import { ToolcraftText as Text } from "@openreel/ui";

import { Preview } from "./Preview";
import { Timeline } from "./Timeline";
import { KeyframeEditorPanel } from "./KeyframeEditorPanel";
import { KeyboardShortcutsOverlay } from "./KeyboardShortcutsOverlay";
import { PanelErrorBoundary } from "../ErrorBoundary";
import { SpotlightTour, MoGraphTour } from "./tour";
import { EditorRoom } from "./layout/EditorRoom";
import { WorkspaceRail } from "./layout/WorkspaceRail";
import { WorkspacePanel } from "./layout/WorkspacePanel";
import { EditorMoreMenu } from "./layout/EditorMoreMenu";
import { ExportControl } from "./layout/ExportControl";
import { StudioBackItem, StudioSaveItem } from "./layout/StudioRailItems";
import { EditMonitorHeader } from "./layout/EditMonitorHeader";
import { MonitorStage } from "./layout/MonitorStage";
import { useReferenceSource } from "./layout/useReferenceSource";
import { useWorkspaceFollowsSelection } from "./layout/useWorkspaceFollowsSelection";
import { useResizable } from "../../desktop/editor/useResizable";
import { useProjectStore } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";
import { useEngineStore } from "../../stores/engine-store";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import {
  initializePlaybackBridge,
  disposePlaybackBridge,
} from "../../bridges/playback-bridge";
import {
  initializeMediaBridge,
  disposeMediaBridge,
} from "../../bridges/media-bridge";
import {
  initializeRenderBridge,
  disposeRenderBridge,
} from "../../bridges/render-bridge";
import {
  initializeEffectsBridge,
  disposeEffectsBridge,
} from "../../bridges/effects-bridge";
import {
  initializeTransitionBridge,
  disposeTransitionBridge,
} from "../../bridges/transition-bridge";

/**
 * The editor's sizes (docs/PROPOSAL_EDITOR_REDESIGN.md R2.2): the workspace panel's
 * width and the timeline's height, each resizable by dragging the gap beside it and
 * remembered per browser. The timeline's bounds are fractions of the window, so they
 * are applied where it is drawn, and the maximise toggle still gives it most of it.
 */
const WORKSPACE_W = { initial: 320, min: 280, max: 480 };
const TIMELINE_H = { initial: 296, minVh: 22, maxVh: 70, maximisedVh: 80 };
const WORKSPACE_W_KEY = "openreel-layout-workspace-w";
const TIMELINE_H_KEY = "openreel-layout-timeline-h";

/** The window's height, kept current so the timeline's vh bounds follow a resize. */
const useViewportHeight = (): number => {
  const [height, setHeight] = useState(() =>
    typeof window === "undefined" ? 900 : window.innerHeight,
  );
  useEffect(() => {
    const onResize = () => setHeight(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return height;
};

/**
 * Auto-save initialization hook
 */
const useAutoSave = () => {
  const { initializeAutoSave } = useProjectStore();

  useEffect(() => {
    initializeAutoSave().catch(console.error);
  }, [initializeAutoSave]);
};

/**
 * Engine and bridge initialization hook
 * Ensures all engines and bridges are fully initialized before rendering editor
 */
const useEngineInitialization = () => {
  const { initialize, initialized, initializing, initError } = useEngineStore();
  const [bridgesReady, setBridgesReady] = useState(false);
  const [initStatus, setInitStatus] = useState("Starting...");
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const initAll = async () => {
      try {
        const currentState = useEngineStore.getState();
        if (!currentState.initialized && !currentState.initializing) {
          setInitStatus("Initializing video engine...");
          await initialize();
        } else if (currentState.initializing) {
          await new Promise<void>((resolve) => {
            const unsubscribe = useEngineStore.subscribe((state) => {
              if (state.initialized || state.initError) {
                unsubscribe();
                resolve();
              }
            });
          });
        }

        if (!isMounted) return;

        const engineState = useEngineStore.getState();
        if (!engineState.initialized) {
          throw new Error(
            engineState.initError || "Engine initialization failed",
          );
        }

        setInitStatus("Initializing media bridge...");
        await initializeMediaBridge();
        if (!isMounted) return;

        setInitStatus("Initializing playback bridge...");
        await initializePlaybackBridge();
        if (!isMounted) return;

        setInitStatus("Initializing render bridge...");
        await initializeRenderBridge();
        if (!isMounted) return;

        setInitStatus("Initializing effects bridge...");
        const projectState = useProjectStore.getState();
        const { width, height } = projectState.project.settings;
        try {
          await initializeEffectsBridge(width, height);
        } catch (effectsError) {
          console.error(
            "[EditorInterface] EffectsBridge initialization failed:",
            effectsError,
          );
        }
        if (!isMounted) return;

        setInitStatus("Initializing transition bridge...");
        try {
          initializeTransitionBridge(width, height);
        } catch (transitionError) {
          console.error(
            "[EditorInterface] TransitionBridge initialization failed:",
            transitionError,
          );
        }
        if (!isMounted) return;

        setBridgesReady(true);
      } catch (error) {
        console.error("Failed to initialize engines/bridges:", error);
        if (isMounted) {
          setLocalError(
            error instanceof Error ? error.message : "Unknown error",
          );
          setInitStatus(
            `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
          );
        }
      }
    };

    initAll();

    return () => {
      isMounted = false;
      disposePlaybackBridge();
      disposeMediaBridge();
      disposeRenderBridge();
      disposeEffectsBridge();
      disposeTransitionBridge();
    };
  }, [initialize, initialized, initializing]);

  return {
    initialized: initialized && bridgesReady,
    initializing: initializing || (!bridgesReady && initialized),
    initError: initError || localError,
    initStatus,
  };
};
/**
 * The editor (docs/PROPOSAL_EDITOR_REDESIGN.md R1-R4): Clip Studio's glass look over the
 * film's room, laid out like Premiere's Edit screen. There is no top bar (Robert,
 * 2026-09-28): the way back to the studio heads the rail, Save, Export and "..." are its
 * foot, and the Edit monitor's header names the film.
 *
 *   +------+-----------------+--------------------------------------------+
 *   | rail | workspace panel | stage (the monitors)                       |
 *   |  72  | 320 (one tab)   +--------------------------------------------+
 *   |      |                 | timeline                                   |
 *   +------+-----------------+--------------------------------------------+
 *
 * The workspace panel runs the full height and the timeline runs under the monitors
 * only. Every panel is its own glass card, 12 px apart on 16 px of room.
 */
export const EditorInterface: React.FC = () => {
  const { initialized, initializing, initError, initStatus } =
    useEngineInitialization();

  const { showShortcutsOverlay, setShowShortcutsOverlay } =
    useKeyboardShortcuts();
  useAutoSave();

  const {
    keyframeEditorOpen,
    setKeyframeEditorOpen,
    getSelectedClipIds,
    timelineMaximized,
  } = useUIStore();
  useWorkspaceFollowsSelection();
  useReferenceSource();
  const { project, updateClipKeyframes } = useProjectStore();
  const tracks = project.timeline.tracks;

  const [selectedKeyframeIds, setSelectedKeyframeIds] = React.useState<string[]>([]);
  const [copiedKeyframes, setCopiedKeyframes] = React.useState<
    import("@openreel/core").Keyframe[]
  >([]);

  const selectedClip = React.useMemo(() => {
    const selectedIds = getSelectedClipIds();
    if (selectedIds.length === 0) return null;
    const clipId = selectedIds[0];
    for (const track of tracks) {
      const clip = track.clips.find((c) => c.id === clipId);
      if (clip) return clip;
    }
    return null;
  }, [getSelectedClipIds, tracks]);

  const handleUpdateKeyframe = React.useCallback(
    (
      keyframeId: string,
      updates: Partial<import("@openreel/core").Keyframe>,
    ) => {
      if (!selectedClip?.keyframes) return;
      const keyframes = selectedClip.keyframes.map((kf) =>
        kf.id === keyframeId ? { ...kf, ...updates } : kf,
      );
      updateClipKeyframes(selectedClip.id, keyframes);
    },
    [selectedClip, updateClipKeyframes],
  );

  const handleDeleteKeyframe = React.useCallback(
    (keyframeId: string) => {
      if (!selectedClip?.keyframes) return;
      const keyframes = selectedClip.keyframes.filter(
        (kf) => kf.id !== keyframeId,
      );
      updateClipKeyframes(selectedClip.id, keyframes);
      setSelectedKeyframeIds((prev) => prev.filter((id) => id !== keyframeId));
    },
    [selectedClip, updateClipKeyframes],
  );

  const handleCopyKeyframes = React.useCallback(
    (keyframeIds: string[]) => {
      if (!selectedClip?.keyframes) return;
      const toCopy = selectedClip.keyframes.filter((kf) =>
        keyframeIds.includes(kf.id),
      );
      setCopiedKeyframes(toCopy);
    },
    [selectedClip],
  );

  const handlePasteKeyframes = React.useCallback(
    (clipId: string, time: number) => {
      const targetClip = tracks
        .flatMap((t) => t.clips)
        .find((c) => c.id === clipId);
      if (!targetClip) return;
      const newKeyframes = copiedKeyframes.map((kf) => ({
        ...kf,
        id: `kf-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        time: kf.time + time,
      }));
      updateClipKeyframes(clipId, [
        ...(targetClip.keyframes || []),
        ...newKeyframes,
      ]);
    },
    [copiedKeyframes, tracks, updateClipKeyframes],
  );

  const handleSelectKeyframe = React.useCallback(
    (keyframeId: string, addToSelection: boolean) => {
      if (addToSelection) {
        setSelectedKeyframeIds((prev) =>
          prev.includes(keyframeId)
            ? prev.filter((id) => id !== keyframeId)
            : [...prev, keyframeId],
        );
      } else {
        setSelectedKeyframeIds([keyframeId]);
      }
    },
    [],
  );

  // ── Layout: sizes the reader chose, remembered per browser ─────
  const viewportH = useViewportHeight();
  const workspace = useResizable({
    initial: WORKSPACE_W.initial,
    min: WORKSPACE_W.min,
    max: WORKSPACE_W.max,
    axis: "x",
    direction: 1,
    storageKey: WORKSPACE_W_KEY,
  });
  const timelineMin = (viewportH * TIMELINE_H.minVh) / 100;
  const timelineMax = (viewportH * TIMELINE_H.maxVh) / 100;
  const timeline = useResizable({
    initial: TIMELINE_H.initial,
    min: timelineMin,
    max: timelineMax,
    axis: "y",
    direction: -1,
    storageKey: TIMELINE_H_KEY,
  });
  const timelineHeight = timelineMaximized
    ? (viewportH * TIMELINE_H.maximisedVh) / 100
    : Math.min(Math.max(timeline.value, timelineMin), timelineMax);

  if (initializing || !initialized) {
    return (
      <div className="w-full h-full bg-bg flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <Text type="supporting" color="primary" className="text-fg-2 text-sm">Initializing editor…</Text>
          <Text type="supporting" color="secondary" className="text-fg-muted text-xs mt-2">{initStatus}</Text>
          {initError && (
            <Text type="supporting" className="text-status-error text-xs mt-2">{initError}</Text>
          )}
        </div>
      </div>
    );
  }
  const gridStyle: React.CSSProperties = {
    gridTemplateColumns: `72px ${workspace.value}px minmax(0, 1fr)`,
    gridTemplateRows: `minmax(0, 1fr) ${Math.round(timelineHeight)}px`,
    gridTemplateAreas: '"rail work stage" "rail work tl"',
  };

  return (
    <div className="relative z-20 h-full w-full select-none overflow-hidden font-sans text-fg">
      <EditorRoom />

      <div className="relative flex h-full flex-col p-4">
        <div className="grid min-h-0 flex-1 gap-3" style={gridStyle}>
          <div className="flex min-h-0" style={{ gridArea: "rail" }}>
            <WorkspaceRail
              top={<StudioBackItem />}
              foot={
                <>
                  <StudioSaveItem />
                  <ExportControl />
                  <EditorMoreMenu onShowShortcuts={() => setShowShortcutsOverlay(true)} />
                </>
              }
            />
          </div>

          <div className="relative flex min-h-0 min-w-0 flex-col" style={{ gridArea: "work" }}>
            <WorkspacePanel />
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize the workspace panel"
              onPointerDown={workspace.onHandlePointerDown}
              className="group absolute -right-[9px] bottom-0 top-0 z-10 flex w-[6px] cursor-col-resize items-center justify-center"
            >
              <span className="h-10 w-1 rounded-full bg-transparent transition-colors group-hover:bg-accent-glow" />
            </div>
          </div>

          <div className="min-h-0 min-w-0" style={{ gridArea: "stage" }}>
            <MonitorStage
              edit={
                <section
                  aria-label="Edit monitor"
                  className="or-glass or-see-through flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
                >
                  <PanelErrorBoundary name="Stage">
                    <Preview header={(zoom) => <EditMonitorHeader zoom={zoom} />} />
                  </PanelErrorBoundary>
                </section>
              }
            />
          </div>

          <section
            aria-label="Timeline"
            className="or-glass or-see-through relative flex min-h-0 min-w-0 flex-col overflow-visible"
            style={{ gridArea: "tl" }}
          >
            <div
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize the timeline"
              onPointerDown={timelineMaximized ? undefined : timeline.onHandlePointerDown}
              className="group absolute -top-[9px] left-0 right-0 z-10 flex h-[6px] cursor-row-resize items-center justify-center"
            >
              <span className="h-1 w-10 rounded-full bg-transparent transition-colors group-hover:bg-accent-glow" />
            </div>
            <div className="flex min-h-0 flex-1 overflow-hidden rounded-card">
              <div className="min-h-0 min-w-0 flex-1">
                <PanelErrorBoundary name="Timeline">
                  <Timeline />
                </PanelErrorBoundary>
              </div>

              {keyframeEditorOpen && (
                <div className="min-w-0 shrink-0 border-l border-glass-border">
                  <PanelErrorBoundary name="Keyframe Editor">
                    <KeyframeEditorPanel
                      clip={selectedClip}
                      onClose={() => setKeyframeEditorOpen(false)}
                      onUpdateKeyframe={handleUpdateKeyframe}
                      onDeleteKeyframe={handleDeleteKeyframe}
                      onCopyKeyframes={handleCopyKeyframes}
                      onPasteKeyframes={handlePasteKeyframes}
                      selectedKeyframeIds={selectedKeyframeIds}
                      onSelectKeyframe={handleSelectKeyframe}
                      copiedKeyframes={copiedKeyframes}
                    />
                  </PanelErrorBoundary>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

      <KeyboardShortcutsOverlay
        isOpen={showShortcutsOverlay}
        onClose={() => setShowShortcutsOverlay(false)}
      />

      <SpotlightTour />
      <MoGraphTour />
    </div>
  );
};

export default EditorInterface;
