import React, { useState } from "react";
import {
  House,
  Settings,
  Circle,
  Play,
  Sparkles,
  FileCode,
  Keyboard,
  RotateCcw,
  Music,
} from "@/icons/lucide-compat";
import { useUIStore } from "../../../stores/ui-store";
import { useSettingsStore } from "../../../stores/settings-store";
import { useRouter } from "../../../hooks/use-router";
import {
  startTour,
  ONBOARDING_KEY,
  startMoGraphTour,
  MOGRAPH_TOUR_KEY,
} from "../tour";
import { RailButton, RailMenu } from "./RailItem";
import { ConfirmDialog } from "./ConfirmDialog";
import {
  importAudioCreations,
  rebuildFromFilm,
  useStudioStore,
} from "../../../services/studio/studio-session";

/**
 * The "..." menu at the foot of the rail: everything rare (docs/PROPOSAL_EDITOR_REDESIGN.md
 * R3). It holds what the old left action rail offered and the sidebar does not: the
 * project JSON, settings, the screen recorder, the two tours, the keyboard shortcuts and
 * the home page. The rail's theme toggle is gone - the editor is dark only - and so is
 * "Create motion scene": the Motion Design side of the fork is hidden (Robert, 2026-09-28).
 */
export const EditorMoreMenu: React.FC<{ onShowShortcuts: () => void }> = ({
  onShowShortcuts,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [confirmRebuild, setConfirmRebuild] = useState(false);
  const inStudio = useStudioStore((s) => s.pid !== null);
  const openModal = useUIStore((s) => s.openModal);
  const { openSettings } = useSettingsStore();
  const { navigate } = useRouter();

  return (
    <>
    <ConfirmDialog
      open={confirmRebuild}
      title="Rebuild from the film?"
      body="This lays the film out fresh from the studio. Changes you made in this edit are lost."
      confirmLabel="Rebuild"
      cancelLabel="Keep my edit"
      onCancel={() => setConfirmRebuild(false)}
      onConfirm={() => {
        setConfirmRebuild(false);
        void rebuildFromFilm();
      }}
    />
    <RailMenu
      label="More"
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      entries={[
        ...(inStudio
          ? [
              {
                label: "Rebuild from the film…",
                description: "Lay the part out fresh from the studio",
                icon: <RotateCcw size={16} aria-hidden />,
                onSelect: () => setConfirmRebuild(true),
              },
              {
                label: "Import Audio Creations",
                description: "Bring the project's songs into the media library",
                icon: <Music size={16} aria-hidden />,
                onSelect: () => void importAudioCreations(),
              },
              null,
            ]
          : []),
        {
          label: "Project JSON / Comments",
          icon: <FileCode size={16} aria-hidden />,
          onSelect: () => openModal("scriptView"),
        },
        null,
        {
          label: "Settings & API keys",
          icon: <Settings size={16} aria-hidden />,
          onSelect: () => openSettings(),
        },
        {
          label: "Screen recorder",
          icon: <Circle size={16} className="fill-current text-status-error" aria-hidden />,
          onSelect: () => openModal("recorder"),
        },
        null,
        {
          label: "Editor tour",
          icon: <Play size={16} aria-hidden />,
          onSelect: () => {
            localStorage.removeItem(ONBOARDING_KEY);
            startTour();
          },
        },
        {
          label: "Animation & effects tour",
          icon: <Sparkles size={16} aria-hidden />,
          onSelect: () => {
            localStorage.removeItem(MOGRAPH_TOUR_KEY);
            startMoGraphTour();
          },
        },
        {
          label: "Keyboard shortcuts (?)",
          icon: <Keyboard size={16} aria-hidden />,
          onSelect: onShowShortcuts,
        },
        null,
        {
          label: "Back to home",
          icon: <House size={16} aria-hidden />,
          onSelect: () => navigate("welcome"),
        },
      ]}
      trigger={
        <RailButton
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <circle cx="5" cy="12" r="1.6" />
              <circle cx="12" cy="12" r="1.6" />
              <circle cx="19" cy="12" r="1.6" />
            </svg>
          }
          label="More"
          aria-haspopup="menu"
          aria-expanded={isOpen}
        />
      }
    />
    </>
  );
};
