import React, { useCallback, useEffect, useState } from "react";
import { useUIStore } from "../../../stores/ui-store";
import { useTtsAudioStore } from "../../../stores/tts-store";
import { toast } from "../../../stores/notification-store";
import { PanelErrorBoundary } from "../../ErrorBoundary";
import { MediaSection } from "../assets/MediaSection";
import { TextSection } from "../assets/TextSection";
import { GraphicsSection } from "../assets/GraphicsSection";
import { InspectorPanel } from "../InspectorPanel";
import { EffectsPanel, TransitionsPanel } from "../panels/EffectsTransitionsPanel";
import { MomentsPanel } from "../panels/MomentsPanel";
import { RecipesTab } from "../panels/RecipesTab";
import { TemplatesTab } from "../panels/TemplatesTab";
import { AIGenTab } from "../AIGenTab";
import { AudioMixer } from "../../audio-mixer";
import { HistoryPanel } from "../inspector/HistoryPanel";
import { WORKSPACE_TITLES } from "./WorkspaceRail";
import { referenceFromMedia } from "./useReferenceSource";
import { useReferenceStore } from "../../../stores/reference-store";
import { useProjectStore } from "../../../stores/project-store";

const projectFps = () => useProjectStore.getState().project.settings.frameRate || 24;

const ChatPanel = React.lazy(() =>
  import("../chat/ChatPanel").then((module) => ({ default: module.ChatPanel })),
);

/**
 * The workspace panel (docs/PROPOSAL_EDITOR_REDESIGN.md R4.2-4.4): one tab at a time,
 * headed by the tab's name. Every tab is an existing component, moved and not
 * rewritten. AI Generate opens inside the Media tab, from its Generate button, with a
 * way back.
 */

/** A heading over one of the lists a tab stacks (Templates holds two). */
const ListHeading: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h3 className="px-4 pb-1 pt-4 text-[12px] font-medium text-fg-3">{children}</h3>
);

const Scroll: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain custom-scrollbar">
    {children}
  </div>
);

export const WorkspacePanel: React.FC = () => {
  const workspaceTab = useUIStore((s) => s.workspaceTab);
  const [generating, setGenerating] = useState(false);
  const ttsHasUnsaved = useTtsAudioStore(
    (s) => s.generatedAudio !== null && !s.isAudioSaved,
  );

  const leaveGenerate = useCallback(() => {
    if (ttsHasUnsaved) {
      toast.warning("Unsaved audio discarded", "Save to media or download next time to keep it.");
    }
    setGenerating(false);
  }, [ttsHasUnsaved]);
  const leaveGenerateRef = React.useRef(leaveGenerate);
  leaveGenerateRef.current = generating ? leaveGenerate : () => undefined;

  // Picking another tab closes Generate, as leaving the old AI tab did.
  useEffect(() => {
    if (workspaceTab !== "media") leaveGenerateRef.current();
  }, [workspaceTab]);

  const inGenerate = workspaceTab === "media" && generating;
  const title = inGenerate ? "Generate" : WORKSPACE_TITLES[workspaceTab];

  const body = (() => {
    switch (workspaceTab) {
      case "media":
        return generating ? (
          <AIGenTab />
        ) : (
          <MediaSection
            variant="sidebar"
            onGenerate={() => setGenerating(true)}
            onOpen={(item) => {
              const source = referenceFromMedia(item, projectFps());
              if (source) useReferenceStore.getState().load(source);
            }}
          />
        );
      case "properties":
        return <InspectorPanel />;
      case "text":
        return <TextSection />;
      case "graphics":
        return <GraphicsSection />;
      case "effects":
        return <EffectsPanel />;
      case "transitions":
        return <TransitionsPanel />;
      case "moments":
        return <MomentsPanel />;
      case "audio":
        return (
          <Scroll>
            <div className="px-3 pb-4">
              <AudioMixer visible />
            </div>
          </Scroll>
        );
      case "templates":
        return (
          <Scroll>
            <ListHeading>Recipes</ListHeading>
            <div className="flex min-h-[320px] flex-col">
              <RecipesTab />
            </div>
            <ListHeading>Project templates</ListHeading>
            <div className="flex min-h-[320px] flex-col">
              <TemplatesTab showMotionCreator={false} />
            </div>
          </Scroll>
        );
      case "assistant":
        return (
          <React.Suspense
            fallback={
              <div className="grid flex-1 place-items-center text-xs text-fg-muted">
                Loading Assistantâ€¦
              </div>
            }
          >
            <ChatPanel />
          </React.Suspense>
        );
      case "history":
        return <HistoryPanel titled={false} />;
      default:
        return null;
    }
  })();

  return (
    <section
      aria-label="Workspace panel"
      className="or-glass or-workspace flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      data-tour="assets"
    >
      <header className="flex shrink-0 items-center gap-2 px-5 pb-2.5 pt-5">
        {inGenerate && (
          <button
            type="button"
            onClick={leaveGenerate}
            aria-label="Back to Media"
            className="or-control or-focus -ml-1 grid h-8 w-8 place-items-center"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </button>
        )}
        <h2 className="truncate text-[15px] font-semibold text-fg-strong">{title}</h2>
      </header>
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <PanelErrorBoundary name={title}>{body}</PanelErrorBoundary>
      </div>
    </section>
  );
};
